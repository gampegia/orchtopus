// Schema migrations. Migration n brings the file to PRAGMA user_version = n.
import type { Db } from './db';

const MIGRATION_1 = `
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  project_id TEXT,
  session_id TEXT,
  payload TEXT NOT NULL
);

CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  config TEXT,
  added_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task TEXT NOT NULL,
  branch TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'feature',
  claude_session_id TEXT,
  short_id TEXT,
  mode TEXT,
  model TEXT,
  effort TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE session_state (
  session_id TEXT PRIMARY KEY,
  word TEXT,
  reason TEXT,
  observed TEXT,
  last_activity_at TEXT,
  last_stop_at TEXT,
  process_started_at TEXT,
  starting INTEGER NOT NULL DEFAULT 0,
  start_failed TEXT,
  context_pct REAL,
  rate_limits TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE actions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'failed')),
  params TEXT NOT NULL,
  steps TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export const MIGRATIONS: readonly string[] = [MIGRATION_1];

/** Applies every migration above the file's user_version, each in its own transaction. */
export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > MIGRATIONS.length) {
    throw new Error(`state.db has schema version ${String(current)}, newer than this app supports`);
  }
  MIGRATIONS.slice(current).forEach((sql, index) => {
    const version = current + index + 1;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${String(version)}`);
    })();
  });
}
