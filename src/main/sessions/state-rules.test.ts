import { describe, expect, it } from 'vitest';
import { deriveState, type StateInput } from './state-rules';
import {
  ACTIVITY_WINDOW_MS,
  POLL_INTERVAL_MS,
  START_GRACE_MS,
  STALE_AFTER_STOP_MS,
} from './timings';

const T0 = Date.UTC(2026, 10, 28, 9, 0, 0);

function obs(state: string | null, status: string | null = null, waitingFor: string | null = null) {
  return { state, status, waitingFor };
}

/** A process that started long ago, no hooks, nothing pending. */
function input(change: Partial<StateInput>): StateInput {
  return {
    now: T0 + 60_000,
    observed: obs('working', 'busy'),
    lastActivityAt: null,
    lastStopAt: null,
    processStartedAt: T0,
    starting: false,
    startFailed: null,
    previous: 'idle',
    ...change,
  };
}

describe('timings (EV-H9)', () => {
  it('match the spike and the own defaults', () => {
    expect(POLL_INTERVAL_MS).toBe(1000);
    expect(ACTIVITY_WINDOW_MS).toBe(3000);
    expect(STALE_AFTER_STOP_MS).toBe(3000);
    expect(START_GRACE_MS).toBe(10000);
  });
});

describe('deriveState: spec table', () => {
  it('running: working / busy', () => {
    expect(deriveState(input({ observed: obs('working', 'busy') })).word).toBe('running');
  });

  it('running: a hook event in the last few seconds on done / idle', () => {
    const now = T0 + 60_000;
    const got = deriveState(
      input({
        now,
        observed: obs('done', 'idle'),
        lastStopAt: now - 5000,
        lastActivityAt: now - 500,
      }),
    );
    expect(got.word).toBe('running');
  });

  it('needs you: blocked / waiting', () => {
    expect(deriveState(input({ observed: obs('blocked', 'waiting') })).word).toBe('needs-you');
  });

  it('needs you: blocked / idle', () => {
    expect(deriveState(input({ observed: obs('blocked', 'idle') })).word).toBe('needs-you');
  });

  it('idle: done / idle', () => {
    expect(deriveState(input({ observed: obs('done', 'idle') })).word).toBe('idle');
  });

  it('stopped: stopped', () => {
    expect(deriveState(input({ observed: obs('stopped') })).word).toBe('stopped');
  });

  it('failed: failed', () => {
    expect(deriveState(input({ observed: obs('failed') })).word).toBe('failed');
  });
});

describe('deriveState: rules in order', () => {
  it('start failure wins', () => {
    const got = deriveState(
      input({ startFailed: 'Claude Code could not start', starting: true, observed: 'missing' }),
    );
    expect(got).toEqual({ word: 'failed', reason: 'Claude Code could not start' });
  });

  it('a pending start is running with reason Starting, over missing and unknown', () => {
    expect(deriveState(input({ starting: true, observed: 'missing' }))).toEqual({
      word: 'running',
      reason: 'Starting',
    });
    expect(deriveState(input({ starting: true, observed: 'unknown' }))).toEqual({
      word: 'running',
      reason: 'Starting',
    });
  });

  it('unknown keeps the previous word', () => {
    expect(deriveState(input({ observed: 'unknown', previous: 'needs-you' })).word).toBe(
      'needs-you',
    );
  });

  it('keeps a word never written as null instead of making one up', () => {
    expect(deriveState(input({ observed: 'unknown', previous: null }))).toEqual({
      word: null,
      reason: null,
    });
    expect(deriveState(input({ observed: obs('mystery', 'busy'), previous: null })).word).toBe(
      null,
    );
  });

  it('missing from agents is stopped', () => {
    expect(deriveState(input({ observed: 'missing', previous: 'running' }))).toEqual({
      word: 'stopped',
      reason: null,
    });
  });

  it('failed is failed', () => {
    expect(deriveState(input({ observed: obs('failed', 'idle') }))).toEqual({
      word: 'failed',
      reason: 'Claude Code reports the session failed',
    });
  });

  it('done without status after claude stop is stopped', () => {
    expect(deriveState(input({ observed: obs('done', null) })).word).toBe('stopped');
  });

  it('blocked/idle is needs you', () => {
    expect(deriveState(input({ observed: obs('blocked', 'idle') }))).toEqual({
      word: 'needs-you',
      reason: null,
    });
  });

  it('blocked/waiting permission prompt is needs you with reason', () => {
    expect(deriveState(input({ observed: obs('blocked', 'waiting', 'permission') }))).toEqual({
      word: 'needs-you',
      reason: 'permission',
    });
  });

  it('blocked/idle before the first prompt of a process is idle', () => {
    const got = deriveState(
      input({ observed: obs('blocked', 'idle'), promptSinceProcessStart: false }),
    );
    expect(got.word).toBe('idle');
    expect(
      deriveState(input({ observed: obs('blocked', 'idle'), promptSinceProcessStart: true })).word,
    ).toBe('needs-you');
  });

  it('working with no status is running', () => {
    expect(deriveState(input({ observed: obs('working', null) })).word).toBe('running');
  });

  it('working/idle right after start is running', () => {
    const got = deriveState(
      input({ now: T0 + 2000, processStartedAt: T0, observed: obs('working', 'idle') }),
    );
    expect(got.word).toBe('running');
  });

  it('working/idle 3 s after Stop with no event is idle', () => {
    const stop = T0 + 20_000;
    const base = { observed: obs('working', 'idle'), lastStopAt: stop, lastActivityAt: stop };
    expect(deriveState(input({ ...base, now: stop + 1000 })).word).toBe('running');
    expect(deriveState(input({ ...base, now: stop + STALE_AFTER_STOP_MS })).word).toBe('idle');
  });

  it('working/idle with a Stop inside the start grace is idle once stale', () => {
    const got = deriveState(
      input({
        now: T0 + 5000,
        processStartedAt: T0,
        observed: obs('working', 'idle'),
        lastStopAt: T0 + 1000,
        lastActivityAt: T0 + 1000,
      }),
    );
    expect(got.word).toBe('idle');
  });

  it('working/idle after Esc with later PostToolUse stays running', () => {
    const stop = T0 + 20_000;
    const got = deriveState(
      input({
        now: stop + 30_000,
        observed: obs('working', 'idle'),
        lastStopAt: stop,
        lastActivityAt: stop + 2000,
        lastHookAt: stop + 2000,
      }),
    );
    expect(got.word).toBe('running');
  });

  it('working/idle: a status line after Stop delays idle but does not keep it running', () => {
    const stop = T0 + 20_000;
    const base = {
      observed: obs('working', 'idle'),
      lastStopAt: stop,
      lastActivityAt: stop + 500,
      lastHookAt: stop - 100,
    };
    expect(deriveState(input({ ...base, now: stop + 3000 })).word).toBe('running');
    expect(deriveState(input({ ...base, now: stop + 3500 })).word).toBe('idle');
  });

  it('working/idle without any Stop after the grace is running', () => {
    expect(deriveState(input({ observed: obs('working', 'idle') })).word).toBe('running');
  });

  it('done/idle: a hook after the last Stop within the window is running, later idle', () => {
    const stop = T0 + 20_000;
    const base = {
      observed: obs('done', 'idle'),
      lastStopAt: stop,
      lastActivityAt: stop + 1000,
      lastHookAt: stop + 1000,
    };
    expect(deriveState(input({ ...base, now: stop + 2000 })).word).toBe('running');
    expect(deriveState(input({ ...base, now: stop + 1000 + ACTIVITY_WINDOW_MS })).word).toBe(
      'idle',
    );
  });

  it('done/idle: only a status line after the Stop is idle', () => {
    const stop = T0 + 20_000;
    const got = deriveState(
      input({
        now: stop + 1000,
        observed: obs('done', 'idle'),
        lastStopAt: stop,
        lastActivityAt: stop + 500,
        lastHookAt: stop - 2000,
      }),
    );
    expect(got.word).toBe('idle');
  });

  it('done/idle: the Stop itself is not activity', () => {
    const stop = T0 + 20_000;
    const got = deriveState(
      input({
        now: stop + 100,
        observed: obs('done', 'idle'),
        lastStopAt: stop,
        lastActivityAt: stop,
      }),
    );
    expect(got.word).toBe('idle');
  });

  it('anything else keeps the previous word', () => {
    expect(deriveState(input({ observed: obs('mystery', 'busy'), previous: 'needs-you' }))).toEqual(
      { word: 'needs-you', reason: null },
    );
    expect(deriveState(input({ observed: obs(null, null), previous: 'idle' })).word).toBe('idle');
  });
});
