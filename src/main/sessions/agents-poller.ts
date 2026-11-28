// Polls `claude agents --json --all` and hands each result to the state tracker. At most one
// poll runs at a time: a tick that finds one in flight is skipped, and pollNow joins it.
import type { AgentEntry } from '../claude/agents';
import type { PollResult, StateTracker } from './state-tracker';

export interface AgentsPoller {
  start: () => void;
  stop: () => void;
  /** Polls once now, or waits for the poll in flight. */
  pollNow: () => Promise<void>;
}

export function createAgentsPoller(deps: {
  list: () => Promise<AgentEntry[]>;
  tracker: StateTracker;
  intervalMs: number;
}): AgentsPoller {
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const poll = async (): Promise<void> => {
    let result: PollResult;
    try {
      result = { ok: true, entries: await deps.list() };
    } catch (error) {
      // Any failure (AgentsListError: parse, timeout, spawn, exit) keeps the last state.
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    deps.tracker.onPoll(result);
  };

  const pollNow = (): Promise<void> => {
    if (inFlight !== null) return inFlight;
    const current = poll().finally(() => {
      inFlight = null;
    });
    inFlight = current;
    return current;
  };

  return {
    start: () => {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (inFlight !== null) return;
        // A tracker error must not become an unhandled rejection; the next tick tries again.
        pollNow().catch(() => undefined);
      }, deps.intervalMs);
    },
    stop: () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    pollNow,
  };
}
