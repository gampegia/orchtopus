// The state word of a session (spec section 6), derived from the last `claude agents --json`
// entry, the hook and status line times and the app's own start actions. Pure: the tracker
// collects the input, this file decides.
import type { SessionStateWord } from '../../shared/api-types';

/** How often `claude agents --json --all` is polled. */
export const POLL_INTERVAL_MS = 1000;
/** A hook event this recent after the last Stop makes a `done` / `idle` session running. */
export const ACTIVITY_WINDOW_MS = 3000;
/** Quiet time after a Stop before a `working` / `idle` session counts as idle (stale case). */
export const STALE_AFTER_STOP_MS = 3000;
/** `working` / `idle` this soon after a process start is still running. */
export const START_GRACE_MS = 10000;

export interface ObservedTriple {
  state: string | null;
  status: string | null;
  waitingFor: string | null;
}

export interface StateInput {
  now: number;
  /** The agents entry; 'missing' when a good poll had none, 'unknown' before or after a failed poll. */
  observed: ObservedTriple | 'missing' | 'unknown';
  /** Last hook or status line event, Stop included. */
  lastActivityAt: number | null;
  lastStopAt: number | null;
  processStartedAt: number | null;
  /** A `session.start` or `session.open` action for this session is pending. */
  starting: boolean;
  startFailed: string | null;
  previous: SessionStateWord;
  /** Reason that goes with `previous`; kept when the word is kept. */
  previousReason?: string | null;
  /**
   * Last non-Stop hook that means work (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
   * `SessionStart`). Falls back to `lastActivityAt` when not given.
   */
  lastHookAt?: number | null;
  /** False when no `UserPromptSubmit` came since the process started; unknown counts as true. */
  promptSinceProcessStart?: boolean;
}

export interface DerivedState {
  word: SessionStateWord;
  reason: string | null;
}

const FAILED_REASON = 'Claude Code reports the session failed';

function after(a: number | null, b: number | null): boolean {
  return a !== null && (b === null || a > b);
}

/** Rule 8: `working` / `idle`. */
function workingIdle(input: StateInput, lastHookAt: number | null): SessionStateWord {
  const { now, lastStopAt, processStartedAt, lastActivityAt } = input;
  const stopSinceStart =
    lastStopAt !== null && (processStartedAt === null || lastStopAt >= processStartedAt);
  if (!stopSinceStart) {
    // Right after a start the agents list says idle before the first turn has begun.
    return 'running';
  }
  // A hook after the Stop (Esc, then more tool calls) means the turn goes on.
  if (after(lastHookAt, lastStopAt)) return 'running';
  const quietSince = Math.max(lastStopAt, lastActivityAt ?? lastStopAt);
  return now - quietSince >= STALE_AFTER_STOP_MS ? 'idle' : 'running';
}

/** Rule 9: `done` / `idle`. */
function doneIdle(input: StateInput, lastHookAt: number | null): SessionStateWord {
  if (lastHookAt !== null && after(lastHookAt, input.lastStopAt)) {
    if (input.now - lastHookAt < ACTIVITY_WINDOW_MS) return 'running';
  }
  return 'idle';
}

/** Applies the rules of the plan in order; the first match wins. */
export function deriveState(input: StateInput): DerivedState {
  const keep: DerivedState = { word: input.previous, reason: input.previousReason ?? null };
  if (input.startFailed !== null) return { word: 'failed', reason: input.startFailed };
  if (input.starting) return { word: 'running', reason: 'Starting' };
  const observed = input.observed;
  if (observed === 'unknown') return keep;
  if (observed === 'missing') return { word: 'stopped', reason: null };

  const { state, status, waitingFor } = observed;
  const lastHookAt = input.lastHookAt === undefined ? input.lastActivityAt : input.lastHookAt;
  if (state === 'failed') return { word: 'failed', reason: FAILED_REASON };
  if (state === 'stopped' || (state === 'done' && status === null)) {
    return { word: 'stopped', reason: null };
  }
  if (state === 'blocked') {
    // A session started without a prompt waits as blocked / idle: nothing to answer yet.
    if (status === 'idle' && input.promptSinceProcessStart === false) {
      return { word: 'idle', reason: null };
    }
    return { word: 'needs-you', reason: waitingFor };
  }
  if (state === 'working' && (status === 'busy' || status === null)) {
    return { word: 'running', reason: null };
  }
  if (state === 'working' && status === 'idle') {
    return { word: workingIdle(input, lastHookAt), reason: null };
  }
  if (state === 'done' && status === 'idle') {
    return { word: doneIdle(input, lastHookAt), reason: null };
  }
  return keep;
}
