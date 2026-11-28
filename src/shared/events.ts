// Event types of the append-only event log and their payloads.
// The log is the source of truth; the tables in src/main/store/projections.ts are derived from it.

/** Kinds of logged actions (src/main/store/actions.ts). */
export type ActionKind =
  | 'project.add'
  | 'project.remove'
  | 'session.start'
  | 'session.open'
  | 'session.stop'
  | 'session.remove';

/** The state words of the session list (spec section 6). */
export type StateWord = 'running' | 'needs-you' | 'idle' | 'stopped' | 'failed';

/** Session types. M1 only creates feature sessions. */
export type SessionType = 'feature';

export interface ProjectAddedPayload {
  name: string;
  path: string;
  /** The project config as written to project.json. */
  config: unknown;
}

export interface ProjectUpdatedPayload {
  name?: string;
  path?: string;
  config?: unknown;
}

export type ProjectRemovedPayload = Record<string, never>;

export interface SessionCreatedPayload {
  task: string;
  branch: string;
  worktreePath: string;
  type?: SessionType;
  mode: string;
  model: string | null;
  effort: string | null;
}

/** A Claude Code process was started (first start, or a resume). */
export interface SessionStartedPayload {
  claudeSessionId: string | null;
  shortId: string | null;
  /** When the process started. Defaults to the event time. */
  processStartedAt?: string;
}

/** One entry from `claude agents --json`, or null when the session is missing from it. */
export interface SessionObservedPayload {
  observed: unknown;
  claudeSessionId?: string;
  shortId?: string;
}

export interface SessionStatePayload {
  word: StateWord;
  reason?: string | null;
  /** Set when the start failed; the reason shown in the session header. */
  startFailed?: string | null;
  /** Set when a start or resume begins (true) or ends; kept in session_state.starting. */
  starting?: boolean;
}

export type SessionRemovedPayload = Record<string, never>;

export interface HookReceivedPayload {
  hookEventName: string;
  /** Hook payload fields the app needs. */
  data?: unknown;
}

export interface StatuslineReceivedPayload {
  /** Context fill in percent, or null when unknown. */
  contextPct?: number | null;
  rateLimits?: unknown;
  /** Model id from the status line, or null when unknown. */
  model?: string | null;
}

export interface ActionStartedPayload {
  actionId: string;
  kind: ActionKind;
  params: unknown;
}

export interface ActionStepPayload {
  actionId: string;
  name: string;
  result: unknown;
}

export interface ActionFinishedPayload {
  actionId: string;
  result: unknown;
}

export interface ActionFailedPayload {
  actionId: string;
  error: string;
}

export interface SpoolDamagedPayload {
  /** File in spool\damaged\ that keeps the line. */
  file: string;
  /** Line in that file, when the event is about one line. An import reports all at once. */
  line?: number;
  reason: string;
  /** Number of damaged lines kept in that file by one import. */
  count?: number;
}

/** Maps every event type to its payload. */
export interface EventPayloads {
  'project.added': ProjectAddedPayload;
  'project.updated': ProjectUpdatedPayload;
  'project.removed': ProjectRemovedPayload;
  'session.created': SessionCreatedPayload;
  'session.started': SessionStartedPayload;
  'session.observed': SessionObservedPayload;
  'session.state': SessionStatePayload;
  'session.removed': SessionRemovedPayload;
  'hook.received': HookReceivedPayload;
  'statusline.received': StatuslineReceivedPayload;
  'action.started': ActionStartedPayload;
  'action.step': ActionStepPayload;
  'action.finished': ActionFinishedPayload;
  'action.failed': ActionFailedPayload;
  'spool.damaged': SpoolDamagedPayload;
}

export type EventType = keyof EventPayloads;
