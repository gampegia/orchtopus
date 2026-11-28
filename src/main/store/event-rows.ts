// Event shapes and reading the events table. Shared by the event log and the projections.
import type { EventType } from '../../shared/events';
import type { Db } from './db';

export interface NewEvent {
  id: string;
  type: EventType;
  at: string;
  projectId?: string;
  sessionId?: string;
  payload: unknown;
}

/** An event as read back from the log, payload parsed. */
export type StoredEvent = NewEvent & { seq: number };

interface EventRow {
  seq: number;
  id: string;
  type: string;
  at: string;
  project_id: string | null;
  session_id: string | null;
  payload: string;
}

function toStoredEvent(row: EventRow): StoredEvent {
  const event: StoredEvent = {
    seq: row.seq,
    id: row.id,
    type: row.type as EventType,
    at: row.at,
    payload: JSON.parse(row.payload) as unknown,
  };
  if (row.project_id !== null) event.projectId = row.project_id;
  if (row.session_id !== null) event.sessionId = row.session_id;
  return event;
}

/** Events in log order, optionally only those after a sequence number. */
export function readEvents(db: Db, afterSeq = 0): StoredEvent[] {
  return db
    .prepare<[number], EventRow>('SELECT * FROM events WHERE seq > ? ORDER BY seq')
    .all(afterSeq)
    .map(toStoredEvent);
}
