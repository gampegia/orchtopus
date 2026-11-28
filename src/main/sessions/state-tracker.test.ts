import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppStatus, SessionView, StreamMessage } from '../../shared/api-types';
import type { HookEnvelope } from '../../shared/hook-envelope';
import { envelopeToEvent } from '../hooks/envelope-event';
import type { AgentEntry } from '../claude/agents';
import { openStore, readEvents, type Store } from '../store/event-log';
import { getSessionState } from '../store/projections';
import { makeTempDir, type TempDir } from '../store/testing';
import { createAgentsPoller } from './agents-poller';
import { POLL_INTERVAL_MS, START_GRACE_MS } from './state-rules';
import { createStateTracker, type StateTracker } from './state-tracker';

const T0 = Date.UTC(2026, 10, 28, 9, 0, 0);
const WORKTREE = 'C:\\repos\\acme-app\\.claude\\worktrees\\upload-fix';

let temp: TempDir;
let store: Store;
let clock: number;
let messages: StreamMessage[];
let statusChanges: Partial<AppStatus>[];
let tracker: StateTracker;
let counter = 0;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function append(type: Parameters<Store['append']>[0]['type'], payload: unknown, at = clock): void {
  counter += 1;
  store.append({
    id: `ev-${String(counter)}`,
    type,
    at: iso(at),
    projectId: 'p1',
    sessionId: 's1',
    payload,
  });
}

function entry(change: Partial<AgentEntry> = {}): AgentEntry {
  return {
    id: 'ab12cd34',
    sessionId: 'c-123',
    cwd: WORKTREE,
    kind: 'bg',
    state: 'working',
    status: 'busy',
    waitingFor: null,
    name: 'upload-fix',
    startedAt: T0,
    pid: 4242,
    ...change,
  };
}

function envelope(hook: string, fields: HookEnvelope['fields'] = {}): HookEnvelope {
  counter += 1;
  return {
    v: 1,
    id: `env-${String(counter)}`,
    at: iso(clock),
    mode: hook === 'statusline' ? 'statusline' : 'hook',
    hook,
    sessionId: 'c-123',
    cwd: WORKTREE,
    fields,
  };
}

/** What the hooks route does: store the envelope, then hand it to the listener. */
function deliver(env: HookEnvelope): void {
  store.append(envelopeToEvent(store.db, env));
  tracker.onEnvelope(env);
}

function sessionMessages(): SessionView[] {
  return messages.flatMap((m) => (m.kind === 'session' ? [m.session] : []));
}

function stateEvents(): unknown[] {
  return readEvents(store.db)
    .filter((e) => e.type === 'session.state')
    .map((e) => e.payload);
}

function word(): string | null | undefined {
  return getSessionState(store.db, 's1')?.word;
}

beforeEach(() => {
  temp = makeTempDir();
  store = openStore(temp.file('state.db'));
  clock = T0;
  counter = 0;
  messages = [];
  statusChanges = [];
  append('session.created', {
    task: 'upload-fix',
    branch: 'orch/upload-fix',
    worktreePath: WORKTREE,
    mode: 'auto',
    model: null,
    effort: null,
  });
  append('session.started', { claudeSessionId: 'c-123', shortId: 'ab12cd34' });
  tracker = createStateTracker({
    store,
    publish: (m) => messages.push(m),
    now: () => clock,
    setStatus: (change) => statusChanges.push(change),
  });
});

afterEach(() => {
  vi.useRealTimers();
  store.close();
  temp.remove();
});

describe('state tracker', () => {
  it('shows a change within 2 s', async () => {
    vi.useFakeTimers({ now: T0 });
    let entries = [entry({ state: 'working', status: 'busy' })];
    tracker = createStateTracker({
      store,
      publish: (m) => messages.push(m),
      now: () => Date.now(),
    });
    const poller = createAgentsPoller({
      list: () => Promise.resolve(entries),
      tracker,
      intervalMs: POLL_INTERVAL_MS,
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10);
    expect(sessionMessages().at(-1)?.state).toBe('running');

    const changedAt = Date.now();
    entries = [entry({ state: 'blocked', status: 'waiting', waitingFor: 'permission' })];
    let seenAt: number | null = null;
    while (Date.now() - changedAt < 2000 && seenAt === null) {
      await vi.advanceTimersByTimeAsync(100);
      if (sessionMessages().at(-1)?.state === 'needs-you') seenAt = Date.now();
    }
    poller.stop();
    expect(seenAt).not.toBeNull();
    expect((seenAt ?? Infinity) - changedAt).toBeLessThan(2000);
  });

  it('writes session.state only on change', () => {
    for (let i = 0; i < 5; i++) {
      clock += 1000;
      tracker.onPoll({ ok: true, entries: [entry()] });
    }
    expect(stateEvents()).toEqual([{ word: 'running', reason: null }]);
    const observed = readEvents(store.db).filter((e) => e.type === 'session.observed');
    expect(observed).toHaveLength(1);

    clock += 1000;
    tracker.onPoll({
      ok: true,
      entries: [entry({ state: 'blocked', status: 'waiting', waitingFor: 'permission' })],
    });
    expect(stateEvents()).toHaveLength(2);
    expect(word()).toBe('needs-you');
    expect(getSessionState(store.db, 's1')?.reason).toBe('permission');
  });

  it('keeps last state when a poll fails', () => {
    tracker.onPoll({ ok: true, entries: [entry()] });
    expect(word()).toBe('running');
    expect(tracker.agentsReachable()).toBe(true);
    expect(statusChanges.at(-1)).toEqual({ agentsReachable: true });
    const before = readEvents(store.db).length;

    for (let i = 0; i < 5; i++) {
      clock += 1000;
      tracker.onPoll({ ok: false, error: 'Claude Code did not answer in time.' });
      tracker.tick();
    }
    expect(word()).toBe('running');
    expect(tracker.agentsReachable()).toBe(false);
    expect(statusChanges.at(-1)).toEqual({ agentsReachable: false });
    expect(readEvents(store.db)).toHaveLength(before);
    expect(sessionMessages().every((s) => s.state === 'running')).toBe(true);

    tracker.onPoll({ ok: true, entries: [entry()] });
    expect(tracker.agentsReachable()).toBe(true);
    expect(statusChanges.at(-1)).toEqual({ agentsReachable: true });
  });

  it('context is unknown after a new process until a statusline value', () => {
    deliver(envelope('statusline', { contextPct: 42 }));
    expect(getSessionState(store.db, 's1')?.contextPct).toBe(42);
    clock += 1000;
    deliver(envelope('SessionStart', { source: 'resume' }));
    expect(sessionMessages().at(-1)?.contextPct).toBeNull();
    clock += 1000;
    deliver(envelope('statusline', { contextPct: 7 }));
    expect(sessionMessages().at(-1)?.contextPct).toBe(7);
  });

  it('ignores agents entries that no stored session has', () => {
    tracker.onPoll({
      ok: true,
      entries: [entry(), entry({ id: 'ffff0000', sessionId: 'c-other', state: 'failed' })],
    });
    expect(word()).toBe('running');
    const ids = new Set(readEvents(store.db).map((e) => e.sessionId));
    expect([...ids]).toEqual(['s1']);
  });

  it('a failed start stays failed across polls', () => {
    tracker.onStartFailed('s1', 'Claude Code could not start');
    for (let i = 0; i < 3; i++) {
      clock += 1000;
      tracker.onPoll({ ok: true, entries: [] });
    }
    expect(getSessionState(store.db, 's1')).toMatchObject({
      word: 'failed',
      reason: 'Claude Code could not start',
      startFailed: 'Claude Code could not start',
      starting: false,
    });
    expect(sessionMessages().at(-1)).toMatchObject({
      state: 'failed',
      stateReason: 'Claude Code could not start',
    });
  });

  it('a start in progress shows running across polls', () => {
    tracker.onStartBegun('s1');
    for (let i = 0; i < 3; i++) {
      clock += 1000;
      tracker.onPoll({ ok: true, entries: [] });
    }
    expect(getSessionState(store.db, 's1')).toMatchObject({
      word: 'running',
      reason: 'Starting',
      starting: true,
    });

    tracker.onProcessStarted('s1');
    expect(getSessionState(store.db, 's1')?.starting).toBe(false);
    clock += 1000;
    tracker.onPoll({ ok: true, entries: [entry({ state: 'blocked', status: 'waiting' })] });
    expect(word()).toBe('needs-you');
  });

  it('a session started without a prompt waits as idle, not needs you', () => {
    tracker.onPoll({ ok: true, entries: [entry({ state: 'blocked', status: 'idle' })] });
    expect(word()).toBe('idle');
    clock += 1000;
    deliver(envelope('UserPromptSubmit'));
    clock += 1000;
    deliver(envelope('Stop'));
    clock += 1000;
    tracker.onPoll({ ok: true, entries: [entry({ state: 'blocked', status: 'idle' })] });
    expect(word()).toBe('needs-you');
  });

  it('a hook makes a done / idle session running at once, tick turns it idle later', () => {
    tracker.onPoll({ ok: true, entries: [entry({ state: 'done', status: 'idle' })] });
    expect(word()).toBe('idle');
    clock += 1000;
    deliver(envelope('PreToolUse', { tool_name: 'Bash' }));
    expect(word()).toBe('running');
    expect(sessionMessages().at(-1)?.state).toBe('running');
    clock += 5000;
    tracker.tick();
    expect(word()).toBe('idle');
  });

  it('clearStarting drops a start that will not be resumed and lets the rules decide', () => {
    tracker.onStartBegun('s1');
    tracker.clearStarting('s1');
    expect(getSessionState(store.db, 's1')).toMatchObject({ starting: false });
    clock += 1000;
    tracker.onPoll({ ok: true, entries: [] });
    expect(word()).toBe('stopped');
    const before = stateEvents().length;
    tracker.clearStarting('s1');
    expect(stateEvents()).toHaveLength(before);
  });

  it('a process just started is not stopped by polls that do not list it yet', () => {
    tracker.onStartBegun('s1');
    // The last poll ran before the start: the session is not in it.
    tracker.onPoll({ ok: true, entries: [] });
    tracker.onProcessStarted('s1');
    expect(word()).toBe('running');
    clock += 1000;
    tracker.onPoll({ ok: true, entries: [] });
    expect(word()).toBe('running');
    clock += 1000;
    tracker.onPoll({ ok: true, entries: [entry({ state: 'done', status: 'idle' })] });
    expect(word()).not.toBe('stopped');
    // Once listed, a later missing entry stops it as usual.
    clock += 1000;
    tracker.onPoll({ ok: true, entries: [] });
    expect(word()).toBe('stopped');
  });

  it('a process start that never shows up is stopped after the start grace', () => {
    tracker.onStartBegun('s1');
    tracker.onProcessStarted('s1');
    clock += START_GRACE_MS;
    tracker.onPoll({ ok: true, entries: [] });
    expect(word()).toBe('stopped');
  });

  it('missing from a good poll is stopped', () => {
    tracker.onPoll({ ok: true, entries: [entry()] });
    clock += 1000;
    tracker.onPoll({ ok: true, entries: [] });
    expect(word()).toBe('stopped');
    expect(getSessionState(store.db, 's1')?.observed).toBeNull();
  });

  it('uses the given session view for published messages', () => {
    const view = vi.fn((id: string) => ({ id, state: 'running' }) as unknown as SessionView);
    tracker = createStateTracker({
      store,
      publish: (m) => messages.push(m),
      now: () => clock,
      sessionView: view,
    });
    tracker.onPoll({ ok: true, entries: [entry()] });
    expect(view).toHaveBeenCalledWith('s1');
  });
});
