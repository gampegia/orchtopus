// Types of the local API (src/main/api): views, the app snapshot and the event stream messages.
// Shared by the main process and the renderer, so this file imports nothing from either.
//
// HTTP: every route is `/v1/...` on http://127.0.0.1:<port>, with `Authorization: Bearer <token>`.
// Bodies are JSON (`Content-Type: application/json`, at most 1 MiB). Errors are `ApiError`.
// Core routes: `GET /v1/health` → `HealthResponse`, `GET /v1/state` → `AppSnapshot`,
// `POST /v1/token/renew` → `TokenRenewResponse`.
//
// Streams (WebSocket on the same port, subprotocols `orchtopus.v1` and `orchtopus.token.<hex>`):
// `/v1/events` sends one `snapshot` message on connect, then `StreamMessage` items as JSON text.
// A stream opened with a token that was renewed is closed with `TOKEN_RENEWED_CLOSE_CODE`.

export const API_VERSION = 1;

/** WebSocket subprotocol that names the stream protocol version. */
export const STREAM_PROTOCOL = 'orchtopus.v1';

/** Prefix of the WebSocket subprotocol that carries the token. */
export const TOKEN_PROTOCOL_PREFIX = 'orchtopus.token.';

/** Close code for streams whose token was renewed; the client fetches the connection again. */
export const TOKEN_RENEWED_CLOSE_CODE = 4401;

/** The state words of the session list (spec section 6). */
export type SessionStateWord = 'running' | 'needs-you' | 'idle' | 'stopped' | 'failed';

export type SessionMode = 'auto' | 'manual';

export type TerminalStatus = 'none' | 'attaching' | 'attached' | 'elsewhere' | 'exited';

/** A git remote; the URL carries no credentials. */
export interface RemoteView {
  name: string;
  url: string;
}

export interface CheckCommandsView {
  test: string | null;
  lint: string | null;
  typecheck: string | null;
}

/** A project: the fields of its project.json without `schemaVersion`. */
export interface ProjectView {
  id: string;
  name: string;
  path: string;
  defaultBranch: string;
  remotes: RemoteView[];
  provider: 'github' | 'gitlab' | null;
  checkCommands: CheckCommandsView;
  copyList: string[];
  branchPrefix: string;
  lastStart: { model: string | null; effort: string | null; mode: SessionMode };
}

export interface SessionView {
  id: string;
  projectId: string;
  task: string;
  branch: string;
  worktreePath: string;
  type: 'feature';
  state: SessionStateWord;
  stateReason: string | null;
  contextPct: number | null;
  mode: SessionMode;
  model: string | null;
  effort: string | null;
  terminal: { id: string | null; status: TerminalStatus };
  createdAt: string;
}

export interface AppStatus {
  cli: { found: boolean; version: string | null; supported: boolean };
  agentsReachable: boolean;
  /** Damaged spool lines kept in spool\damaged\ and not yet dealt with. */
  spoolDamaged: number;
  vscodeAvailable: boolean;
}

export interface AppSnapshot {
  /** False until the restart sequence has finished; the UI shows no sessions before. */
  ready: boolean;
  status: AppStatus;
  projects: ProjectView[];
  sessions: SessionView[];
}

export type StreamMessage =
  | { v: 1; kind: 'snapshot'; snapshot: AppSnapshot }
  | { v: 1; kind: 'project'; project: ProjectView }
  | { v: 1; kind: 'project-removed'; projectId: string }
  | { v: 1; kind: 'session'; session: SessionView }
  | { v: 1; kind: 'session-removed'; sessionId: string }
  | { v: 1; kind: 'status'; status: AppStatus; ready: boolean };

export interface ApiError {
  error: string;
  /** The request field the error is about, for validation errors (422). */
  field?: string;
}

export interface HealthResponse {
  apiVersion: typeof API_VERSION;
  appVersion: string;
}

export interface TokenRenewResponse {
  token: string;
}

// Project routes: `POST /v1/projects/inspect { path }` → `InspectResult` (writes nothing),
// `POST /v1/projects { path, checkCommands, copyList, branchPrefix, requestId }` → 201
// `ProjectView` (idempotent by requestId), `DELETE /v1/projects/:id` → 204 (409 while the
// project has sessions), `POST /v1/projects/:id/setup-check` → `SetupCheckResponse`.

/** Setup check items (spec section 2), in the order the check returns them. */
export type SetupItemId =
  | 'claude-version'
  | 'trust'
  | 'check-command'
  | 'claude-md-length'
  | 'claude-md-emphasis'
  | 'secret-deny'
  | 'superpowers'
  | 'auto-memory'
  | 'default-mode'
  | 'skill-length'
  | 'committed-personal-settings'
  | 'prompt-audit';

export interface SetupItem {
  id: SetupItemId;
  status: 'ok' | 'hint' | 'problem' | 'info';
  title: string;
  detail: string;
  /** A command or text the user can copy; Orchtopus never applies it. */
  fix: string | null;
}

export type TrustStateView = 'trusted' | 'not-trusted' | 'unknown';

export type RepoInspectionView =
  | {
      ok: true;
      root: string;
      defaultBranch: string;
      currentBranch: string | null;
      remotes: RemoteView[];
      provider: 'github' | 'gitlab' | null;
    }
  | {
      ok: false;
      reason: 'not-a-repo' | 'not-top-level' | 'is-worktree' | 'is-bare' | 'git-missing';
      message: string;
    };

export interface InspectResult {
  repo: RepoInspectionView;
  checkCommands: CheckCommandsView;
  copyList: string[];
  branchPrefix: string;
  trust: TrustStateView;
  /** Empty when the folder is not a usable repository. */
  setup: SetupItem[];
}

export interface SetupCheckResponse {
  items: SetupItem[];
}
