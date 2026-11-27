// Projection tables derived from the event log: projects, sessions, session_state, actions.
// applyEvent must stay deterministic (only the event decides the result), so a rebuild
// from the log gives exactly the rows that incremental apply produced.
import type { ActionKind, EventPayloads, SessionType, StateWord } from '../../shared/events';
import type { Db } from './db';
import { readEvents, type StoredEvent } from './event-rows';

export interface ProjectRow {
  id: string;
  name: string;
  path: string;
  config: unknown;
  addedAt: string;
}

export interface SessionRow {
  id: string;
  projectId: string;
  task: string;
  branch: string;
  worktreePath: string;
  type: SessionType;
  claudeSessionId: string | null;
  shortId: string | null;
  mode: string | null;
  model: string | null;
  effort: string | null;
  createdAt: string;
}

export interface SessionStateRow {
  sessionId: string;
  word: StateWord | null;
  reason: string | null;
  observed: unknown;
  lastActivityAt: string | null;
  lastStopAt: string | null;
  processStartedAt: string | null;
  starting: boolean;
  startFailed: string | null;
  contextPct: number | null;
  rateLimits: unknown;
  updatedAt: string;
}

export interface ActionStepRecord {
  name: string;
  result: unknown;
  at: string;
}

export type ActionStatus = 'pending' | 'done' | 'failed';

export interface ActionRecord {
  id: string;
  kind: ActionKind;
  status: ActionStatus;
  params: unknown;
  steps: ActionStepRecord[];
  attempts: number;
  result: unknown;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

const PROJECTION_TABLES = ['projects', 'sessions', 'session_state', 'actions'] as const;

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parse(text: string | null): unknown {
  return text === null ? null : (JSON.parse(text) as unknown);
}

// An event without the id it needs changes no projection. It never throws: a throw here would
// abort the append, and during a rebuild it would stop the app from starting.
function applyProjectEvent(db: Db, event: StoredEvent): void {
  const projectId = event.projectId;
  if (projectId === undefined) return;
  switch (event.type) {
    case 'project.added': {
      const p = event.payload as EventPayloads['project.added'];
      db.prepare(
        `INSERT INTO projects (id, name, path, config, added_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, path = excluded.path,
           config = excluded.config, added_at = excluded.added_at`,
      ).run(projectId, p.name, p.path, json(p.config), event.at);
      return;
    }
    case 'project.updated': {
      const p = event.payload as EventPayloads['project.updated'];
      if (p.name !== undefined) {
        db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(p.name, projectId);
      }
      if (p.path !== undefined) {
        db.prepare('UPDATE projects SET path = ? WHERE id = ?').run(p.path, projectId);
      }
      if ('config' in p) {
        db.prepare('UPDATE projects SET config = ? WHERE id = ?').run(json(p.config), projectId);
      }
      return;
    }
    case 'project.removed':
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      return;
    default:
      return;
  }
}

function applySessionEvent(db: Db, event: StoredEvent): void {
  const sessionId = event.sessionId;
  if (sessionId === undefined) return;
  const touch = (): void => {
    db.prepare('UPDATE session_state SET updated_at = ? WHERE session_id = ?').run(
      event.at,
      sessionId,
    );
  };
  switch (event.type) {
    case 'session.created': {
      const p = event.payload as EventPayloads['session.created'];
      const projectId = event.projectId;
      if (projectId === undefined) return;
      db.prepare(
        `INSERT OR IGNORE INTO sessions (id, project_id, task, branch, worktree_path, type, mode, model, effort, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        sessionId,
        projectId,
        p.task,
        p.branch,
        p.worktreePath,
        p.type ?? 'feature',
        p.mode,
        p.model,
        p.effort,
        event.at,
      );
      db.prepare(
        'INSERT OR IGNORE INTO session_state (session_id, starting, updated_at) VALUES (?, 1, ?)',
      ).run(sessionId, event.at);
      return;
    }
    case 'session.started': {
      const p = event.payload as EventPayloads['session.started'];
      db.prepare(
        `UPDATE sessions SET claude_session_id = COALESCE(?, claude_session_id),
           short_id = COALESCE(?, short_id) WHERE id = ?`,
      ).run(p.claudeSessionId, p.shortId, sessionId);
      // A new process: its context fill and limits are unknown until its first status line.
      db.prepare(
        `UPDATE session_state SET process_started_at = ?, starting = 0, start_failed = NULL,
           context_pct = NULL, rate_limits = NULL WHERE session_id = ?`,
      ).run(p.processStartedAt ?? event.at, sessionId);
      touch();
      return;
    }
    case 'session.observed': {
      const p = event.payload as EventPayloads['session.observed'];
      db.prepare(
        `UPDATE sessions SET claude_session_id = COALESCE(?, claude_session_id),
           short_id = COALESCE(?, short_id) WHERE id = ?`,
      ).run(p.claudeSessionId ?? null, p.shortId ?? null, sessionId);
      db.prepare('UPDATE session_state SET observed = ? WHERE session_id = ?').run(
        json(p.observed),
        sessionId,
      );
      touch();
      return;
    }
    case 'session.state': {
      const p = event.payload as EventPayloads['session.state'];
      db.prepare('UPDATE session_state SET word = ?, reason = ? WHERE session_id = ?').run(
        p.word,
        p.reason ?? null,
        sessionId,
      );
      if (p.startFailed !== undefined) {
        db.prepare(
          'UPDATE session_state SET start_failed = ?, starting = 0 WHERE session_id = ?',
        ).run(p.startFailed, sessionId);
      }
      touch();
      return;
    }
    case 'session.removed':
      db.prepare('DELETE FROM session_state WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      return;
    case 'hook.received': {
      const p = event.payload as EventPayloads['hook.received'];
      db.prepare('UPDATE session_state SET last_activity_at = ? WHERE session_id = ?').run(
        event.at,
        sessionId,
      );
      if (p.hookEventName === 'Stop') {
        db.prepare('UPDATE session_state SET last_stop_at = ? WHERE session_id = ?').run(
          event.at,
          sessionId,
        );
      }
      touch();
      return;
    }
    case 'statusline.received': {
      const p = event.payload as EventPayloads['statusline.received'];
      db.prepare('UPDATE session_state SET last_activity_at = ? WHERE session_id = ?').run(
        event.at,
        sessionId,
      );
      if (p.contextPct !== undefined) {
        db.prepare('UPDATE session_state SET context_pct = ? WHERE session_id = ?').run(
          p.contextPct,
          sessionId,
        );
      }
      if ('rateLimits' in p) {
        db.prepare('UPDATE session_state SET rate_limits = ? WHERE session_id = ?').run(
          json(p.rateLimits),
          sessionId,
        );
      }
      touch();
      return;
    }
    default:
      return;
  }
}

interface ActionDbRow {
  id: string;
  kind: string;
  status: string;
  params: string;
  steps: string;
  attempts: number;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function toActionRecord(row: ActionDbRow): ActionRecord {
  return {
    id: row.id,
    kind: row.kind as ActionKind,
    status: row.status as ActionStatus,
    params: parse(row.params),
    steps: parse(row.steps) as ActionStepRecord[],
    attempts: row.attempts,
    result: parse(row.result),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function applyActionEvent(db: Db, event: StoredEvent): void {
  switch (event.type) {
    case 'action.started': {
      const p = event.payload as EventPayloads['action.started'];
      db.prepare(
        `INSERT INTO actions (id, kind, status, params, steps, attempts, created_at, updated_at)
         VALUES (?, ?, 'pending', ?, '[]', 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET attempts = attempts + 1, updated_at = excluded.updated_at`,
      ).run(p.actionId, p.kind, json(p.params), event.at, event.at);
      return;
    }
    case 'action.step': {
      const p = event.payload as EventPayloads['action.step'];
      const action = getAction(db, p.actionId);
      if (!action) return;
      const steps = [...action.steps, { name: p.name, result: p.result ?? null, at: event.at }];
      db.prepare('UPDATE actions SET steps = ?, updated_at = ? WHERE id = ?').run(
        json(steps),
        event.at,
        p.actionId,
      );
      return;
    }
    case 'action.finished': {
      const p = event.payload as EventPayloads['action.finished'];
      db.prepare(`UPDATE actions SET status = 'done', result = ?, updated_at = ? WHERE id = ?`).run(
        json(p.result),
        event.at,
        p.actionId,
      );
      return;
    }
    case 'action.failed': {
      const p = event.payload as EventPayloads['action.failed'];
      db.prepare(
        `UPDATE actions SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
      ).run(p.error, event.at, p.actionId);
      return;
    }
    default:
      return;
  }
}

/** Applies one event to the projection tables. Call inside the append transaction. */
export function applyEvent(db: Db, event: StoredEvent): void {
  if (event.type.startsWith('project.')) {
    applyProjectEvent(db, event);
  } else if (event.type.startsWith('session.') || event.type.endsWith('.received')) {
    applySessionEvent(db, event);
  } else if (event.type.startsWith('action.')) {
    applyActionEvent(db, event);
  }
  // spool.damaged and unknown types change no projection.
}

/** Drops every projection row and applies the whole log again, in order. */
export function rebuildProjections(db: Db): void {
  db.transaction(() => {
    for (const table of PROJECTION_TABLES) db.prepare(`DELETE FROM ${table}`).run();
    for (const event of readEvents(db)) applyEvent(db, event);
  })();
}

interface ProjectDbRow {
  id: string;
  name: string;
  path: string;
  config: string | null;
  added_at: string;
}

export function listProjects(db: Db): ProjectRow[] {
  return db
    .prepare<[], ProjectDbRow>('SELECT * FROM projects ORDER BY added_at, id')
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      path: r.path,
      config: parse(r.config),
      addedAt: r.added_at,
    }));
}

interface SessionDbRow {
  id: string;
  project_id: string;
  task: string;
  branch: string;
  worktree_path: string;
  type: string;
  claude_session_id: string | null;
  short_id: string | null;
  mode: string | null;
  model: string | null;
  effort: string | null;
  created_at: string;
}

function toSessionRow(r: SessionDbRow): SessionRow {
  return {
    id: r.id,
    projectId: r.project_id,
    task: r.task,
    branch: r.branch,
    worktreePath: r.worktree_path,
    type: r.type as SessionType,
    claudeSessionId: r.claude_session_id,
    shortId: r.short_id,
    mode: r.mode,
    model: r.model,
    effort: r.effort,
    createdAt: r.created_at,
  };
}

export function listSessions(db: Db): SessionRow[] {
  return db
    .prepare<[], SessionDbRow>('SELECT * FROM sessions ORDER BY created_at, id')
    .all()
    .map(toSessionRow);
}

export function getSession(db: Db, id: string): SessionRow | undefined {
  const row = db.prepare<[string], SessionDbRow>('SELECT * FROM sessions WHERE id = ?').get(id);
  return row ? toSessionRow(row) : undefined;
}

interface SessionStateDbRow {
  session_id: string;
  word: string | null;
  reason: string | null;
  observed: string | null;
  last_activity_at: string | null;
  last_stop_at: string | null;
  process_started_at: string | null;
  starting: number;
  start_failed: string | null;
  context_pct: number | null;
  rate_limits: string | null;
  updated_at: string;
}

export function getSessionState(db: Db, id: string): SessionStateRow | undefined {
  const r = db
    .prepare<[string], SessionStateDbRow>('SELECT * FROM session_state WHERE session_id = ?')
    .get(id);
  if (!r) return undefined;
  return {
    sessionId: r.session_id,
    word: r.word as StateWord | null,
    reason: r.reason,
    observed: parse(r.observed),
    lastActivityAt: r.last_activity_at,
    lastStopAt: r.last_stop_at,
    processStartedAt: r.process_started_at,
    starting: r.starting !== 0,
    startFailed: r.start_failed,
    contextPct: r.context_pct,
    rateLimits: parse(r.rate_limits),
    updatedAt: r.updated_at,
  };
}

export function getAction(db: Db, id: string): ActionRecord | undefined {
  const row = db.prepare<[string], ActionDbRow>('SELECT * FROM actions WHERE id = ?').get(id);
  return row ? toActionRecord(row) : undefined;
}

export function listPendingActions(db: Db): ActionRecord[] {
  return db
    .prepare<[], ActionDbRow>(
      `SELECT * FROM actions WHERE status = 'pending' ORDER BY created_at, id`,
    )
    .all()
    .map(toActionRecord);
}
