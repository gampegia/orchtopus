// The session service against the fake claude CLI, a temp repository with a remote and a temp
// data folder. Polls are driven by hand (tracker.onPoll with the adapter's list).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamMessage } from '../../shared/api-types';
import type { AgentAdapter } from '../adapter/agent-adapter';
import { createBackgroundAdapter } from '../adapter/background-adapter';
import { createTerminalRegistry, type TerminalRegistry } from '../adapter/terminals';
import {
  setupFakeClaude,
  sleep,
  trackedPtySpawn,
  waitFor,
  type FakeClaude,
  type TrackedPtySpawn,
} from '../adapter/testing';
import { HttpError } from '../api/router';
import { createAppContext, type AppContext } from '../app-context';
import { hookInvocation } from '../base-setup/settings';
import {
  BUILDING_BLOCKS_DIR,
  loadBuildingBlock,
  WORKFLOW_INSTRUCTION,
} from '../base-setup/building-blocks';
import { claudeConfigPaths } from '../claude/claude-home';
import { filterByCwd } from '../claude/agents';
import { resolveDataPaths, sessionFiles, type DataPaths } from '../data-folder';
import { createWorktree, removeWorktree } from '../git/worktrees';
import { createProjectService, type ProjectService } from '../projects/project-service';
import { createActionRunner, type ActionRunner } from '../store/actions';
import { openStore, readEvents, type Store } from '../store/event-log';
import { getSession, getSessionState, listSessions } from '../store/projections';
import { makeTempDir, type TempDir } from '../store/testing';
import { createTempRepo, git, isolatedGitEnv, type TempRepo } from '../test-helpers/temp-repo';
import { createStateTracker, type StateTracker } from './state-tracker';
import {
  createSessionService,
  type SessionService,
  type SessionServiceDeps,
  type StartSessionInput,
} from './session-service';

const BLOCKS = fileURLToPath(new URL(`../../../${BUILDING_BLOCKS_DIR}`, import.meta.url));
const SIZE = { cols: 120, rows: 30 };

let fake: FakeClaude;
let pty: TrackedPtySpawn;
let temp: TempDir;
let paths: DataPaths;
let store: Store;
let repo: TempRepo;
let ctx: AppContext;
let actions: ActionRunner;
let tracker: StateTracker;
let registry: TerminalRegistry;
let projects: ProjectService;
let adapter: AgentAdapter;
let projectId: string;
let published: StreamMessage[];
let counter = 0;

beforeAll(() => {
  for (const [key, value] of Object.entries(isolatedGitEnv())) vi.stubEnv(key, value);
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const clock = (): string => new Date().toISOString();

/** Trusts a folder in the fake's .claude.json (the repository root covers its worktrees). */
function trust(dir: string): void {
  writeFileSync(
    join(fake.root, 'cfg', '.claude.json'),
    JSON.stringify({ projects: { [dir.replace(/\\/g, '/')]: { hasTrustDialogAccepted: true } } }),
  );
}

beforeEach(async () => {
  fake = setupFakeClaude();
  pty = trackedPtySpawn();
  temp = makeTempDir();
  paths = resolveDataPaths({ env: { ORCHTOPUS_DATA_DIR: temp.dir }, appData: temp.dir });
  store = openStore(paths.stateDb);
  repo = await createTempRepo({ withRemote: true });
  trust(repo.root);
  ctx = createAppContext({ paths, store });
  published = [];
  ctx.attachPublisher((m) => published.push(m));
  actions = createActionRunner(store, clock);
  tracker = createStateTracker({
    store,
    publish: ctx.publish,
    now: Date.now,
    setStatus: ctx.setStatus,
    sessionView: ctx.sessionView,
  });
  adapter = createBackgroundAdapter({ cmd: fake.cmd, now: Date.now, sleep, spawnPty: pty.spawn });
  registry = createTerminalRegistry(adapter, { onStatus: ctx.setTerminal });
  projects = createProjectService({
    paths,
    store,
    actions,
    clock,
    cliStatus: () => ({ found: true, version: '2.1.332', supported: true }),
    claudePaths: claudeConfigPaths({ CLAUDE_CONFIG_DIR: join(fake.root, 'cfg') }, fake.root),
    env: {},
  });
  const project = await projects.add({
    path: repo.root,
    checkCommands: { test: null, lint: null, typecheck: null },
    copyList: ['.env', 'missing.txt'],
    branchPrefix: 'orch/',
  });
  projectId = project.id;
});

afterEach(async () => {
  registry.closeAll();
  await pty.allExited();
  await fake.cleanup();
  store.close();
  await repo.cleanup();
  temp.remove();
});

function deps(overrides: Partial<SessionServiceDeps> = {}): SessionServiceDeps {
  return {
    paths,
    store,
    actions,
    adapter,
    terminals: registry,
    tracker,
    rememberStart: (id, last) => projects.rememberStart(id, last),
    clock,
    now: Date.now,
    instruction: () => loadBuildingBlock(BLOCKS, WORKFLOW_INSTRUCTION),
    launcher: () => hookInvocation(paths),
    cliStatus: () => ({ found: true, version: '2.1.332', supported: true }),
    publish: ctx.publish,
    sessionView: ctx.sessionView,
    shell: { openPath: () => Promise.resolve(''), openExternal: () => Promise.resolve() },
    whereCode: () => Promise.resolve(false),
    ...overrides,
  };
}

function service(overrides: Partial<SessionServiceDeps> = {}): SessionService {
  return createSessionService(deps(overrides));
}

function input(change: Partial<StartSessionInput> = {}): StartSessionInput {
  counter += 1;
  const task = change.task ?? 'upload-fix';
  return {
    projectId,
    task,
    branch: `orch/${task}`,
    base: 'remote',
    prompt: null,
    model: null,
    effort: null,
    mode: 'auto',
    requestId: `request-${String(counter).padStart(4, '0')}`,
    ...change,
  };
}

async function poll(): Promise<void> {
  tracker.onPoll({ ok: true, entries: await adapter.list() });
}

function bgCalls(): string[][] {
  return fake.argv().filter((argv) => argv.includes('--bg'));
}

function worktree(task = 'upload-fix'): string {
  return join(repo.root, '.claude', 'worktrees', task);
}

async function rejection(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('session service', { timeout: 60_000 }, () => {
  it('start creates the worktree, files and a running session', async () => {
    const view = await service().start(input());
    expect(view.state).toBe('running');
    expect(existsSync(join(worktree(), 'README.md'))).toBe(true);
    // The copy list: .env is copied, the missing file is only a hint.
    expect(readFileSync(join(worktree(), '.env'), 'utf8')).toContain('API_URL');
    const files = sessionFiles(paths, view.id);
    expect(existsSync(files.settings)).toBe(true);
    expect(readFileSync(files.systemPrompt, 'utf8')).toContain('orch/upload-fix');
    expect(git(worktree(), ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('orch/upload-fix');

    const row = getSession(store.db, view.id);
    expect(row?.claudeSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(row?.shortId).toBe(row?.claudeSessionId?.slice(0, 8));
    const state = getSessionState(store.db, view.id);
    expect(state?.starting).toBe(false);
    expect(state?.processStartedAt).not.toBeNull();

    // No prompt yet: blocked / idle before the first prompt is idle.
    await poll();
    expect(ctx.sessionView(view.id)?.state).toBe('idle');
    expect(bgCalls()).toHaveLength(1);
    expect(listSessions(store.db)).toHaveLength(1);
    // The project remembers the last start values.
    const project = ctx.snapshot().projects.find((p) => p.id === projectId);
    expect(project?.lastStart).toEqual({ model: null, effort: null, mode: 'auto' });
    expect(published.some((m) => m.kind === 'session' && m.session.id === view.id)).toBe(true);
  });

  it('start logs action.started before git worktree add runs', async () => {
    const seen: string[] = [];
    const req = input();
    await service({
      git: {
        createWorktree: async (args) => {
          const types = readEvents(store.db).map((e) => `${e.type}:${JSON.stringify(e.payload)}`);
          if (types.some((t) => t.startsWith('action.started') && t.includes(req.requestId))) {
            seen.push('action.started');
          }
          if (readEvents(store.db).some((e) => e.type === 'session.created')) {
            seen.push('session.created');
          }
          seen.push('worktree add');
          return createWorktree(args);
        },
      },
    }).start(req);
    expect(seen).toEqual(['action.started', 'session.created', 'worktree add']);
  });

  it('start with the same requestId twice starts one session', async () => {
    const s = service();
    const req = input();
    const [a, b] = await Promise.all([s.start(req), s.start(req)]);
    expect(a.id).toBe(b.id);
    const again = await s.start(req);
    expect(again.id).toBe(a.id);
    expect(bgCalls()).toHaveLength(1);
    expect(listSessions(store.db)).toHaveLength(1);
  });

  it('start reports fetchFailed and starts from local after confirmation', async () => {
    git(repo.root, ['remote', 'set-url', 'origin', join(repo.root, '..', 'gone.git')]);
    const s = service();
    const error = await rejection(s.start(input({ base: 'remote' })));
    expect(error.status).toBe(409);
    expect(error.field).toBe('base');
    expect(error.message).toMatch(/Fetching main from origin failed/);
    expect(existsSync(worktree())).toBe(false);
    expect(listSessions(store.db)).toHaveLength(0);

    const view = await s.start(input({ base: 'local' }));
    expect(view.state).toBe('running');
    expect(existsSync(worktree())).toBe(true);
  });

  it('start refuses a tracked .claude/worktrees file', async () => {
    await mkdir(join(repo.root, '.claude', 'worktrees'), { recursive: true });
    writeFileSync(join(repo.root, '.claude', 'worktrees', 'notes.txt'), 'tracked\n');
    git(repo.root, ['add', '-f', '.claude/worktrees/notes.txt']);
    git(repo.root, ['commit', '--quiet', '-m', 'track a worktree file']);
    const error = await rejection(service().start(input()));
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/tracked/);
    expect(listSessions(store.db)).toHaveLength(0);
    expect(bgCalls()).toHaveLength(0);
  });

  it('rejects an invalid or taken task name with 422 on the task field', async () => {
    const s = service();
    const bad = await rejection(s.start(input({ task: 'Upload Fix', branch: 'orch/x' })));
    expect(bad).toMatchObject({ status: 422, field: 'task' });
    await s.start(input());
    const taken = await rejection(s.start(input()));
    expect(taken).toMatchObject({ status: 422, field: 'task' });
    const branch = await rejection(
      s.start(input({ task: 'report-export', branch: 'orch/upload-fix' })),
    );
    expect(branch).toMatchObject({ status: 422, field: 'branch' });
  });

  it('interrupted after claude-bg adopts the session found by cwd', async () => {
    const req = input();
    // The first run "crashes": claude --bg ran, but its result never reached the log.
    const crashing: AgentAdapter = {
      ...adapter,
      start: async (startInput) => {
        await adapter.start(startInput);
        return new Promise<never>(() => undefined);
      },
    };
    void service({ adapter: crashing }).start(req);
    await waitFor(async () => filterByCwd(await adapter.list(), worktree()).length > 0, 20_000);
    expect(bgCalls()).toHaveLength(1);

    const view = await service().start(req);
    expect(bgCalls()).toHaveLength(1);
    const [entry] = filterByCwd(await adapter.list(), worktree());
    expect(getSession(store.db, view.id)?.claudeSessionId).toBe(entry?.sessionId);
    expect(actions.get(req.requestId)?.status).toBe('done');
  });

  it('open resumes a stopped session without flags, then attaches', async () => {
    const s = service();
    const view = await s.start(input());
    const row = getSession(store.db, view.id);
    await s.stop(view.id);
    await poll();
    expect(ctx.sessionView(view.id)?.state).toBe('stopped');

    const { terminalId } = await s.open(view.id, SIZE);
    expect(bgCalls().at(-1)).toEqual(['--bg', '--resume', row?.claudeSessionId]);
    expect(registry.get(terminalId)).toBeDefined();
    await poll();
    expect(ctx.sessionView(view.id)?.state).not.toBe('stopped');
    expect(ctx.sessionView(view.id)?.terminal.id).toBe(terminalId);
    // A second open returns the live terminal; nothing is resumed again.
    expect((await s.open(view.id, SIZE)).terminalId).toBe(terminalId);
    expect(bgCalls().filter((argv) => argv.includes('--resume'))).toHaveLength(1);
  });

  it('open resumes a failed session (reboot case) the same way', async () => {
    const s = service();
    const view = await s.start(input());
    const row = getSession(store.db, view.id);
    const [entry] = filterByCwd(await adapter.list(), worktree());
    if (entry?.pid == null || row?.shortId == null) throw new Error('no fake session');
    process.kill(entry.pid);
    await waitFor(async () => {
      const e = filterByCwd(await adapter.list(), worktree())[0];
      return e !== undefined && e.status === null;
    });
    const file = join(fake.root, 'cfg', 'fake', 'sessions', `${row.shortId}.json`);
    const record = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...record, state: 'failed' }));
    await poll();
    expect(ctx.sessionView(view.id)?.state).toBe('failed');

    const { terminalId } = await s.open(view.id, SIZE);
    expect(bgCalls().at(-1)).toEqual(['--bg', '--resume', row.claudeSessionId]);
    expect(registry.get(terminalId)).toBeDefined();
  });

  it('open drops a leftover attach terminal before it resumes', async () => {
    const s = service();
    const view = await s.start(input());
    const first = await s.open(view.id, SIZE);
    await s.stop(view.id);
    await poll();
    expect(ctx.sessionView(view.id)?.state).toBe('stopped');
    // The PTY of a process that is gone may not have reported its exit yet.
    const closeSession = vi.spyOn(registry, 'closeSession');
    const { terminalId } = await s.open(view.id, SIZE);
    expect(closeSession).toHaveBeenCalledWith(view.id);
    expect(terminalId).not.toBe(first.terminalId);
    expect(registry.get(terminalId)).toBeDefined();
  });

  it('a session that never started answers open with 409', async () => {
    trust(join(repo.root, '..', 'elsewhere'));
    const s = service();
    const view = await s.start(input());
    expect(view.state).toBe('failed');
    const error = await rejection(s.open(view.id, SIZE));
    expect(error.status).toBe(409);
    expect(error.message).toBe('This session never started; remove it and start again');
  });

  it('a failed start keeps its red state and reason after the next polls', async () => {
    trust(join(repo.root, '..', 'elsewhere'));
    const view = await service().start(input());
    expect(view.state).toBe('failed');
    expect(view.stateReason).toMatch(/Workspace not trusted/);
    expect(existsSync(worktree())).toBe(true);
    for (let i = 0; i < 3; i++) await poll();
    const after = ctx.sessionView(view.id);
    expect(after?.state).toBe('failed');
    expect(after?.stateReason).toMatch(/Workspace not trusted/);
  });

  it('remove refuses a dirty worktree and keeps everything', async () => {
    const s = service();
    const view = await s.start(input());
    writeFileSync(join(worktree(), 'draft.txt'), 'work in progress\n');
    const error = await rejection(s.remove(view.id, true));
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/uncommitted changes or untracked files/);
    expect(existsSync(join(worktree(), 'draft.txt'))).toBe(true);
    expect(getSession(store.db, view.id)).toBeDefined();
    expect(fake.argv().some((argv) => argv[0] === 'stop')).toBe(false);
  });

  it('remove stops, closes the terminal and removes a clean worktree, branch kept', async () => {
    let terminalAtRemove: unknown = 'not called';
    let terminalId = '';
    const s = service({
      git: {
        removeWorktree: (root, path) => {
          terminalAtRemove = registry.get(terminalId);
          return removeWorktree(root, path);
        },
      },
    });
    const view = await s.start(input());
    terminalId = (await s.open(view.id, SIZE)).terminalId;
    await s.remove(view.id, true);
    expect(terminalAtRemove).toBeUndefined();
    expect(fake.argv().some((argv) => argv[0] === 'stop')).toBe(true);
    expect(existsSync(worktree())).toBe(false);
    expect(git(repo.root, ['branch', '--list', 'orch/upload-fix'])).toContain('orch/upload-fix');
    expect(getSession(store.db, view.id)).toBeUndefined();
    expect(published.some((m) => m.kind === 'session-removed' && m.sessionId === view.id)).toBe(
      true,
    );
  });

  it('reveal opens the worktree in Explorer and in VS Code only when code is found', async () => {
    const opened: string[] = [];
    const s = service({
      shell: {
        openPath: (p) => {
          opened.push(`path:${p}`);
          return Promise.resolve('');
        },
        openExternal: (url) => {
          opened.push(`url:${url}`);
          return Promise.resolve();
        },
      },
      whereCode: () => Promise.resolve(true),
    });
    const view = await s.start(input());
    await s.reveal(view.id, 'explorer');
    await s.reveal(view.id, 'vscode');
    expect(opened[0]).toBe(`path:${worktree()}`);
    expect(opened[1]).toBe(`url:vscode://file/${encodeURI(worktree().replace(/\\/g, '/'))}`);
    const without = service({ whereCode: () => Promise.resolve(false) });
    expect(await without.vscodeAvailable()).toBe(false);
    expect((await rejection(without.reveal(view.id, 'vscode'))).status).toBe(409);
  });
});
