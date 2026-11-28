// The restart sequence against the fake claude CLI, a temp repository and a temp data folder.
// Each test seeds the store, closes it and lets runStartup open it again, like an app restart.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentAdapter } from './adapter/agent-adapter';
import { createBackgroundAdapter } from './adapter/background-adapter';
import { createTerminalRegistry } from './adapter/terminals';
import { setupFakeClaude, sleep, type FakeClaude } from './adapter/testing';
import { createAppContext } from './app-context';
import {
  BUILDING_BLOCKS_DIR,
  loadBuildingBlock,
  WORKFLOW_INSTRUCTION,
} from './base-setup/building-blocks';
import { hookInvocation } from './base-setup/settings';
import { claudeConfigPaths } from './claude/claude-home';
import { resolveDataPaths, sessionFiles, type DataPaths } from './data-folder';
import { createProjectService } from './projects/project-service';
import { createSessionService, type StartSessionInput } from './sessions/session-service';
import { createStateTracker } from './sessions/state-tracker';
import { createActionRunner } from './store/actions';
import { openStore, readEvents, type Store } from './store/event-log';
import { getSession, getSessionState } from './store/projections';
import { makeTempDir, type TempDir } from './store/testing';
import { createTempRepo, isolatedGitEnv, type TempRepo } from './test-helpers/temp-repo';
import { runStartup, STARTUP_STEPS, type RunningApp, type StartupDeps } from './startup';

const BLOCKS = fileURLToPath(new URL(`../../${BUILDING_BLOCKS_DIR}`, import.meta.url));
const CLI_OK = { found: true, version: '2.1.332', supported: true };

let fake: FakeClaude;
let temp: TempDir;
let paths: DataPaths;
let repo: TempRepo;
let running: RunningApp | null;
let helperBundle: string;

beforeAll(() => {
  for (const [key, value] of Object.entries(isolatedGitEnv())) vi.stubEnv(key, value);
});
afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  fake = setupFakeClaude();
  temp = makeTempDir();
  paths = resolveDataPaths({ env: { ORCHTOPUS_DATA_DIR: temp.dir }, appData: temp.dir });
  repo = await createTempRepo({ withRemote: true });
  writeFileSync(
    join(fake.root, 'cfg', '.claude.json'),
    JSON.stringify({
      projects: { [repo.root.replace(/\\/g, '/')]: { hasTrustDialogAccepted: true } },
    }),
  );
  helperBundle = join(fake.root, 'hook-helper.js');
  writeFileSync(helperBundle, '// test helper\n');
  running = null;
});

afterEach(async () => {
  await running?.close();
  await fake.cleanup();
  await repo.cleanup();
  temp.remove();
});

const clock = (): string => new Date().toISOString();

function realAdapter(): AgentAdapter {
  return createBackgroundAdapter({ cmd: fake.cmd, now: Date.now, sleep });
}

function startupDeps(overrides: Partial<StartupDeps> = {}): StartupDeps {
  return {
    paths,
    hookSource: { exePath: process.execPath, helperBundle },
    claude: fake.cmd,
    buildingBlocksDir: BLOCKS,
    claudePaths: claudeConfigPaths({ CLAUDE_CONFIG_DIR: join(fake.root, 'cfg') }, fake.root),
    env: {},
    appVersion: '0.0.0-test',
    allowedOrigins: ['app://orchtopus'],
    preferredPort: 0,
    shell: { openPath: () => Promise.resolve(''), openExternal: () => Promise.resolve() },
    whereCode: () => Promise.resolve(false),
    log: () => undefined,
    pollIntervalMs: 60_000,
    ...overrides,
  };
}

async function start(overrides: Partial<StartupDeps> = {}): Promise<RunningApp> {
  running = await runStartup(startupDeps(overrides));
  return running;
}

/** Opens the store of the data folder, runs `seed` and closes it again (the app "quits"). */
async function seed(run: (store: Store) => Promise<void> | void): Promise<void> {
  mkdirSync(paths.root, { recursive: true });
  const store = openStore(paths.stateDb);
  try {
    await run(store);
  } finally {
    store.close();
  }
}

async function addProject(store: Store): Promise<string> {
  const projects = createProjectService({
    paths,
    store,
    actions: createActionRunner(store, clock),
    clock,
    cliStatus: () => CLI_OK,
    claudePaths: claudeConfigPaths({ CLAUDE_CONFIG_DIR: join(fake.root, 'cfg') }, fake.root),
    env: {},
  });
  const project = await projects.add({
    path: repo.root,
    checkCommands: { test: null, lint: null, typecheck: null },
    copyList: [],
    branchPrefix: 'orch/',
  });
  return project.id;
}

/** A stored session with Claude ids, as if it had started in an earlier run. */
function addSession(store: Store, projectId: string, id: string, claudeSessionId: string): void {
  store.append({
    id: `seed-${id}-created`,
    type: 'session.created',
    at: clock(),
    projectId,
    sessionId: id,
    payload: {
      task: id,
      branch: `orch/${id}`,
      worktreePath: join(repo.root, '.claude', 'worktrees', id),
      mode: 'auto',
      model: null,
      effort: null,
    },
  });
  store.append({
    id: `seed-${id}-started`,
    type: 'session.started',
    at: clock(),
    projectId,
    sessionId: id,
    payload: { claudeSessionId, shortId: claudeSessionId.slice(0, 8) },
  });
  store.append({
    id: `seed-${id}-state`,
    type: 'session.state',
    at: clock(),
    projectId,
    sessionId: id,
    payload: { word: 'running', reason: null },
  });
}

/** A session service on `store` whose git step `hang` never finishes (a crash in that step). */
function crashingService(store: Store, hang: 'createWorktree' | 'copyIntoWorktree') {
  const ctx = createAppContext({ paths, store });
  const adapter = realAdapter();
  const tracker = createStateTracker({ store, publish: () => undefined, now: Date.now });
  const never = (): Promise<never> => new Promise<never>(() => undefined);
  return createSessionService({
    paths,
    store,
    actions: createActionRunner(store, clock),
    adapter,
    terminals: createTerminalRegistry(adapter),
    tracker,
    rememberStart: () => Promise.resolve(),
    clock,
    now: Date.now,
    instruction: () => loadBuildingBlock(BLOCKS, WORKFLOW_INSTRUCTION),
    launcher: () => hookInvocation(paths),
    cliStatus: () => CLI_OK,
    publish: () => undefined,
    sessionView: ctx.sessionView,
    shell: { openPath: () => Promise.resolve(''), openExternal: () => Promise.resolve() },
    whereCode: () => Promise.resolve(false),
    git: hang === 'createWorktree' ? { createWorktree: never } : { copyIntoWorktree: never },
  });
}

function startInput(projectId: string, requestId: string): StartSessionInput {
  return {
    projectId,
    task: 'upload-fix',
    branch: 'orch/upload-fix',
    base: 'local',
    prompt: null,
    model: null,
    effort: null,
    mode: 'auto',
    requestId,
  };
}

/** Lets a crashing start run until it reaches the step that hangs. */
async function untilStep(store: Store, actionId: string, step: string): Promise<void> {
  const until = Date.now() + 20_000;
  for (;;) {
    const events = readEvents(store.db);
    const created = events.some((e) => e.type === 'session.created');
    const steps = events
      .filter((e) => e.type === 'action.step')
      .map((e) => (e.payload as { actionId: string; name: string }).name);
    if (created && steps.includes(step)) return;
    if (Date.now() > until) throw new Error(`step ${step} of ${actionId} not reached`);
    await sleep(25);
  }
}

function bgCalls(): string[][] {
  return fake.argv().filter((argv) => argv.includes('--bg'));
}

describe('restart sequence', { timeout: 60_000 }, () => {
  it('imports spooled events before the first poll', async () => {
    await seed(async (store) => {
      addSession(store, await addProject(store), 's1', 'c0ffee00-0000-4000-8000-000000000001');
    });
    mkdirSync(paths.spoolDir, { recursive: true });
    const envelope = {
      v: 1,
      id: 'env-spooled-0001',
      at: new Date().toISOString(),
      mode: 'hook',
      hook: 'Stop',
      sessionId: 'c0ffee00-0000-4000-8000-000000000001',
      cwd: null,
      fields: {},
    };
    writeFileSync(paths.spoolFile, `${JSON.stringify(envelope)}\n`);

    let store: Store | null = null;
    let seenAtFirstPoll: boolean | null = null;
    const adapter = realAdapter();
    await start({
      openStore: (file) => (store = openStore(file)),
      adapter: {
        ...adapter,
        list: () => {
          seenAtFirstPoll ??= store?.has('env-spooled-0001') ?? false;
          return adapter.list();
        },
      },
    });
    expect(seenAtFirstPoll).toBe(true);
    expect(existsSync(paths.spoolFile) ? readFileSync(paths.spoolFile, 'utf8') : '').toBe('');
  });

  it('marks sessions missing from agents as stopped', async () => {
    await seed(async (store) => {
      addSession(store, await addProject(store), 's1', 'c0ffee00-0000-4000-8000-000000000002');
    });
    const app = await start();
    expect(app.ctx.sessionView('s1')?.state).toBe('stopped');
    expect(app.ctx.snapshot().status.agentsReachable).toBe(true);
    expect(app.ctx.snapshot().status.cli).toEqual(CLI_OK);
  });

  it('continues a pending start from its next step', async () => {
    const requestId = 'request-continue-01';
    await seed(async (store) => {
      const projectId = await addProject(store);
      void crashingService(store, 'copyIntoWorktree').start(startInput(projectId, requestId));
      await untilStep(store, requestId, 'worktree');
    });
    expect(bgCalls()).toHaveLength(0);

    const app = await start();
    const action = app.actions.get(requestId);
    expect(action?.status).toBe('done');
    expect(action?.attempts).toBe(2);
    expect(action?.steps.filter((s) => s.name === 'worktree')).toHaveLength(1);
    expect(action?.steps.map((s) => s.name)).toContain('copy');
    expect(bgCalls()).toHaveLength(1);
    const sessionId = (action?.result as { sessionId: string }).sessionId;
    expect(getSession(app.store.db, sessionId)?.claudeSessionId).not.toBeNull();
    expect(getSessionState(app.store.db, sessionId)?.starting).toBe(false);
    expect(app.ctx.sessionView(sessionId)?.state).not.toBe('failed');
  });

  it('gives up after two interrupted starts', async () => {
    const requestId = 'request-giveup-001';
    await seed(async (store) => {
      const projectId = await addProject(store);
      void crashingService(store, 'createWorktree').start(startInput(projectId, requestId));
      await untilStep(store, requestId, 'base');
    });
    await seed(async (store) => {
      const projectId = 'acme-app';
      void crashingService(store, 'createWorktree').start(startInput(projectId, requestId));
      const until = Date.now() + 10_000;
      while ((createActionRunner(store, clock).get(requestId)?.attempts ?? 0) < 2) {
        if (Date.now() > until) throw new Error('second attempt did not begin');
        await sleep(25);
      }
    });

    const app = await start();
    const action = app.actions.get(requestId);
    expect(action?.status).toBe('failed');
    expect(action?.error).toBe('Start was interrupted twice');
    const [session] = app.ctx.snapshot().sessions;
    expect(session?.state).toBe('failed');
    expect(session?.stateReason).toBe('Start was interrupted twice');
    expect(getSessionState(app.store.db, session?.id ?? '')?.starting).toBe(false);
    expect(bgCalls()).toHaveLength(0);
  });

  it('rewrites settings files for live sessions', async () => {
    await seed(async (store) => {
      addSession(store, await addProject(store), 's1', 'c0ffee00-0000-4000-8000-000000000003');
    });
    const files = sessionFiles(paths, 's1');
    mkdirSync(files.dir, { recursive: true });
    writeFileSync(files.settings, '{"stale": true}\n');
    await start();
    const settings = JSON.parse(readFileSync(files.settings, 'utf8')) as {
      statusLine: { command: string };
      hooks: Record<string, unknown>;
    };
    expect(settings.statusLine.command).toContain(paths.launcher.replace(/\\/g, '/'));
    expect(Object.keys(settings.hooks)).toContain('SessionStart');
    expect(readFileSync(files.systemPrompt, 'utf8')).toContain('orch/s1');
    expect(existsSync(paths.launcher)).toBe(true);
  });

  it('sets ready only at the end', async () => {
    const steps: [string, boolean][] = [];
    const app = await start({
      onStep: (step, view) => steps.push([step, view.snapshot().ready]),
    });
    expect(steps.map(([step]) => step)).toEqual([...STARTUP_STEPS]);
    expect(steps.slice(0, -1).every(([, ready]) => !ready)).toBe(true);
    expect(steps.at(-1)).toEqual(['ready', true]);
    expect(app.ctx.snapshot().ready).toBe(true);
  });
});
