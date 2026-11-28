// Sessions: start, open, stop, remove and reveal (spec sections 3, 4 and 8). Start, open, stop
// and remove are logged actions: the decision is in the event log before git or Claude Code
// runs, every finished step is logged with its result, and a repeat with the same action id
// continues at the first step without one. Calls are serialized per action and per session, so
// two requests never run the same side effect twice (ActionRunner.step has no in-flight guard).
//
// The service never writes `session.state` itself: the state tracker does, through
// onStartBegun, onProcessStarted, onStartFailed and clearStarting.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import {
  STILL_STARTING_MESSAGE,
  type AppStatus,
  type SessionMode,
  type SessionView,
  type StreamMessage,
} from '../../shared/api-types';
import { MIN_CLAUDE_VERSION } from '../../shared/claude-version';
import { validateTaskName } from '../../shared/task-name';
import type { AgentAdapter, SessionRef, TerminalSize } from '../adapter/agent-adapter';
import type { TerminalRegistry } from '../adapter/terminals';
import { HttpError } from '../api/router';
import type { BuildingBlock } from '../base-setup/building-blocks';
import {
  DEFAULT_SSH_DENY,
  writeSessionFiles,
  type HookInvocation,
  type SessionFilesInput,
} from '../base-setup/settings';
import { filterByCwd, type AgentEntry } from '../claude/agents';
import { cleanEnv } from '../child-env';
import { sessionFiles, type DataPaths } from '../data-folder';
import * as worktrees from '../git/worktrees';
import { projectConfigSchema, type ProjectConfig } from '../projects/project-config';
import type { LastStart } from '../projects/project-service';
import type { ActionRecord, ActionRunner } from '../store/actions';
import type { Store } from '../store/event-log';
import {
  getSession,
  getSessionState,
  listProjects,
  listSessions,
  type SessionRow,
} from '../store/projections';
import type { StateTracker } from './state-tracker';

export interface StartSessionInput {
  projectId: string;
  task: string;
  branch: string;
  base: 'remote' | 'local';
  prompt: string | null;
  model: string | null;
  effort: string | null;
  mode: SessionMode;
  requestId: string;
}

export type RevealTarget = 'explorer' | 'vscode';

/** The git operations the service uses; tests replace single ones. */
export interface GitOps {
  checkNewWorktree: typeof worktrees.checkNewWorktree;
  ensureWorktreesExcluded: typeof worktrees.ensureWorktreesExcluded;
  resolveBase: typeof worktrees.resolveBase;
  createWorktree: typeof worktrees.createWorktree;
  copyIntoWorktree: typeof worktrees.copyIntoWorktree;
  worktreeIsClean: typeof worktrees.worktreeIsClean;
  removeWorktree: typeof worktrees.removeWorktree;
}

/** Electron's shell, as far as the service needs it. */
export interface ShellOps {
  /** Resolves with an error text, or '' on success (shell.openPath). */
  openPath(path: string): Promise<string>;
  openExternal(url: string): Promise<void>;
}

export interface SessionServiceDeps {
  paths: DataPaths;
  store: Store;
  actions: ActionRunner;
  adapter: AgentAdapter;
  terminals: TerminalRegistry;
  tracker: StateTracker;
  rememberStart: (projectId: string, lastStart: LastStart) => Promise<void>;
  clock: () => string;
  now: () => number;
  /** The workflow instruction building block, loaded for each start. */
  instruction: () => BuildingBlock;
  /** How hooks call the launcher in bin\ (hookInvocation). */
  launcher: () => HookInvocation;
  /** The deny rule for the user's SSH key folder; defaults to the check T5 form. */
  denyHomeSsh?: string;
  cliStatus: () => AppStatus['cli'];
  publish: (message: StreamMessage) => void;
  sessionView: (sessionId: string) => SessionView | undefined;
  shell: ShellOps;
  /** True when `where code` finds VS Code; defaults to running `where code`. */
  whereCode?: () => Promise<boolean>;
  git?: Partial<GitOps>;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

export interface SessionService {
  /** Starts a session; idempotent by action id (default: the request id). */
  start(input: StartSessionInput, actionId?: string): Promise<SessionView>;
  /** Resumes a stopped or failed session first, then opens (or returns) its attach terminal. */
  open(sessionId: string, size: TerminalSize): Promise<{ terminalId: string }>;
  stop(sessionId: string): Promise<void>;
  /** Stops the session, closes its terminal and removes its clean worktree; the branch stays. */
  remove(sessionId: string, confirm: true): Promise<void>;
  reveal(sessionId: string, target: RevealTarget): Promise<void>;
  vscodeAvailable(): Promise<boolean>;
  /** Writes the settings and system prompt file of every stored session again (app start). */
  rewriteSessionFiles(): Promise<void>;
  /** Continues or ends the session actions a crash left pending (restart sequence). */
  resumePending(): Promise<void>;
}

/** What the `validate` step decides once; a resumed start reads it from the log. */
interface StartPlan {
  sessionId: string;
  projectId: string;
  root: string;
  task: string;
  branch: string;
  worktree: string;
  remote: string | null;
  defaultBranch: string;
}

interface StartedIds {
  claudeSessionId: string;
  shortId: string;
  processStartedAt: string;
  adopted: boolean;
}

interface SessionParams {
  sessionId: string;
}

export const MAX_START_ATTEMPTS = 2;
export const INTERRUPTED_TWICE = 'Start was interrupted twice';
const NEVER_STARTED = 'This session never started; remove it and start again';
const STILL_STARTING = STILL_STARTING_MESSAGE;
const BUSY_RETRY_MS = 250;
const BUSY_RETRY_TRIES = 20;
const WHERE_TIMEOUT_MS = 5_000;

const defaultGit: GitOps = {
  checkNewWorktree: worktrees.checkNewWorktree,
  ensureWorktreesExcluded: worktrees.ensureWorktreesExcluded,
  resolveBase: worktrees.resolveBase,
  createWorktree: worktrees.createWorktree,
  copyIntoWorktree: worktrees.copyIntoWorktree,
  worktreeIsClean: worktrees.worktreeIsClean,
  removeWorktree: worktrees.removeWorktree,
};

function whereCode(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'where',
      ['code'],
      { env: cleanEnv(), windowsHide: true, timeout: WHERE_TIMEOUT_MS },
      (error) => {
        resolve(error === null);
      },
    );
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The remote the base is fetched from: origin when there is one, else the first. */
function baseRemote(config: ProjectConfig): string | null {
  return (config.remotes.find((r) => r.name === 'origin') ?? config.remotes[0])?.name ?? null;
}

export function createSessionService(deps: SessionServiceDeps): SessionService {
  const { paths, store, actions, adapter, terminals, tracker, clock, now } = deps;
  const db = store.db;
  const git: GitOps = { ...defaultGit, ...deps.git };
  const sleep =
    deps.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));
  const log = (text: string): void => deps.log?.(text);

  // One chain per key: an action id, a session id, or 'start' for validate-and-begin.
  const chains = new Map<string, Promise<unknown>>();
  const serialize = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const previous = chains.get(key) ?? Promise.resolve();
    const next = previous.then(run, run);
    const settled = next.catch(() => undefined);
    chains.set(key, settled);
    void settled.then(() => {
      if (chains.get(key) === settled) chains.delete(key);
    });
    return next;
  };

  const projectConfig = (projectId: string): ProjectConfig => {
    const row = listProjects(db).find((p) => p.id === projectId);
    if (!row) throw new HttpError(404, 'This project does not exist.', 'projectId');
    const parsed = projectConfigSchema.safeParse(row.config);
    if (!parsed.success) throw new HttpError(500, 'The project config is damaged.');
    return parsed.data;
  };

  const findSession = (sessionId: string): SessionRow => {
    const row = getSession(db, sessionId);
    if (!row) throw new HttpError(404, 'This session does not exist.');
    return row;
  };

  const view = (sessionId: string): SessionView => {
    const found = deps.sessionView(sessionId);
    if (!found) throw new HttpError(404, 'This session does not exist.');
    return found;
  };

  const planOf = (record: ActionRecord): StartPlan | undefined =>
    record.steps.find((s) => s.name === 'validate')?.result as StartPlan | undefined;

  /** The pending start or open action of a session, if any. */
  const pendingFor = (sessionId: string): ActionRecord | undefined =>
    actions.pending().find((record) => {
      if (record.kind === 'session.start') return planOf(record)?.sessionId === sessionId;
      if (record.kind === 'session.open') {
        return (record.params as SessionParams).sessionId === sessionId;
      }
      return false;
    });

  const makePlan = (input: StartSessionInput, sessionId: string): StartPlan => {
    const config = projectConfig(input.projectId);
    return {
      sessionId,
      projectId: input.projectId,
      root: config.path,
      task: input.task,
      branch: input.branch,
      worktree: worktrees.worktreePath(config.path, input.task),
      remote: baseRemote(config),
      defaultBranch: config.defaultBranch,
    };
  };

  /** Checks a new start before anything is logged; throws 4xx with the field. */
  const validateNew = async (input: StartSessionInput): Promise<StartPlan> => {
    const cli = deps.cliStatus();
    if (!cli.supported) {
      throw new HttpError(
        409,
        cli.found
          ? `Claude Code ${MIN_CLAUDE_VERSION} or newer is needed. Update it with: claude update`
          : 'Claude Code was not found. Install it, then restart Orchtopus.',
      );
    }
    const plan = makePlan(input, randomUUID());
    const nameError = validateTaskName(input.task);
    if (nameError !== null) throw new HttpError(422, nameError, 'task');
    const taken = `A session named ${input.task} already exists. Pick another task name.`;
    if (listSessions(db).some((s) => s.projectId === input.projectId && s.task === input.task)) {
      throw new HttpError(422, taken, 'task');
    }
    for (const record of actions.pending()) {
      const params = record.params as Partial<StartSessionInput>;
      if (
        record.kind === 'session.start' &&
        params.projectId === input.projectId &&
        params.task === input.task
      ) {
        throw new HttpError(422, taken, 'task');
      }
    }
    if (existsSync(plan.worktree)) {
      throw new HttpError(
        422,
        `A worktree named ${input.task} already exists. Pick another task name.`,
        'task',
      );
    }
    // Name and folder are checked above, so what is left is about the branch.
    const branchError = await git.checkNewWorktree(plan.root, input.task, input.branch);
    if (branchError !== null) throw new HttpError(422, branchError, 'branch');
    return plan;
  };

  const sessionCreated = (plan: StartPlan, input: StartSessionInput): void => {
    store.append({
      id: `session:${plan.sessionId}:created`,
      type: 'session.created',
      at: clock(),
      projectId: plan.projectId,
      sessionId: plan.sessionId,
      payload: {
        task: plan.task,
        branch: plan.branch,
        worktreePath: plan.worktree,
        type: 'feature',
        mode: input.mode,
        model: input.model,
        effort: input.effort,
      },
    });
  };

  const filesInput = (config: ProjectConfig, branch: string): SessionFilesInput => ({
    launcher: deps.launcher(),
    remotes: config.remotes,
    projectName: config.name,
    denyHomeSsh: deps.denyHomeSsh ?? DEFAULT_SSH_DENY,
    instruction: deps.instruction(),
    branch,
    defaultBranch: config.defaultBranch,
  });

  /** Newest background entry in a folder, from the agents list. */
  const newestIn = (entries: readonly AgentEntry[], cwd: string): AgentEntry | undefined =>
    filterByCwd(entries, cwd)
      .filter((e) => e.kind === 'background' && e.sessionId !== null)
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];

  const runStart = async (actionId: string): Promise<SessionView> => {
    const record = actions.get(actionId);
    if (!record) throw new Error(`unknown action ${actionId}`);
    const input = record.params as StartSessionInput;
    let plan: StartPlan | undefined;
    let created = false;
    try {
      plan = await actions.step(actionId, 'validate', () =>
        Promise.resolve(makePlan(input, randomUUID())),
      );
      const p = plan;
      await actions.step(actionId, 'exclude', async () => {
        const result = await git.ensureWorktreesExcluded(p.root);
        if (typeof result === 'object') throw new HttpError(409, result.refused);
        return result;
      });
      const base = await actions.step(actionId, 'base', () =>
        git.resolveBase(p.root, p.remote, p.defaultBranch, input.base === 'local'),
      );
      if (base.fetchFailed) {
        const text = base.message ?? 'Fetching the default branch failed.';
        actions.finish(actionId, { fetchFailed: true, message: text });
        throw new HttpError(409, text, 'base');
      }
      // Logged before git worktree add runs; the session shows "Starting" from here on.
      sessionCreated(p, input);
      created = true;
      tracker.onStartBegun(p.sessionId);
      await actions.step(actionId, 'worktree', () =>
        git.createWorktree({ root: p.root, task: p.task, branch: p.branch, base: base.base }),
      );
      const config = projectConfig(p.projectId);
      const copy = await actions.step(actionId, 'copy', () =>
        git.copyIntoWorktree(p.root, p.worktree, config.copyList),
      );
      const files = await actions.step(actionId, 'files', () =>
        writeSessionFiles(paths, p.sessionId, filesInput(config, p.branch)),
      );
      // A crash between claude --bg and its log entry: the session is found by its folder and
      // adopted, so a resume never starts a second one. Checked once per attempt.
      const attempt = actions.get(actionId)?.attempts ?? 1;
      const found = await actions.step(actionId, `takeover-check-${String(attempt)}`, async () => {
        let entries: AgentEntry[];
        try {
          entries = await adapter.list();
        } catch (error) {
          if (attempt > 1) {
            throw new Error('Claude Code is not reachable. Try again.', { cause: error });
          }
          log(`Agents list before the start failed: ${message(error)}`);
          return null;
        }
        const entry = newestIn(entries, p.worktree);
        if (entry?.sessionId == null) return null;
        return {
          claudeSessionId: entry.sessionId,
          shortId: entry.id,
          processStartedAt: new Date(entry.startedAt ?? now()).toISOString(),
          adopted: true,
        } satisfies StartedIds;
      });
      const ids = await actions.step(actionId, 'claude-bg', async (): Promise<StartedIds> => {
        if (found !== null) return found;
        // The spawn time, so a first prompt can never predate the process start.
        const spawnedAt = now();
        const started = await adapter.start({
          cwd: p.worktree,
          settingsFile: files.settings,
          systemPromptFile: files.systemPrompt,
          name: p.task,
          mode: input.mode,
          model: input.model,
          effort: input.effort,
          prompt: input.prompt,
          agentsJson: null,
          pluginDirs: [],
        });
        return {
          claudeSessionId: started.sessionId,
          shortId: started.shortId,
          processStartedAt: new Date(spawnedAt).toISOString(),
          adopted: false,
        };
      });
      await actions.step(actionId, 'record', () => {
        store.append({
          id: `session:${p.sessionId}:started:${actionId}`,
          type: 'session.started',
          at: clock(),
          projectId: p.projectId,
          sessionId: p.sessionId,
          payload: {
            claudeSessionId: ids.claudeSessionId,
            shortId: ids.shortId,
            processStartedAt: ids.processStartedAt,
          },
        });
        return Promise.resolve(true);
      });
      tracker.onProcessStarted(p.sessionId);
      try {
        await deps.rememberStart(p.projectId, {
          model: input.model,
          effort: input.effort,
          mode: input.mode,
        });
      } catch (error) {
        log(`Could not remember the start values: ${message(error)}`);
      }
      const hints = copy.missing.map((entry) => `${entry} was not found in the main folder.`);
      actions.finish(actionId, { sessionId: p.sessionId, hints });
      return view(p.sessionId);
    } catch (error) {
      const text = message(error);
      if (actions.get(actionId)?.status === 'pending') actions.fail(actionId, text);
      if (created && plan !== undefined) {
        // The worktree stays; the session shows the reason until it is removed.
        tracker.onStartFailed(plan.sessionId, text);
        return view(plan.sessionId);
      }
      if (error instanceof HttpError) throw error;
      throw new HttpError(409, text);
    }
  };

  /** A start whose action is already finished or failed: answer as the first time. */
  const answerFinished = (record: ActionRecord): SessionView => {
    const result = record.result as { sessionId?: string; fetchFailed?: boolean; message?: string };
    if (record.status === 'done') {
      if (result.fetchFailed === true) {
        throw new HttpError(409, result.message ?? 'Fetching the default branch failed.', 'base');
      }
      if (result.sessionId !== undefined) return view(result.sessionId);
    }
    const sessionId = planOf(record)?.sessionId;
    if (sessionId !== undefined && getSession(db, sessionId)) return view(sessionId);
    throw new HttpError(409, record.error ?? 'This request failed before.');
  };

  const start = (input: StartSessionInput, actionId: string = input.requestId) =>
    serialize(`action:${actionId}`, async () => {
      const existing = actions.get(actionId);
      if (existing && existing.status !== 'pending') return answerFinished(existing);
      if (existing) {
        actions.begin('session.start', existing.params, actionId);
      } else {
        // Validate and begin one at a time, so two starts cannot take the same task name.
        await serialize('start', async () => {
          const plan = await validateNew(input);
          const params: StartSessionInput = { ...input };
          actions.begin('session.start', params, actionId);
          await actions.step(actionId, 'validate', () => Promise.resolve(plan));
        });
      }
      return runStart(actionId);
    });

  const refOf = (row: SessionRow): SessionRef => {
    if (row.claudeSessionId === null || row.shortId === null) {
      throw new HttpError(409, NEVER_STARTED);
    }
    return { sessionId: row.claudeSessionId, shortId: row.shortId, cwd: row.worktreePath };
  };

  const runResume = async (actionId: string, row: SessionRow): Promise<void> => {
    const ref = refOf(row);
    tracker.onStartBegun(row.id);
    try {
      const resumed = await actions.step(actionId, 'resume', async () => {
        const spawnedAt = now();
        await adapter.resume(ref);
        // The agents list may show a new short id for the resumed process.
        let shortId = ref.shortId;
        try {
          const entry = (await adapter.list())
            .filter((e) => e.sessionId === ref.sessionId)
            .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
          if (entry) shortId = entry.id;
        } catch {
          // Keep the stored short id; the poller corrects it later.
        }
        return { shortId, processStartedAt: new Date(spawnedAt).toISOString() };
      });
      store.append({
        id: `session:${row.id}:started:${actionId}`,
        type: 'session.started',
        at: clock(),
        projectId: row.projectId,
        sessionId: row.id,
        payload: {
          claudeSessionId: ref.sessionId,
          shortId: resumed.shortId,
          processStartedAt: resumed.processStartedAt,
        },
      });
      tracker.onProcessStarted(row.id);
      actions.finish(actionId, null);
    } catch (error) {
      const text = message(error);
      if (actions.get(actionId)?.status === 'pending') actions.fail(actionId, text);
      tracker.onStartFailed(row.id, text);
      throw new HttpError(409, text);
    }
  };

  const open = (sessionId: string, size: TerminalSize) =>
    serialize(`session:${sessionId}`, async () => {
      findSession(sessionId);
      // A start that runs in this process: wait for it, so a session selected right after its
      // row appears opens without a 409. A pending start that is not running still answers 409.
      const pending = pendingFor(sessionId);
      if (pending?.kind === 'session.start') await chains.get(`action:${pending.id}`);
      if (pendingFor(sessionId)) throw new HttpError(409, STILL_STARTING);
      let row = findSession(sessionId);
      refOf(row);
      const word = getSessionState(db, sessionId)?.word;
      if (word === 'stopped' || word === 'failed') {
        // The process is gone, so any attach PTY left from it is dead even if its exit has
        // not been reported yet; the resumed process gets a fresh one.
        await terminals.closeSession(sessionId);
        const params: SessionParams = { sessionId };
        const record = actions.begin('session.open', params);
        await runResume(record.id, row);
        row = findSession(sessionId);
      }
      const terminalId = await terminals.openForSession(sessionId, refOf(row), size);
      return { terminalId };
    });

  const runStop = async (actionId: string, row: SessionRow): Promise<void> => {
    try {
      await actions.step(actionId, 'stop', async () => {
        if (row.shortId !== null) {
          await adapter.stop({
            sessionId: row.claudeSessionId ?? row.shortId,
            shortId: row.shortId,
            cwd: row.worktreePath,
          });
        }
        return true;
      });
      actions.finish(actionId, null);
    } catch (error) {
      const text = message(error);
      if (actions.get(actionId)?.status === 'pending') actions.fail(actionId, text);
      throw new HttpError(409, text);
    }
  };

  const stop = (sessionId: string) =>
    serialize(`session:${sessionId}`, async () => {
      const row = findSession(sessionId);
      if (pendingFor(sessionId)) throw new HttpError(409, STILL_STARTING);
      const params: SessionParams = { sessionId };
      await runStop(actions.begin('session.stop', params).id, row);
    });

  /** removeWorktree, retried while Windows still holds the folder (a PTY that just ended). */
  const removeFolder = async (root: string, path: string) => {
    for (let attempt = 1; ; attempt += 1) {
      const result = await git.removeWorktree(root, path);
      const busy = typeof result === 'object' && result.refused.startsWith('Windows could not');
      if (!busy || attempt >= BUSY_RETRY_TRIES) return result;
      await sleep(BUSY_RETRY_MS);
    }
  };

  const runRemove = async (actionId: string, row: SessionRow): Promise<void> => {
    try {
      const word = getSessionState(db, row.id)?.word;
      await actions.step(actionId, 'stop', async () => {
        if (row.shortId === null || word === 'stopped') return 'skipped';
        try {
          await adapter.stop({
            sessionId: row.claudeSessionId ?? row.shortId,
            shortId: row.shortId,
            cwd: row.worktreePath,
          });
        } catch (error) {
          // A failed session may have no process left to stop.
          if (word !== 'failed') throw error;
        }
        return 'stopped';
      });
      // The attached PTY runs in the worktree; end it before the folder goes.
      await terminals.closeSession(row.id);
      const project = listProjects(db).find((p) => p.id === row.projectId);
      await actions.step(actionId, 'worktree', async () => {
        if (!project) return 'no-project';
        const result = await removeFolder(project.path, row.worktreePath);
        if (typeof result === 'object') throw new HttpError(409, result.refused);
        return result;
      });
      store.append({
        id: `session:${row.id}:removed`,
        type: 'session.removed',
        at: clock(),
        projectId: row.projectId,
        sessionId: row.id,
        payload: {},
      });
      await rm(sessionFiles(paths, row.id).dir, { recursive: true, force: true }).catch(
        (error: unknown) => {
          log(`Could not delete the session files of ${row.id}: ${message(error)}`);
        },
      );
      actions.finish(actionId, null);
      deps.publish({ v: 1, kind: 'session-removed', sessionId: row.id });
    } catch (error) {
      const text = message(error);
      if (actions.get(actionId)?.status === 'pending') actions.fail(actionId, text);
      if (error instanceof HttpError) throw error;
      throw new HttpError(409, text);
    }
  };

  // `confirm: true` is checked by the route schema and logged with the action.
  const remove = (sessionId: string, confirm: true) =>
    serialize(`session:${sessionId}`, async () => {
      const row = findSession(sessionId);
      if (pendingFor(sessionId)) throw new HttpError(409, STILL_STARTING);
      // Refuse before anything is stopped, so a dirty worktree keeps its running session.
      if (existsSync(row.worktreePath) && !(await git.worktreeIsClean(row.worktreePath))) {
        throw new HttpError(
          409,
          'The worktree has uncommitted changes or untracked files. Commit or remove them first.',
        );
      }
      const params: SessionParams & { confirm: true } = { sessionId, confirm };
      await runRemove(actions.begin('session.remove', params).id, row);
    });

  let vscode: Promise<boolean> | null = null;
  const vscodeAvailable = (): Promise<boolean> => {
    vscode ??= (deps.whereCode ?? whereCode)().catch(() => false);
    return vscode;
  };

  const reveal = async (sessionId: string, target: RevealTarget): Promise<void> => {
    const row = findSession(sessionId);
    if (target === 'explorer') {
      const error = await deps.shell.openPath(row.worktreePath);
      if (error !== '') throw new HttpError(409, error);
      return;
    }
    if (!(await vscodeAvailable())) throw new HttpError(409, 'VS Code was not found.');
    await deps.shell.openExternal(
      `vscode://file/${encodeURI(row.worktreePath.replace(/\\/g, '/'))}`,
    );
  };

  const rewriteSessionFiles = async (): Promise<void> => {
    for (const row of listSessions(db)) {
      try {
        await writeSessionFiles(
          paths,
          row.id,
          filesInput(projectConfig(row.projectId), row.branch),
        );
      } catch (error) {
        log(`Could not rewrite the session files of ${row.id}: ${message(error)}`);
      }
    }
  };

  const resumeOne = async (record: ActionRecord): Promise<void> => {
    switch (record.kind) {
      case 'session.start': {
        if (record.attempts >= MAX_START_ATTEMPTS) {
          actions.fail(record.id, INTERRUPTED_TWICE);
          const sessionId = planOf(record)?.sessionId;
          if (sessionId !== undefined) tracker.onStartFailed(sessionId, INTERRUPTED_TWICE);
          return;
        }
        await start(record.params as StartSessionInput, record.id);
        return;
      }
      case 'session.open': {
        // A resume cut off by a crash: the user opens the session again; the poll decides.
        const { sessionId } = record.params as SessionParams;
        actions.fail(record.id, 'Open was interrupted');
        tracker.clearStarting(sessionId);
        return;
      }
      case 'session.stop':
      case 'session.remove': {
        const { sessionId } = record.params as SessionParams;
        const row = getSession(db, sessionId);
        if (!row) {
          actions.finish(record.id, null);
          return;
        }
        await serialize(`session:${sessionId}`, async () => {
          actions.begin(record.kind, record.params, record.id);
          if (record.kind === 'session.stop') await runStop(record.id, row);
          else await runRemove(record.id, row);
        });
        return;
      }
      default:
        return;
    }
  };

  const resumePending = async (): Promise<void> => {
    for (const record of actions.pending()) {
      if (!record.kind.startsWith('session.')) continue;
      try {
        await resumeOne(record);
      } catch (error) {
        log(`Could not continue ${record.kind} ${record.id}: ${message(error)}`);
      }
    }
    // A start flag that no pending action backs (for example a crash right after a give-up).
    for (const row of listSessions(db)) {
      if (getSessionState(db, row.id)?.starting && !pendingFor(row.id)) {
        tracker.clearStarting(row.id);
      }
    }
  };

  return {
    start,
    open,
    stop,
    remove,
    reveal,
    vscodeAvailable,
    rewriteSessionFiles,
    resumePending,
  };
}
