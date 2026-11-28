import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamMessage } from '../../shared/api-types';
import { HttpError } from '../api/router';
import { claudeConfigPaths } from '../claude/claude-home';
import { projectFile, resolveDataPaths, type DataPaths } from '../data-folder';
import { createActionRunner } from '../store/actions';
import { openStore, readEvents, type Store } from '../store/event-log';
import { listProjects } from '../store/projections';
import { makeTempDir, stepClock, type TempDir } from '../store/testing';
import { createTempRepo, git, isolatedGitEnv, type TempRepo } from '../test-helpers/temp-repo';
import { readProjectConfig } from './project-config';
import {
  createProjectService,
  type AddProjectInput,
  type ProjectService,
  type ProjectServiceDeps,
} from './project-service';

let temp: TempDir;
let paths: DataPaths;
let store: Store;
let repo: TempRepo;
let claudeDir: string;
let published: StreamMessage[];

beforeAll(() => {
  for (const [key, value] of Object.entries(isolatedGitEnv())) vi.stubEnv(key, value);
});
afterAll(() => {
  vi.unstubAllEnvs();
});
beforeEach(async () => {
  temp = makeTempDir();
  paths = resolveDataPaths({ env: { ORCHTOPUS_DATA_DIR: temp.dir }, appData: temp.dir });
  store = openStore(join(temp.dir, 'state.db'));
  repo = await createTempRepo();
  claudeDir = mkdtempSync(join(tmpdir(), 'orchtopus-claude-home-'));
  published = [];
});
afterEach(async () => {
  store.close();
  temp.remove();
  await repo.cleanup();
  rmSync(claudeDir, { recursive: true, force: true });
});

function service(overrides: Partial<ProjectServiceDeps> = {}): ProjectService {
  return createProjectService({
    paths,
    store,
    actions: createActionRunner(store, stepClock()),
    clock: stepClock(),
    cliStatus: () => ({ found: true, version: '2.1.332', supported: true }),
    claudePaths: claudeConfigPaths({ CLAUDE_CONFIG_DIR: claudeDir }, claudeDir),
    env: {},
    publish: (m) => published.push(m),
    ...overrides,
  });
}

function addInput(overrides: Partial<AddProjectInput> = {}): AddProjectInput {
  return {
    path: repo.root,
    checkCommands: { test: 'npm test', lint: null, typecheck: null },
    copyList: ['.env'],
    branchPrefix: 'orch/',
    ...overrides,
  };
}

/** Every file under a folder with its size and mtime, `.git` included. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const s = statSync(full);
        out[relative(dir, full)] = `${String(s.size)}:${String(s.mtimeMs)}`;
      }
    }
  };
  walk(dir);
  return out;
}

function addSession(projectId: string): void {
  store.append({
    id: 'session-upload-fix-created',
    type: 'session.created',
    at: '2026-11-27T09:00:00.000Z',
    projectId,
    sessionId: 'upload-fix',
    payload: {
      task: 'upload-fix',
      branch: 'orch/upload-fix',
      worktreePath: join(repo.root, '.claude', 'worktrees', 'upload-fix'),
      mode: 'auto',
      model: null,
      effort: null,
    },
  });
}

describe('project service', () => {
  it('inspect writes nothing', async () => {
    const dataBefore = tree(temp.dir);
    const repoBefore = tree(repo.root);
    const result = await service().inspect(repo.root);
    expect(result.repo).toMatchObject({ ok: true, defaultBranch: 'main' });
    expect(result.checkCommands).toEqual({ test: null, lint: null, typecheck: null });
    expect(result.copyList).toEqual(['.env']);
    expect(result.branchPrefix).toBe('orch/');
    expect(result.trust).toBe('unknown');
    expect(result.setup.map((i) => i.id)[0]).toBe('claude-version');
    expect(tree(temp.dir)).toEqual(dataBefore);
    expect(tree(repo.root)).toEqual(repoBefore);
    expect(readEvents(store.db)).toEqual([]);
    expect(published).toEqual([]);
  });

  it('inspect reports a folder that is not a repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'orchtopus-plain-'));
    try {
      const result = await service().inspect(plain);
      expect(result.repo).toMatchObject({ ok: false, reason: 'not-a-repo' });
      expect(result.setup).toEqual([]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it('add logs project.added before writing project.json and is idempotent by requestId', async () => {
    const writes: string[] = [];
    const svc = service({
      writeConfig: async (file, config) => {
        // The decision is in the log before the file is written.
        expect(readEvents(store.db).map((e) => e.type)).toContain('project.added');
        writes.push(file);
        const { writeProjectConfig } = await import('./project-config');
        await writeProjectConfig(file, config);
      },
    });
    const view = await svc.add(addInput(), 'req-0001');
    expect(view).toMatchObject({
      id: 'acme-app',
      name: 'acme-app',
      defaultBranch: 'main',
      provider: null,
      copyList: ['.env'],
      branchPrefix: 'orch/',
      lastStart: { model: null, effort: null, mode: 'auto' },
    });
    const config = await readProjectConfig(projectFile(paths, 'acme-app'));
    expect(config).toMatchObject({ schemaVersion: 1, id: 'acme-app', path: view.path });
    expect(published).toEqual([{ v: 1, kind: 'project', project: view }]);

    const again = await svc.add(addInput({ copyList: [] }), 'req-0001');
    expect(again).toEqual(view);
    expect(writes).toHaveLength(1);
    expect(readEvents(store.db).filter((e) => e.type === 'project.added')).toHaveLength(1);
    expect(listProjects(store.db)).toHaveLength(1);
  });

  it('add resumes a pending action without a second project', async () => {
    let fail = true;
    const svc = service({
      writeConfig: async (file, config) => {
        if (fail) throw new Error('disk full');
        const { writeProjectConfig } = await import('./project-config');
        await writeProjectConfig(file, config);
      },
    });
    await expect(svc.add(addInput(), 'req-0002')).rejects.toThrow('disk full');
    fail = false;
    await svc.resumePending();
    expect(listProjects(store.db).map((p) => p.id)).toEqual(['acme-app']);
    expect(existsSync(projectFile(paths, 'acme-app'))).toBe(true);
    const view = await svc.add(addInput(), 'req-0002');
    expect(view.id).toBe('acme-app');
    expect(readEvents(store.db).filter((e) => e.type === 'project.added')).toHaveLength(1);
  });

  it('remove fails a pending add of that project, so a resume writes and publishes nothing', async () => {
    let fail = true;
    const svc = service({
      writeConfig: async (file, config) => {
        if (fail) throw new Error('EBUSY');
        const { writeProjectConfig } = await import('./project-config');
        await writeProjectConfig(file, config);
      },
    });
    await expect(svc.add(addInput(), 'req-0006')).rejects.toThrow('EBUSY');
    expect(listProjects(store.db).map((p) => p.id)).toEqual(['acme-app']);
    await svc.remove('acme-app');
    fail = false;
    published.length = 0;
    await svc.resumePending();
    expect(existsSync(projectFile(paths, 'acme-app'))).toBe(false);
    expect(published).toEqual([]);
    expect(listProjects(store.db)).toEqual([]);
    await expect(svc.add(addInput(), 'req-0006')).rejects.toMatchObject({ status: 409 });
  });

  it('a pending remove keeps its id taken, so a resume never deletes the config of a re-add', async () => {
    let fail = false;
    const svc = service({
      removeConfig: async (file) => {
        if (fail) throw new Error('EBUSY');
        const { rm } = await import('node:fs/promises');
        await rm(file, { force: true });
      },
    });
    await svc.add(addInput(), 'req-0010');
    fail = true;
    await expect(svc.remove('acme-app')).rejects.toThrow('EBUSY');
    expect(listProjects(store.db)).toEqual([]);
    const again = await svc.add(addInput(), 'req-0011');
    expect(again.id).toBe('acme-app-2');
    fail = false;
    await svc.resumePending();
    expect(existsSync(projectFile(paths, 'acme-app'))).toBe(false);
    expect(existsSync(projectFile(paths, 'acme-app-2'))).toBe(true);
    expect(listProjects(store.db).map((p) => p.id)).toEqual(['acme-app-2']);
  });

  it('add refuses a folder that is not the top of a repository, logging nothing', async () => {
    const sub = join(repo.root, 'docs');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(sub);
    const err = await service()
      .add(addInput({ path: sub }), 'req-0003')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 422, field: 'path' });
    expect(readEvents(store.db)).toEqual([]);
  });

  it('add refuses a repository that is already a project', async () => {
    const svc = service();
    await svc.add(addInput(), 'req-0004');
    await expect(svc.add(addInput(), 'req-0005')).rejects.toMatchObject({ status: 409 });
  });

  it('add gives a second repository with the same folder name its own id', async () => {
    const other = await createTempRepo();
    try {
      const svc = service();
      await svc.add(addInput(), 'req-0006');
      const second = await svc.add(addInput({ path: other.root }), 'req-0007');
      expect(second.id).toBe('acme-app-2');
      expect(second.name).toBe('acme-app');
    } finally {
      await other.cleanup();
    }
  });

  it('remove refuses while sessions exist', async () => {
    const svc = service();
    const view = await svc.add(addInput(), 'req-0008');
    addSession(view.id);
    await expect(svc.remove(view.id)).rejects.toMatchObject({ status: 409 });
    expect(existsSync(projectFile(paths, view.id))).toBe(true);
    expect(listProjects(store.db)).toHaveLength(1);
  });

  it('remove deletes the config, never the repository', async () => {
    const svc = service();
    const view = await svc.add(addInput(), 'req-0009');
    writeFileSync(join(repo.root, 'notes.txt'), 'local work\n');
    // git status refreshes .git/index, so it runs before the tree is taken.
    const statusBefore = git(repo.root, ['status', '--porcelain']);
    const repoBefore = tree(repo.root);
    published = [];
    await svc.remove(view.id);
    expect(existsSync(projectFile(paths, view.id))).toBe(false);
    expect(existsSync(join(paths.projectsDir, view.id))).toBe(false);
    expect(listProjects(store.db)).toEqual([]);
    expect(readEvents(store.db).map((e) => e.type)).toContain('project.removed');
    expect(published).toEqual([{ v: 1, kind: 'project-removed', projectId: view.id }]);
    expect(tree(repo.root)).toEqual(repoBefore);
    expect(git(repo.root, ['status', '--porcelain'])).toBe(statusBefore);
    expect(statusBefore).toContain('notes.txt');
  });

  it('remove of an unknown project is 404', async () => {
    await expect(service().remove('acme-web')).rejects.toMatchObject({ status: 404 });
  });

  it('setupCheck runs the check for a stored project', async () => {
    const svc = service();
    const view = await svc.add(addInput(), 'req-0010');
    const items = await svc.setupCheck(view.id);
    expect(items.find((i) => i.id === 'check-command')?.status).toBe('ok');
    await expect(svc.setupCheck('acme-web')).rejects.toMatchObject({ status: 404 });
  });

  it('add answers 409 for a requestId that belongs to another action kind', async () => {
    const actions = createActionRunner(store, stepClock());
    actions.begin('project.remove', { projectId: 'acme-web' }, 'req-0020');
    const svc = service({ actions });
    await expect(svc.add(addInput(), 'req-0020')).rejects.toMatchObject({ status: 409 });
    expect(listProjects(store.db)).toEqual([]);
  });

  it('add continues a pending action with its logged params, not the new request', async () => {
    const actions = createActionRunner(store, stepClock());
    // A crash right after begin: the logged decision is the first request.
    actions.begin('project.add', addInput({ copyList: ['.env'] }), 'req-0021');
    const view = await service({ actions }).add(addInput({ copyList: [] }), 'req-0021');
    expect(view.copyList).toEqual(['.env']);
    const config = await readProjectConfig(projectFile(paths, view.id));
    expect(config.copyList).toEqual(['.env']);
  });

  it('resumePending fails an action with a permanent 4xx error, so it is not retried', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'orchtopus-plain-'));
    rmSync(plain, { recursive: true, force: true });
    const actions = createActionRunner(store, stepClock());
    actions.begin('project.add', addInput({ path: plain }), 'req-0022');
    const logs: string[] = [];
    const svc = service({ actions, log: (m) => logs.push(m) });
    await svc.resumePending();
    expect(actions.get('req-0022')?.status).toBe('failed');
    expect(actions.pending()).toEqual([]);
    await svc.resumePending();
    expect(logs).toHaveLength(1);
  });

  it('resumePending keeps an action pending after a transient error', async () => {
    const actions = createActionRunner(store, stepClock());
    actions.begin('project.add', addInput(), 'req-0023');
    const svc = service({
      actions,
      writeConfig: () => Promise.reject(new Error('EBUSY')),
    });
    await svc.resumePending();
    expect(actions.get('req-0023')?.status).toBe('pending');
  });

  it('add publishes the project as soon as it is logged, even when the write fails', async () => {
    const svc = service({ writeConfig: () => Promise.reject(new Error('EBUSY')) });
    await expect(svc.add(addInput(), 'req-0024')).rejects.toThrow('EBUSY');
    expect(listProjects(store.db).map((p) => p.id)).toEqual(['acme-app']);
    expect(published).toMatchObject([{ v: 1, kind: 'project', project: { id: 'acme-app' } }]);
  });

  it('remove publishes as soon as it is logged and a repeat continues the pending remove', async () => {
    let fail = true;
    const svc = service({
      removeConfig: async (file) => {
        if (fail) throw new Error('EBUSY');
        const { rm } = await import('node:fs/promises');
        await rm(file, { force: true });
      },
    });
    const view = await svc.add(addInput(), 'req-0025');
    published = [];
    await expect(svc.remove(view.id)).rejects.toThrow('EBUSY');
    expect(published).toEqual([{ v: 1, kind: 'project-removed', projectId: view.id }]);
    expect(existsSync(projectFile(paths, view.id))).toBe(true);
    fail = false;
    await svc.remove(view.id);
    expect(existsSync(projectFile(paths, view.id))).toBe(false);
    expect(readEvents(store.db).filter((e) => e.type === 'project.removed')).toHaveLength(1);
    await expect(svc.remove(view.id)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps a token in the remote URL out of project.json and the event log', async () => {
    git(repo.root, [
      'remote',
      'add',
      'origin',
      'https://acme-bot:ghp_secrettoken123@github.com/acme/acme-app.git',
    ]);
    const view = await service().add(addInput(), 'req-0026');
    const { readFileSync } = await import('node:fs');
    const file = readFileSync(projectFile(paths, view.id), 'utf8');
    expect(file).toContain('github.com/acme/acme-app.git');
    expect(file).not.toContain('ghp_secrettoken123');
    expect(file).not.toContain('acme-bot');
    const events = JSON.stringify(readEvents(store.db));
    expect(events).not.toContain('ghp_secrettoken123');
    expect(events).not.toContain('acme-bot');
  });

  it('rememberStart stores the last start values in project.json', async () => {
    const svc = service();
    const view = await svc.add(addInput(), 'req-0011');
    published = [];
    const lastStart = { model: 'opus', effort: 'high', mode: 'manual' as const };
    await svc.rememberStart(view.id, lastStart);
    const config = await readProjectConfig(projectFile(paths, view.id));
    expect(config.lastStart).toEqual(lastStart);
    expect(published).toEqual([{ v: 1, kind: 'project', project: { ...view, lastStart } }]);
  });
});
