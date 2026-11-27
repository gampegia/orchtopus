import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionRunner } from './actions';
import { openStore, readEvents, type Store } from './event-log';
import { makeTempDir, stepClock, type TempDir } from './testing';

let temp: TempDir;
let store: Store;
let clock: () => string;

beforeEach(() => {
  temp = makeTempDir();
  store = openStore(temp.file('state.db'));
  clock = stepClock();
});

afterEach(() => {
  store.close();
  temp.remove();
});

function eventTypes(): string[] {
  return readEvents(store.db).map((e) => e.type);
}

describe('action runner', () => {
  it('logs action.started before the first step runs', async () => {
    const runner = createActionRunner(store, clock);
    const action = runner.begin('session.start', { task: 'upload-fix' });
    expect(action.status).toBe('pending');
    let seen: string[] = [];
    await runner.step(action.id, 'worktree', () => {
      seen = eventTypes();
      return Promise.resolve('done');
    });
    expect(seen).toEqual(['action.started']);
    expect(readEvents(store.db)[0]?.payload).toEqual({
      actionId: action.id,
      kind: 'session.start',
      params: { task: 'upload-fix' },
    });
  });

  it('runs each step once and records action.step', async () => {
    const runner = createActionRunner(store, clock);
    const action = runner.begin('session.start', {}, 'act-1');
    const run = vi.fn(() =>
      Promise.resolve({ path: 'C:\\repos\\acme-app\\.claude\\worktrees\\upload-fix' }),
    );
    const first = await runner.step(action.id, 'worktree', run);
    const second = await runner.step(action.id, 'worktree', run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(eventTypes()).toEqual(['action.started', 'action.step']);
    expect(runner.get('act-1')?.steps).toEqual([
      { name: 'worktree', result: first, at: '2026-11-27T09:00:01.000Z' },
    ]);
  });

  it('begin with a finished actionId returns the stored result and runs nothing', async () => {
    const runner = createActionRunner(store, clock);
    runner.begin('project.add', { path: 'C:\\repos\\acme-app' }, 'act-1');
    await runner.step('act-1', 'detect', () => Promise.resolve(1));
    runner.finish('act-1', { projectId: 'p1' });
    const count = readEvents(store.db).length;

    const again = runner.begin('project.add', { path: 'C:\\repos\\acme-app' }, 'act-1');
    expect(again.status).toBe('done');
    expect(again.result).toEqual({ projectId: 'p1' });
    const run = vi.fn(() => Promise.resolve(2));
    expect(await runner.step('act-1', 'detect', run)).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(readEvents(store.db)).toHaveLength(count);
  });

  it('resumes a pending action and skips completed steps', async () => {
    const runner = createActionRunner(store, clock);
    runner.begin('session.start', { task: 'report-export' }, 'act-1');
    const step1 = vi.fn(() => Promise.resolve('worktree-created'));
    await runner.step('act-1', 'worktree', step1);
    await expect(
      runner.step('act-1', 'spawn', () => Promise.reject(new Error('simulated crash'))),
    ).rejects.toThrow('simulated crash');

    // The app restarts: a new store and runner on the same file.
    store.close();
    store = openStore(temp.file('state.db'));
    const resumed = createActionRunner(store, clock);
    expect(resumed.pending().map((a) => a.id)).toEqual(['act-1']);
    const record = resumed.begin('session.start', { task: 'report-export' }, 'act-1');
    expect(record.status).toBe('pending');

    const step1Again = vi.fn(() => Promise.resolve('again'));
    const step2 = vi.fn(() => Promise.resolve('spawned'));
    expect(await resumed.step('act-1', 'worktree', step1Again)).toBe('worktree-created');
    expect(await resumed.step('act-1', 'spawn', step2)).toBe('spawned');
    expect(step1Again).not.toHaveBeenCalled();
    expect(step2).toHaveBeenCalledTimes(1);
    resumed.finish('act-1', 'ok');
    expect(resumed.pending()).toEqual([]);
  });

  it('counts attempts per begin of a pending action', () => {
    const runner = createActionRunner(store, clock);
    expect(runner.begin('session.open', {}, 'act-1').attempts).toBe(1);
    expect(runner.begin('session.open', {}, 'act-1').attempts).toBe(2);
    expect(runner.begin('session.open', {}, 'act-1').attempts).toBe(3);
    expect(eventTypes()).toEqual(['action.started', 'action.started', 'action.started']);
  });

  it('fail records the error and status failed', () => {
    const runner = createActionRunner(store, clock);
    runner.begin('session.remove', { sessionId: 's1' }, 'act-1');
    const failed = runner.fail('act-1', 'worktree has uncommitted changes');
    expect(failed).toMatchObject({ status: 'failed', error: 'worktree has uncommitted changes' });
    expect(runner.get('act-1')?.status).toBe('failed');
    expect(runner.pending()).toEqual([]);
    expect(eventTypes()).toEqual(['action.started', 'action.failed']);
  });

  it('creates a new id when none is given', () => {
    const runner = createActionRunner(store, clock);
    const a = runner.begin('session.stop', {});
    const b = runner.begin('session.stop', {});
    expect(a.id).not.toBe(b.id);
  });

  it('rejects steps of an unknown or finished action', async () => {
    const runner = createActionRunner(store, clock);
    await expect(runner.step('nope', 'x', () => Promise.resolve(1))).rejects.toThrow(
      'unknown action',
    );
    runner.begin('session.stop', {}, 'act-1');
    runner.finish('act-1', null);
    await expect(runner.step('act-1', 'new-step', () => Promise.resolve(1))).rejects.toThrow(
      'not pending',
    );
    expect(() => runner.finish('act-1', null)).toThrow('not pending');
  });
});
