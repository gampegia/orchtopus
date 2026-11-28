// The restart sequence (spec section 9): on every start, before the UI shows sessions, the app
// refreshes the hook files and session files, imports the spool, starts the local API, reads the
// agents list once, applies the state rules (sessions not found are stopped) and continues or
// ends the actions a crash left pending. Only then is the snapshot `ready`.
import type { AppSnapshot } from '../shared/api-types';
import type { AgentAdapter } from './adapter/agent-adapter';
import { AdapterError, StartError } from './adapter/agent-adapter';
import type { PtySpawn } from './adapter/attach-terminal';
import { createBackgroundAdapter } from './adapter/background-adapter';
import {
  createTerminalRegistry,
  createTerminalStreamHandler,
  type TerminalRegistry,
} from './adapter/terminals';
import { createCoreRoutes } from './api/routes/core';
import { createHookRoutes, setEnvelopeListener } from './api/routes/hooks';
import { createProjectRoutes } from './api/routes/projects';
import { createSessionRoutes } from './api/routes/sessions';
import { createTerminalRoutes } from './api/routes/terminals';
import { startApiServer, type ApiServer } from './api/server';
import { createAppContext, type AppContext } from './app-context';
import { loadBuildingBlock, WORKFLOW_INSTRUCTION } from './base-setup/building-blocks';
import { hookInvocation } from './base-setup/settings';
import { AgentsListError } from './claude/agents';
import type { ClaudeConfigPaths } from './claude/claude-home';
import { readClaudeVersion, type ClaudeCommand } from './claude/cli';
import type { DataPaths } from './data-folder';
import { installHookFiles, type HookFileSource } from './hooks/install';
import { createProjectService, type ProjectService } from './projects/project-service';
import { createAgentsPoller, type AgentsPoller } from './sessions/agents-poller';
import {
  createSessionService,
  type SessionService,
  type ShellOps,
} from './sessions/session-service';
import { POLL_INTERVAL_MS } from './sessions/timings';
import { createStateTracker, type StateTracker } from './sessions/state-tracker';
import { importSpool } from './spool/import';
import { tryStartupStep } from './startup-step';
import { createActionRunner, type ActionRunner } from './store/actions';
import { openStore, type Store } from './store/event-log';

/** The steps in the order they run; `onStep` is called after each one. */
export const STARTUP_STEPS = [
  'store',
  'hook-files',
  'session-files',
  'spool',
  'api',
  'spool-again',
  'claude-version',
  'poll',
  'tick',
  'resume',
  'poller',
  'ready',
] as const;

export type StartupStep = (typeof STARTUP_STEPS)[number];

export interface StartupDeps {
  paths: DataPaths;
  hookSource: HookFileSource;
  /** The claude command, or null when none was found. */
  claude: ClaudeCommand | null;
  /** Folder of the shipped building blocks (buildingBlocksDir). */
  buildingBlocksDir: string;
  claudePaths: ClaudeConfigPaths;
  env: Readonly<Record<string, string | undefined>>;
  appVersion: string;
  allowedOrigins: readonly string[];
  preferredPort: number;
  shell: ShellOps;
  log: (message: string) => void;
  whereCode?: () => Promise<boolean>;
  now?: () => number;
  pollIntervalMs?: number;
  /** Replaces the background adapter (tests). */
  adapter?: AgentAdapter;
  spawnPty?: PtySpawn;
  /** Replaces openStore (tests). */
  openStore?: (file: string) => Store;
  /** Called once the API listens, before the rest of the sequence (IPC, the window). */
  onApiReady?: (api: ApiServer) => void;
  onStep?: (step: StartupStep, app: { snapshot: () => AppSnapshot }) => void;
}

export interface RunningApp {
  ctx: AppContext;
  store: Store;
  actions: ActionRunner;
  api: ApiServer;
  tracker: StateTracker;
  poller: AgentsPoller;
  terminals: TerminalRegistry;
  projects: ProjectService;
  sessions: SessionService;
  /** Stops polling, ends the app's PTYs (sessions keep running), closes the API and the store. */
  close: () => Promise<void>;
}

const NOT_FOUND = 'Claude Code was not found.';

/** An adapter for a machine without claude: every call fails, so polls keep the last state. */
function missingClaudeAdapter(): AgentAdapter {
  return {
    start: () => Promise.reject(new StartError(NOT_FOUND)),
    list: () => Promise.reject(new AgentsListError('spawn', NOT_FOUND)),
    resume: () => Promise.reject(new AdapterError(NOT_FOUND)),
    stop: () => Promise.reject(new AdapterError(NOT_FOUND)),
    attach: () => Promise.reject(new AdapterError(NOT_FOUND)),
    openPlain: () => Promise.reject(new AdapterError(NOT_FOUND)),
  };
}

export async function runStartup(deps: StartupDeps): Promise<RunningApp> {
  const { paths, log } = deps;
  const now = deps.now ?? Date.now;
  const clock = (): string => new Date(now()).toISOString();

  const store = (deps.openStore ?? openStore)(paths.stateDb);
  const ctx = createAppContext({ paths, store });
  const step = (name: StartupStep): void => deps.onStep?.(name, { snapshot: ctx.snapshot });
  const actions = createActionRunner(store, clock);
  const adapter =
    deps.adapter ??
    (deps.claude === null
      ? missingClaudeAdapter()
      : createBackgroundAdapter({
          cmd: deps.claude,
          now,
          sleep: (ms) =>
            new Promise((resolve) => {
              setTimeout(resolve, ms);
            }),
          ...(deps.spawnPty === undefined ? {} : { spawnPty: deps.spawnPty }),
        }));
  const tracker = createStateTracker({
    store,
    publish: ctx.publish,
    now,
    setStatus: ctx.setStatus,
    sessionView: ctx.sessionView,
  });
  const terminals = createTerminalRegistry(adapter, { onStatus: ctx.setTerminal });
  const projects = createProjectService({
    paths,
    store,
    actions,
    clock,
    cliStatus: () => ctx.snapshot().status.cli,
    claudePaths: deps.claudePaths,
    env: deps.env,
    publish: ctx.publish,
    log,
  });
  const sessions = createSessionService({
    paths,
    store,
    actions,
    adapter,
    terminals,
    tracker,
    rememberStart: (projectId, lastStart) => projects.rememberStart(projectId, lastStart),
    clock,
    now,
    instruction: () => loadBuildingBlock(deps.buildingBlocksDir, WORKFLOW_INSTRUCTION),
    launcher: () => hookInvocation(paths),
    cliStatus: () => ctx.snapshot().status.cli,
    publish: ctx.publish,
    sessionView: ctx.sessionView,
    shell: deps.shell,
    ...(deps.whereCode === undefined ? {} : { whereCode: deps.whereCode }),
    log,
  });
  const poller = createAgentsPoller({
    list: () => adapter.list(),
    tracker,
    intervalMs: deps.pollIntervalMs ?? POLL_INTERVAL_MS,
  });
  // Hook envelopes update the session state at once.
  setEnvelopeListener(tracker.onEnvelope);
  step('store');

  // Hooks of running sessions call the launcher in bin\; a failure keeps the old one.
  await tryStartupStep('Hook file install', () => installHookFiles(paths, deps.hookSource), log);
  step('hook-files');
  await sessions.rewriteSessionFiles();
  step('session-files');

  let damaged = 0;
  const importOnce = async (): Promise<void> => {
    // A spool that cannot be imported now (locked file) waits for the next import.
    const result = await tryStartupStep('Spool import', () => importSpool(store, paths), log);
    if (result !== null && result.damaged > 0) {
      damaged += result.damaged;
      log(`Spool import kept ${String(result.damaged)} damaged lines`);
      ctx.setStatus({ spoolDamaged: damaged });
    }
  };
  await importOnce();
  step('spool');

  const api = await startApiServer({
    paths,
    preferredPort: deps.preferredPort,
    allowedOrigins: deps.allowedOrigins,
    routes: {
      ...createCoreRoutes({ appVersion: deps.appVersion, snapshot: ctx.snapshot }),
      ...createHookRoutes({ store, log }),
      ...createProjectRoutes({ service: projects }),
      ...createTerminalRoutes({ registry: terminals }),
      ...createSessionRoutes({ service: sessions }),
    },
    snapshot: ctx.snapshot,
    log,
  });
  api.registerTerminalStream(createTerminalStreamHandler(terminals));
  ctx.attachPublisher(api.publish);
  deps.onApiReady?.(api);
  step('api');
  // Helpers that spooled while the API was coming up.
  await importOnce();
  step('spool-again');

  const cli =
    deps.claude === null
      ? { found: false, version: null, supported: false }
      : { found: true, ...(await readClaudeVersion(deps.claude)) };
  ctx.setStatus({ cli });
  step('claude-version');
  void sessions.vscodeAvailable().then((available) => {
    ctx.setStatus({ vscodeAvailable: available });
  });

  await poller.pollNow();
  step('poll');
  tracker.tick();
  step('tick');
  await projects.resumePending();
  await sessions.resumePending();
  step('resume');
  poller.start();
  step('poller');
  ctx.setReady(true);
  step('ready');

  let closed = false;
  return {
    ctx,
    store,
    actions,
    api,
    tracker,
    poller,
    terminals,
    projects,
    sessions,
    close: async () => {
      if (closed) return;
      closed = true;
      poller.stop();
      setEnvelopeListener(null);
      terminals.closeAll();
      try {
        await api.close();
      } finally {
        store.close();
      }
    },
  };
}
