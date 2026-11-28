import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EventPayloads, EventType } from '../../shared/events';
import { openStore, type Store } from './event-log';
import {
  getSession,
  getSessionState,
  listProjects,
  listSessions,
  rebuildProjections,
} from './projections';
import { makeTempDir, stepClock, type TempDir } from './testing';

let temp: TempDir;
let store: Store;
let clock: () => string;
let counter = 0;

beforeEach(() => {
  temp = makeTempDir();
  store = openStore(temp.file('state.db'));
  clock = stepClock();
  counter = 0;
});

afterEach(() => {
  store.close();
  temp.remove();
});

function emit<T extends EventType>(
  type: T,
  payload: EventPayloads[T],
  ids: { projectId?: string; sessionId?: string } = {},
): string {
  counter += 1;
  const at = clock();
  store.append({ id: `ev-${String(counter)}`, type, at, ...ids, payload });
  return at;
}

const created: EventPayloads['session.created'] = {
  task: 'upload-fix',
  branch: 'orch/upload-fix',
  worktreePath: 'C:\\repos\\acme-app\\.claude\\worktrees\\upload-fix',
  mode: 'auto',
  model: 'opus',
  effort: 'medium',
};

function snapshot(): Record<string, unknown[]> {
  const tables = ['projects', 'sessions', 'session_state', 'actions'];
  return Object.fromEntries(
    tables.map((t) => [t, store.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]),
  );
}

describe('projections', () => {
  it('project.added then project.removed leaves no project', () => {
    emit(
      'project.added',
      { name: 'acme-app', path: 'C:\\repos\\acme-app', config: { v: 1 } },
      { projectId: 'p1' },
    );
    expect(listProjects(store.db)).toEqual([
      {
        id: 'p1',
        name: 'acme-app',
        path: 'C:\\repos\\acme-app',
        config: { v: 1 },
        addedAt: '2026-11-27T09:00:00.000Z',
      },
    ]);
    emit('project.removed', {}, { projectId: 'p1' });
    expect(listProjects(store.db)).toEqual([]);
  });

  it('project.updated changes only the given fields', () => {
    emit(
      'project.added',
      { name: 'acme-app', path: 'C:\\repos\\acme-app', config: { v: 1 } },
      { projectId: 'p1' },
    );
    emit('project.updated', { name: 'acme-web' }, { projectId: 'p1' });
    expect(listProjects(store.db)[0]).toMatchObject({
      name: 'acme-web',
      path: 'C:\\repos\\acme-app',
      config: { v: 1 },
    });
  });

  it('session.created, session.started, session.state fill sessions and session_state', () => {
    emit(
      'project.added',
      { name: 'acme-app', path: 'C:\\repos\\acme-app', config: {} },
      { projectId: 'p1' },
    );
    const createdAt = emit('session.created', created, { projectId: 'p1', sessionId: 's1' });
    expect(getSessionState(store.db, 's1')).toMatchObject({ starting: true, word: null });

    const startedAt = emit(
      'session.started',
      { claudeSessionId: 'c-123', shortId: 'ab12' },
      { sessionId: 's1' },
    );
    emit('session.state', { word: 'running', reason: 'working / busy' }, { sessionId: 's1' });

    expect(listSessions(store.db)).toHaveLength(1);
    expect(getSession(store.db, 's1')).toEqual({
      id: 's1',
      projectId: 'p1',
      task: 'upload-fix',
      branch: 'orch/upload-fix',
      worktreePath: created.worktreePath,
      type: 'feature',
      claudeSessionId: 'c-123',
      shortId: 'ab12',
      mode: 'auto',
      model: 'opus',
      effort: 'medium',
      createdAt,
    });
    expect(getSessionState(store.db, 's1')).toMatchObject({
      sessionId: 's1',
      word: 'running',
      reason: 'working / busy',
      processStartedAt: startedAt,
      starting: false,
      startFailed: null,
      contextPct: null,
    });
    expect(getSession(store.db, 'missing')).toBeUndefined();
    expect(getSessionState(store.db, 'missing')).toBeUndefined();
  });

  it('records hooks, the status line and observations', () => {
    emit('session.created', created, { projectId: 'p1', sessionId: 's1' });
    const hookAt = emit('hook.received', { hookEventName: 'PreToolUse' }, { sessionId: 's1' });
    const stopAt = emit('hook.received', { hookEventName: 'Stop' }, { sessionId: 's1' });
    emit(
      'statusline.received',
      { contextPct: 42, rateLimits: { fiveHour: 10 } },
      { sessionId: 's1' },
    );
    emit('session.observed', { observed: { state: 'done', status: 'idle' } }, { sessionId: 's1' });

    const state = getSessionState(store.db, 's1');
    expect(hookAt < stopAt).toBe(true);
    expect(state).toMatchObject({
      lastStopAt: stopAt,
      contextPct: 42,
      rateLimits: { fiveHour: 10 },
      observed: { state: 'done', status: 'idle' },
    });
    expect(state?.lastActivityAt).not.toBeNull();
  });

  it('session.started with a new process resets context_pct to null', () => {
    emit('session.created', created, { projectId: 'p1', sessionId: 's1' });
    emit('session.started', { claudeSessionId: 'c-123', shortId: 'ab12' }, { sessionId: 's1' });
    emit(
      'statusline.received',
      { contextPct: 77, rateLimits: { fiveHour: 5 } },
      { sessionId: 's1' },
    );
    expect(getSessionState(store.db, 's1')?.contextPct).toBe(77);

    emit(
      'session.started',
      { claudeSessionId: 'c-123', shortId: 'ab12', processStartedAt: '2026-11-28T08:00:00.000Z' },
      { sessionId: 's1' },
    );
    const state = getSessionState(store.db, 's1');
    expect(state?.contextPct).toBeNull();
    expect(state?.rateLimits).toBeNull();
    expect(state?.processStartedAt).toBe('2026-11-28T08:00:00.000Z');
  });

  it('an older spooled status line or hook does not rewind the session state', () => {
    emit('session.created', created, { projectId: 'p1', sessionId: 's1' });
    const liveStop = emit('hook.received', { hookEventName: 'Stop' }, { sessionId: 's1' });
    const liveAt = emit(
      'statusline.received',
      { contextPct: 64, rateLimits: { fiveHour: 30 } },
      { sessionId: 's1' },
    );
    // Spooled envelopes from before the live ones, imported afterwards.
    const old = '2000-01-01T00:00:00.000Z';
    store.append({
      id: 'spool-1',
      type: 'statusline.received',
      at: old,
      sessionId: 's1',
      payload: { contextPct: 12, rateLimits: { fiveHour: 1 } },
    });
    store.append({
      id: 'spool-2',
      type: 'hook.received',
      at: old,
      sessionId: 's1',
      payload: { hookEventName: 'Stop' },
    });

    expect(getSessionState(store.db, 's1')).toMatchObject({
      contextPct: 64,
      rateLimits: { fiveHour: 30 },
      lastStopAt: liveStop,
      lastActivityAt: liveAt,
    });
  });

  it('a live status line that lands after a later live hook still updates context_pct', () => {
    emit('session.created', created, { projectId: 'p1', sessionId: 's1' });
    // The status line and the Stop hook run as parallel helpers: the hook (later at) lands first.
    store.append({
      id: 'live-hook',
      type: 'hook.received',
      at: '2026-11-28T09:00:02.000Z',
      sessionId: 's1',
      payload: { hookEventName: 'Stop' },
    });
    store.append({
      id: 'live-status',
      type: 'statusline.received',
      at: '2026-11-28T09:00:01.000Z',
      sessionId: 's1',
      payload: { contextPct: 55, rateLimits: { fiveHour: 20 } },
    });
    expect(getSessionState(store.db, 's1')).toMatchObject({
      contextPct: 55,
      rateLimits: { fiveHour: 20 },
      lastActivityAt: '2026-11-28T09:00:02.000Z',
    });
  });

  it('an older status line does not overwrite a newer one', () => {
    emit('session.created', created, { projectId: 'p1', sessionId: 's1' });
    store.append({
      id: 'status-new',
      type: 'statusline.received',
      at: '2026-11-28T09:00:05.000Z',
      sessionId: 's1',
      payload: { contextPct: 70 },
    });
    store.append({
      id: 'status-old',
      type: 'statusline.received',
      at: '2026-11-28T09:00:04.000Z',
      sessionId: 's1',
      payload: { contextPct: 60 },
    });
    expect(getSessionState(store.db, 's1')?.contextPct).toBe(70);
  });

  it('a spooled status line from before the current process does not set context_pct', () => {
    emit('session.created', created, { projectId: 'p1', sessionId: 's1' });
    emit(
      'session.started',
      { claudeSessionId: 'c-123', shortId: 'ab12', processStartedAt: '2026-11-28T08:00:00.000Z' },
      { sessionId: 's1' },
    );
    store.append({
      id: 'spool-1',
      type: 'statusline.received',
      at: '2026-11-28T07:59:00.000Z',
      sessionId: 's1',
      payload: { contextPct: 90 },
    });
    expect(getSessionState(store.db, 's1')?.contextPct).toBeNull();
  });

  it('session.removed drops the session and its state', () => {
    emit('session.created', created, { projectId: 'p1', sessionId: 's1' });
    emit('session.removed', {}, { sessionId: 's1' });
    expect(listSessions(store.db)).toEqual([]);
    expect(getSessionState(store.db, 's1')).toBeUndefined();
  });

  it('rebuildProjections gives the same rows as incremental apply', () => {
    emit(
      'project.added',
      { name: 'acme-app', path: 'C:\\repos\\acme-app', config: {} },
      { projectId: 'p1' },
    );
    emit(
      'project.added',
      { name: 'acme-web', path: 'C:\\repos\\acme-web', config: {} },
      { projectId: 'p2' },
    );
    const words = ['running', 'idle', 'needs-you', 'stopped', 'failed'] as const;
    for (let i = 0; i < 4; i += 1) {
      const sessionId = `s${String(i)}`;
      emit(
        'session.created',
        { ...created, task: `report-export-${String(i)}` },
        { projectId: i % 2 ? 'p2' : 'p1', sessionId },
      );
      emit(
        'session.started',
        { claudeSessionId: `c-${String(i)}`, shortId: `x${String(i)}` },
        { sessionId },
      );
      emit('hook.received', { hookEventName: 'UserPromptSubmit' }, { sessionId });
      emit('statusline.received', { contextPct: 10 * i, rateLimits: null }, { sessionId });
      emit(
        'session.state',
        { word: words[i % words.length] ?? 'idle', reason: null },
        { sessionId },
      );
    }
    emit('session.removed', {}, { sessionId: 's3' });
    emit('project.updated', { config: { v: 2 } }, { projectId: 'p2' });
    emit('action.started', { actionId: 'a1', kind: 'session.start', params: { task: 'i18n-de' } });
    emit('action.step', { actionId: 'a1', name: 'worktree', result: { path: 'x' } });
    emit('action.finished', { actionId: 'a1', result: { ok: true } });
    emit('action.started', { actionId: 'a2', kind: 'session.stop', params: {} });
    emit('action.failed', { actionId: 'a2', error: 'not found' });
    emit('session.observed', { observed: null }, { sessionId: 's0' });
    expect(counter).toBe(30);

    const before = snapshot();
    rebuildProjections(store.db);
    expect(snapshot()).toEqual(before);
  });
});
