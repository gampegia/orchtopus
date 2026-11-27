// The append-only event log. Every append also updates the projections, in one transaction.
import { openDatabase, type Db } from './db';
import type { NewEvent } from './event-rows';
import { applyEvent } from './projections';

export { readEvents, type NewEvent, type StoredEvent } from './event-rows';

export interface AppendResult {
  seq: number;
  /** True when an event with this id was already in the log; nothing changed. */
  duplicate: boolean;
}

export interface Store {
  db: Db;
  append(event: NewEvent): AppendResult;
  has(eventId: string): boolean;
  /** Runs fn in one transaction (nested calls use savepoints). */
  transaction<T>(fn: () => T): T;
  close(): void;
}

export function openStore(file: string): Store {
  const db = openDatabase(file);
  const insert = db.prepare<[string, string, string, string | null, string | null, string]>(
    `INSERT INTO events (id, type, at, project_id, session_id, payload)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
  );
  const findSeq = db.prepare<[string], { seq: number }>('SELECT seq FROM events WHERE id = ?');

  const append = db.transaction((event: NewEvent): AppendResult => {
    const payload = JSON.stringify(event.payload ?? null);
    const info = insert.run(
      event.id,
      event.type,
      event.at,
      event.projectId ?? null,
      event.sessionId ?? null,
      payload,
    );
    if (info.changes === 0) {
      const existing = findSeq.get(event.id);
      if (!existing) throw new Error(`event ${event.id} conflicted but is missing`);
      return { seq: existing.seq, duplicate: true };
    }
    const seq = Number(info.lastInsertRowid);
    // Apply the stored form, so incremental apply and rebuild see the same payload.
    applyEvent(db, { ...event, payload: JSON.parse(payload) as unknown, seq });
    return { seq, duplicate: false };
  });

  return {
    db,
    append: (event) => append(event),
    has: (eventId) => findSeq.get(eventId) !== undefined,
    transaction: <T>(fn: () => T): T => db.transaction(fn)(),
    close: () => {
      db.close();
    },
  };
}
