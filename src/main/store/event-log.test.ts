import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStore, readEvents, type Store } from './event-log';
import { makeTempDir, type TempDir } from './testing';

let temp: TempDir;
let store: Store | undefined;

beforeEach(() => {
  temp = makeTempDir();
});

afterEach(() => {
  store?.close();
  store = undefined;
  temp.remove();
});

function open(): Store {
  store = openStore(temp.file('state.db'));
  return store;
}

describe('event log', () => {
  it('appends and reads back in order', () => {
    const s = open();
    const first = s.append({
      id: 'e1',
      type: 'project.added',
      at: '2026-11-27T09:00:00.000Z',
      projectId: 'acme-app',
      payload: { name: 'acme-app', path: 'C:\\repos\\acme-app', config: {} },
    });
    const second = s.append({
      id: 'e2',
      type: 'spool.damaged',
      at: '2026-11-27T09:00:01.000Z',
      payload: { file: 'damaged-1.jsonl', line: 3, reason: 'not JSON' },
    });
    expect(first).toEqual({ seq: 1, duplicate: false });
    expect(second).toEqual({ seq: 2, duplicate: false });

    const events = readEvents(s.db);
    expect(events.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(events[0]).toEqual({
      seq: 1,
      id: 'e1',
      type: 'project.added',
      at: '2026-11-27T09:00:00.000Z',
      projectId: 'acme-app',
      payload: { name: 'acme-app', path: 'C:\\repos\\acme-app', config: {} },
    });
    expect(events[1]?.projectId).toBeUndefined();
    expect(readEvents(s.db, 1).map((e) => e.id)).toEqual(['e2']);
  });

  it('returns duplicate for a known id and keeps one row', () => {
    const s = open();
    const event = {
      id: 'dup',
      type: 'hook.received' as const,
      at: '2026-11-27T09:00:00.000Z',
      sessionId: 'ses-1',
      payload: { hookEventName: 'Stop' },
    };
    expect(s.append(event)).toEqual({ seq: 1, duplicate: false });
    expect(s.append({ ...event, payload: { hookEventName: 'PreToolUse' } })).toEqual({
      seq: 1,
      duplicate: true,
    });
    expect(s.has('dup')).toBe(true);
    expect(s.has('other')).toBe(false);
    const events = readEvents(s.db);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({ hookEventName: 'Stop' });
  });

  it('rejects UPDATE on events', () => {
    const s = open();
    s.append({
      id: 'e1',
      type: 'project.removed',
      at: '2026-11-27T09:00:00.000Z',
      projectId: 'acme-app',
      payload: {},
    });
    expect(() => s.db.prepare('UPDATE events SET type = ?').run('x')).toThrow(
      'events are append-only',
    );
  });

  it('rejects DELETE on events', () => {
    const s = open();
    s.append({
      id: 'e1',
      type: 'project.removed',
      at: '2026-11-27T09:00:00.000Z',
      projectId: 'acme-app',
      payload: {},
    });
    expect(() => s.db.prepare('DELETE FROM events').run()).toThrow('events are append-only');
  });

  it('reopens an existing file at user_version 1', () => {
    const s = open();
    s.append({
      id: 'e1',
      type: 'project.removed',
      at: '2026-11-27T09:00:00.000Z',
      projectId: 'acme-app',
      payload: {},
    });
    s.close();
    store = undefined;

    const reopened = open();
    expect(reopened.db.pragma('user_version', { simple: true })).toBe(1);
    expect(reopened.db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(reopened.db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(reopened.has('e1')).toBe(true);
    expect(
      reopened.append({
        id: 'e2',
        type: 'project.removed',
        at: '2026-11-27T09:00:01.000Z',
        payload: {},
      }).seq,
    ).toBe(2);
  });

  it('rolls back the event when a transaction throws', () => {
    const s = open();
    expect(() =>
      s.transaction(() => {
        s.append({
          id: 'e1',
          type: 'project.removed',
          at: '2026-11-27T09:00:00.000Z',
          payload: {},
        });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(s.has('e1')).toBe(false);
  });
});
