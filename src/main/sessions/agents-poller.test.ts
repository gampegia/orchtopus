import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentsListError,
  AgentsParseError,
  type AgentEntry,
  type AgentsFailure,
} from '../claude/agents';
import { createAgentsPoller } from './agents-poller';
import type { PollResult, StateTracker } from './state-tracker';

function fakeTracker(): StateTracker & { results: PollResult[] } {
  const results: PollResult[] = [];
  return {
    results,
    onPoll: (r) => {
      results.push(r);
    },
    onEnvelope: () => undefined,
    onStartBegun: () => undefined,
    onProcessStarted: () => undefined,
    onStartFailed: () => undefined,
    tick: () => undefined,
    agentsReachable: () => true,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('agents poller', () => {
  it('skips a tick while a poll is in flight', async () => {
    vi.useFakeTimers();
    const tracker = fakeTracker();
    let release: (entries: AgentEntry[]) => void = () => undefined;
    const list = vi.fn(
      () =>
        new Promise<AgentEntry[]>((resolve) => {
          release = resolve;
        }),
    );
    const poller = createAgentsPoller({ list, tracker, intervalMs: 1000 });
    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(list).toHaveBeenCalledTimes(1);
    const manual = poller.pollNow();
    expect(list).toHaveBeenCalledTimes(1);

    release([]);
    await manual;
    expect(tracker.results).toEqual([{ ok: true, entries: [] }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(list).toHaveBeenCalledTimes(2);
    poller.stop();
    release([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it.each<AgentsFailure>(['parse', 'timeout', 'spawn', 'exit'])(
    'turns each AgentsListError cause into ok false (%s)',
    async (cause) => {
      const tracker = fakeTracker();
      const error =
        cause === 'parse' ? new AgentsParseError() : new AgentsListError(cause, `failed: ${cause}`);
      const poller = createAgentsPoller({
        list: () => Promise.reject(error),
        tracker,
        intervalMs: 1000,
      });
      await poller.pollNow();
      expect(tracker.results).toEqual([{ ok: false, error: error.message }]);
    },
  );

  it('an error thrown by the tracker does not count as a failed poll', async () => {
    const tracker = fakeTracker();
    const onPoll = vi.fn(() => {
      throw new Error('tracker broke');
    });
    tracker.onPoll = onPoll;
    const poller = createAgentsPoller({
      list: () => Promise.resolve([]),
      tracker,
      intervalMs: 1000,
    });
    await expect(poller.pollNow()).rejects.toThrow('tracker broke');
    expect(onPoll).toHaveBeenCalledTimes(1);
  });
});
