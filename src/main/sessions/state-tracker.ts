// Combines the agents list, hook envelopes and the app's own start actions into the state word
// of every stored session (spec section 6). Every change goes through the event log first
// (`session.observed`, `session.state`), then a `session` message is published. A failed poll
// only marks Claude Code as not reachable: no word changes, no session turns stopped.
import { randomUUID } from 'node:crypto';
import type { AppStatus, SessionView, StreamMessage } from '../../shared/api-types';
import type { EventPayloads, EventType } from '../../shared/events';
import type { HookEnvelope } from '../../shared/hook-envelope';
import { toSessionView } from '../app-context';
import type { AgentEntry } from '../claude/agents';
import { matchSession } from '../hooks/envelope-event';
import type { Store } from '../store/event-log';
import {
  getSession,
  getSessionState,
  listSessions,
  type SessionRow,
  type SessionStateRow,
} from '../store/projections';
import { START_GRACE_MS, deriveState, type ObservedTriple } from './state-rules';

export type PollResult = { ok: true; entries: AgentEntry[] } | { ok: false; error: string };

export interface StateTracker {
  onPoll: (result: PollResult) => void;
  /** Called after the envelope's event is in the log. */
  onEnvelope: (envelope: HookEnvelope) => void;
  /** A `session.start` or `session.open` action began: running, "Starting". */
  onStartBegun: (sessionId: string) => void;
  /** The Claude Code process is up: clears `starting` and `startFailed`. */
  onProcessStarted: (sessionId: string) => void;
  /** The start or resume failed: failed with the reason, until a later start clears it. */
  onStartFailed: (sessionId: string, reason: string) => void;
  /**
   * Drops `starting` for a start or resume that will not go on (the restart sequence found no
   * pending action for it); the rules then decide the word. Does nothing when not starting.
   */
  clearStarting: (sessionId: string) => void;
  /** Applies the rules again without new input (time windows). */
  tick: () => void;
  /** False before the first good poll and after a failed one. */
  agentsReachable: () => boolean;
}

export interface StateTrackerDeps {
  store: Store;
  publish: (message: StreamMessage) => void;
  now: () => number;
  /** Merges into the app status and publishes it (AppContext.setStatus). */
  setStatus?: (change: Partial<AppStatus>) => void;
  /** The view to publish; defaults to one without terminal state (AppContext.sessionView). */
  sessionView?: (sessionId: string) => SessionView | undefined;
}

/** Hooks that mean the session works; Stop, SessionEnd and Notification do not. */
const WORK_HOOKS: ReadonlySet<string> = new Set([
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
]);

interface HookFacts {
  lastHookAt: number | null;
  lastPromptAt: number | null;
}

interface HookRow {
  seq: number;
  at: string;
  sessionId: string | null;
  hook: string | null;
}

function ms(iso: string | null): number | null {
  if (iso === null) return null;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value;
}

function max(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function triple(entry: AgentEntry): ObservedTriple {
  return { state: entry.state, status: entry.status, waitingFor: entry.waitingFor };
}

function sameObserved(stored: unknown, next: ObservedTriple | null): boolean {
  if (next === null || stored === null || typeof stored !== 'object') return stored === next;
  const s = stored as Partial<ObservedTriple>;
  return s.state === next.state && s.status === next.status && s.waitingFor === next.waitingFor;
}

/** The agents entry of a session: by Claude session id, else by short id; newest start wins. */
function findEntry(entries: readonly AgentEntry[], row: SessionRow): AgentEntry | undefined {
  const matches = entries.filter(
    (e) =>
      (row.claudeSessionId !== null && e.sessionId === row.claudeSessionId) ||
      (row.shortId !== null && e.id === row.shortId),
  );
  return matches.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
}

export function createStateTracker(deps: StateTrackerDeps): StateTracker {
  const { store, publish, now } = deps;
  const db = store.db;
  /** Entries of the last good poll; null before one and after a failed poll. */
  let entries: AgentEntry[] | null = null;
  let reachable = false;
  /**
   * Sessions whose process the app just started and no poll has listed yet, with the time of
   * the start. A poll that began before the process registered does not list it, so a missing
   * entry does not stop such a session until START_GRACE_MS has passed.
   */
  const unseen = new Map<string, number>();
  // Hook times per session, read from the log incrementally (spooled events included).
  const facts = new Map<string, HookFacts>();
  let cursor = 0;
  const readHooks = db.prepare<[number], HookRow>(
    `SELECT seq, at, session_id AS sessionId, json_extract(payload, '$.hookEventName') AS hook
       FROM events WHERE seq > ? AND type = 'hook.received' ORDER BY seq`,
  );
  const lastSeq = db.prepare<[], { seq: number | null }>('SELECT MAX(seq) AS seq FROM events');

  const refreshFacts = (): void => {
    for (const row of readHooks.all(cursor)) {
      if (row.sessionId === null || row.hook === null) continue;
      const at = ms(row.at);
      const current = facts.get(row.sessionId) ?? { lastHookAt: null, lastPromptAt: null };
      if (WORK_HOOKS.has(row.hook)) current.lastHookAt = max(current.lastHookAt, at);
      if (row.hook === 'UserPromptSubmit') current.lastPromptAt = max(current.lastPromptAt, at);
      facts.set(row.sessionId, current);
    }
    cursor = lastSeq.get()?.seq ?? cursor;
  };

  const append = <T extends EventType>(type: T, sessionId: string, payload: EventPayloads[T]) => {
    const row = getSession(db, sessionId);
    store.append({
      id: randomUUID(),
      type,
      at: new Date(now()).toISOString(),
      sessionId,
      ...(row ? { projectId: row.projectId } : {}),
      payload,
    });
  };

  const publishSession = (sessionId: string): void => {
    const view =
      deps.sessionView?.(sessionId) ??
      (() => {
        const row = getSession(db, sessionId);
        return row ? toSessionView(row, getSessionState(db, sessionId)) : undefined;
      })();
    if (view) publish({ v: 1, kind: 'session', session: view });
  };

  const setReachable = (value: boolean): void => {
    if (reachable === value) return;
    reachable = value;
    deps.setStatus?.({ agentsReachable: value });
  };

  /** Applies the rules to one session; returns true when something was written. */
  const evaluate = (row: SessionRow, state: SessionStateRow): boolean => {
    let changed = false;
    let observed: ObservedTriple | 'missing' | 'unknown' = 'unknown';
    const startedAt = unseen.get(row.id);
    const entry = entries === null ? undefined : findEntry(entries, row);
    if (entry !== undefined || (startedAt !== undefined && now() - startedAt >= START_GRACE_MS)) {
      unseen.delete(row.id);
    }
    if (entries !== null && (entry !== undefined || !unseen.has(row.id))) {
      const next = entry ? triple(entry) : null;
      observed = next ?? 'missing';
      if (!sameObserved(state.observed, next)) {
        append('session.observed', row.id, {
          observed: next,
          ...(entry?.sessionId ? { claudeSessionId: entry.sessionId } : {}),
          ...(entry ? { shortId: entry.id } : {}),
        });
        changed = true;
      }
    }
    const hookFacts = facts.get(row.id) ?? { lastHookAt: null, lastPromptAt: null };
    const processStartedAt = ms(state.processStartedAt);
    const derived = deriveState({
      now: now(),
      observed,
      lastActivityAt: ms(state.lastActivityAt),
      lastStopAt: ms(state.lastStopAt),
      processStartedAt,
      starting: state.starting,
      startFailed: state.startFailed,
      previous: state.word ?? 'idle',
      previousReason: state.reason,
      lastHookAt: hookFacts.lastHookAt,
      promptSinceProcessStart:
        hookFacts.lastPromptAt !== null &&
        (processStartedAt === null || hookFacts.lastPromptAt >= processStartedAt),
    });
    if (derived.word !== state.word || derived.reason !== state.reason) {
      append('session.state', row.id, { word: derived.word, reason: derived.reason });
      changed = true;
    }
    return changed;
  };

  /** Evaluates one session or all; publishes the ones that changed (or `force` ones). */
  const run = (only?: string, force = false): void => {
    refreshFacts();
    const rows = only === undefined ? listSessions(db) : [getSession(db, only)];
    for (const row of rows) {
      if (!row) continue;
      const state = getSessionState(db, row.id);
      if (!state) continue;
      const changed = evaluate(row, state);
      if (changed || force) publishSession(row.id);
    }
  };

  return {
    onPoll: (result) => {
      if (result.ok) {
        entries = result.entries;
        setReachable(true);
      } else {
        entries = null;
        setReachable(false);
      }
      run();
    },
    onEnvelope: (envelope) => {
      const sessionId = matchSession(db, envelope);
      // Publish even without a word change: the context fill may have moved.
      if (sessionId !== null) run(sessionId, true);
    },
    onStartBegun: (sessionId) => {
      if (!getSession(db, sessionId)) return;
      append('session.state', sessionId, {
        word: 'running',
        reason: 'Starting',
        startFailed: null,
        starting: true,
      });
      publishSession(sessionId);
    },
    onProcessStarted: (sessionId) => {
      const state = getSessionState(db, sessionId);
      if (!state) return;
      // The session service usually logged session.started with the ids already; that cleared
      // both flags. Otherwise log a process start here (null ids keep the stored ones).
      if (state.starting || state.startFailed !== null) {
        append('session.started', sessionId, { claudeSessionId: null, shortId: null });
      }
      unseen.set(sessionId, now());
      run(sessionId, true);
    },
    onStartFailed: (sessionId, reason) => {
      if (!getSession(db, sessionId)) return;
      append('session.state', sessionId, { word: 'failed', reason, startFailed: reason });
      publishSession(sessionId);
    },
    clearStarting: (sessionId) => {
      const state = getSessionState(db, sessionId);
      if (!state?.starting) return;
      append('session.state', sessionId, {
        word: state.word ?? 'idle',
        // "Starting" no longer holds; the next good poll decides the word.
        reason: state.reason === 'Starting' ? null : state.reason,
        starting: false,
      });
      run(sessionId, true);
    },
    tick: () => {
      run();
    },
    agentsReachable: () => reachable,
  };
}
