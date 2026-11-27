// What the main process shares between its parts: data paths, the store, the app status and
// the views the API serves. Later tasks (terminals, tracker, startup) update status, ready and
// terminal state through it; `publish` forwards to the event stream once the API is up.
import type { DataPaths } from './data-folder';
import type { Store } from './store/event-log';
import {
  getSession,
  getSessionState,
  listProjects,
  listSessions,
  type ProjectRow,
  type SessionRow,
  type SessionStateRow,
} from './store/projections';
import type {
  AppSnapshot,
  AppStatus,
  ProjectView,
  SessionView,
  StreamMessage,
  TerminalStatus,
} from '../shared/api-types';
import { initialClientState } from '../shared/client-state';

export interface TerminalState {
  id: string | null;
  status: TerminalStatus;
}

export interface AppContext {
  paths: DataPaths;
  store: Store;
  // Function properties, so they can be passed on without binding.
  snapshot: () => AppSnapshot;
  sessionView: (sessionId: string) => SessionView | undefined;
  /** Sets `ready` and publishes a status message. */
  setReady: (ready: boolean) => void;
  /** Merges into the app status and publishes a status message. */
  setStatus: (change: Partial<AppStatus>) => void;
  /** Records a session's terminal state (kept in memory) and publishes the session. */
  setTerminal: (sessionId: string, terminal: TerminalState) => void;
  /** Sends a message to every event stream; does nothing before the API is attached. */
  publish: (message: StreamMessage) => void;
  attachPublisher: (publish: (message: StreamMessage) => void) => void;
}

const NO_TERMINAL: TerminalState = { id: null, status: 'none' };

/**
 * A project row as a view: the stored project.json fields without `schemaVersion`, with id,
 * name and path from the row.
 */
export function toProjectView(row: ProjectRow): ProjectView {
  const config =
    typeof row.config === 'object' && row.config !== null
      ? (row.config as Record<string, unknown>)
      : {};
  const fields = { ...config };
  delete fields['schemaVersion'];
  return { ...(fields as unknown as ProjectView), id: row.id, name: row.name, path: row.path };
}

/**
 * A session row and its state as a view. A session without a state word yet shows idle;
 * the reason falls back to the start failure text.
 */
export function toSessionView(
  row: SessionRow,
  state: SessionStateRow | undefined,
  terminal: TerminalState = NO_TERMINAL,
): SessionView {
  return {
    id: row.id,
    projectId: row.projectId,
    task: row.task,
    branch: row.branch,
    worktreePath: row.worktreePath,
    type: row.type,
    state: state?.word ?? 'idle',
    stateReason: state?.reason ?? state?.startFailed ?? null,
    contextPct: state?.contextPct ?? null,
    mode: row.mode === 'auto' ? 'auto' : 'manual',
    model: row.model,
    effort: row.effort,
    terminal: { ...terminal },
    createdAt: row.createdAt,
  };
}

export function createAppContext(deps: { paths: DataPaths; store: Store }): AppContext {
  const { paths, store } = deps;
  const initial = initialClientState();
  let ready = initial.ready;
  let status: AppStatus = initial.status;
  const terminals = new Map<string, TerminalState>();
  let publisher: ((message: StreamMessage) => void) | null = null;

  const publish = (message: StreamMessage): void => {
    publisher?.(message);
  };
  const sessionView = (sessionId: string): SessionView | undefined => {
    const row = getSession(store.db, sessionId);
    if (!row) return undefined;
    return toSessionView(row, getSessionState(store.db, sessionId), terminals.get(sessionId));
  };
  const publishStatus = (): void => {
    publish({ v: 1, kind: 'status', status, ready });
  };

  return {
    paths,
    store,
    snapshot: () => ({
      ready,
      status: { ...status, cli: { ...status.cli } },
      projects: listProjects(store.db).map(toProjectView),
      sessions: listSessions(store.db).map((row) =>
        toSessionView(row, getSessionState(store.db, row.id), terminals.get(row.id)),
      ),
    }),
    sessionView,
    setReady: (value) => {
      ready = value;
      publishStatus();
    },
    setStatus: (change) => {
      status = { ...status, ...change };
      publishStatus();
    },
    setTerminal: (sessionId, terminal) => {
      terminals.set(sessionId, { ...terminal });
      const view = sessionView(sessionId);
      if (view) publish({ v: 1, kind: 'session', session: view });
    },
    publish,
    attachPublisher: (next) => {
      publisher = next;
    },
  };
}
