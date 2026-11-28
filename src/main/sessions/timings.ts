// Every timing the state detection uses (EV-H9), in one place with its source. The state word
// must change within 2 s of the real change (product requirement N2).

/**
 * How often `claude agents --json --all` is polled. Source: spike
 * docs/spikes/2026-11-27-m1-claude-code-internals.md, Q1 (1 s polling showed every change on
 * the next poll).
 */
export const POLL_INTERVAL_MS = 1000;

/**
 * A hook event this recent after the last Stop makes a `done` / `idle` session running.
 * Source: spike docs/spikes/2026-11-27-m1-claude-code-internals.md, Q5 (the status line runs
 * 1 to 3 s apart during a turn).
 */
export const ACTIVITY_WINDOW_MS = 3000;

/**
 * Quiet time after a Stop before a `working` / `idle` session counts as idle (the stale case of
 * spike Q1). Source: own default, setting later; not measured yet (EV-H9: measure before M2).
 */
export const STALE_AFTER_STOP_MS = 3000;

/**
 * `working` / `idle` this soon after a process start is still running, and a missing agents
 * entry does not stop the session yet. Source: own default, setting later; not measured yet
 * (EV-H9: measure before M2). Spike Q1 saw `working` / `idle` for about 1 s at a process start.
 */
export const START_GRACE_MS = 10000;
