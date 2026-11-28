import { describe, expect, it } from 'vitest';
import type { AppStatus, SessionStateWord, SessionView } from './api-types';
import {
  STATE_LABEL,
  STATE_SIGNAL,
  STATE_WORDS,
  countStates,
  needsYouNote,
  statusNotices,
} from './state-words';

function session(id: string, state: SessionStateWord): SessionView {
  return {
    id,
    projectId: 'acme-app',
    task: id,
    branch: `orch/${id}`,
    worktreePath: `C:/demo/acme-app/.claude/worktrees/${id}`,
    type: 'feature',
    state,
    stateReason: null,
    contextPct: null,
    mode: 'auto',
    model: null,
    effort: null,
    terminal: { id: null, status: 'none' },
    createdAt: '2026-11-28T10:00:00.000Z',
  };
}

const okStatus: AppStatus = {
  cli: { found: true, version: '2.1.332', supported: true },
  agentsReachable: true,
  spoolDamaged: 0,
  vscodeAvailable: false,
};

describe('state words', () => {
  it('give every word a label and a signal', () => {
    expect(STATE_WORDS).toHaveLength(5);
    for (const word of STATE_WORDS) {
      expect(STATE_LABEL[word]).not.toBe('');
      expect(['running', 'permission', 'idle', 'danger']).toContain(STATE_SIGNAL[word]);
    }
    expect(STATE_LABEL).toEqual({
      running: 'running',
      'needs-you': 'needs you',
      idle: 'idle',
      stopped: 'stopped',
      failed: 'failed',
    });
    expect(STATE_SIGNAL).toEqual({
      running: 'running',
      'needs-you': 'permission',
      idle: 'idle',
      stopped: 'idle',
      failed: 'danger',
    });
  });
});

describe('countStates', () => {
  it('counts in the fixed order needs you, running, failed, idle, stopped', () => {
    const sessions = [
      session('a', 'stopped'),
      session('b', 'idle'),
      session('c', 'running'),
      session('d', 'failed'),
      session('e', 'needs-you'),
      session('f', 'running'),
    ];
    expect(countStates(sessions)).toEqual([
      { word: 'needs-you', count: 1 },
      { word: 'running', count: 2 },
      { word: 'failed', count: 1 },
      { word: 'idle', count: 1 },
      { word: 'stopped', count: 1 },
    ]);
  });

  it('leaves out words with no sessions', () => {
    expect(countStates([session('a', 'idle'), session('b', 'idle')])).toEqual([
      { word: 'idle', count: 2 },
    ]);
    expect(countStates([])).toEqual([]);
  });
});

describe('needsYouNote', () => {
  it('names how many sessions need you, or nothing', () => {
    expect(needsYouNote([session('a', 'idle')])).toBeNull();
    expect(needsYouNote([session('a', 'needs-you'), session('b', 'idle')])).toBe(
      '1 session needs you',
    );
    expect(needsYouNote([session('a', 'needs-you'), session('b', 'needs-you')])).toBe(
      '2 sessions need you',
    );
  });
});

describe('statusNotices', () => {
  it('says API connected when all is well', () => {
    expect(statusNotices({ connection: 'connected', ready: true, status: okStatus })).toEqual([
      { text: 'API connected', problem: false },
    ]);
  });

  it('says the connection is lost and nothing else', () => {
    expect(statusNotices({ connection: 'lost', ready: true, status: okStatus })).toEqual([
      { text: 'API connection lost', problem: true },
    ]);
  });

  it('says Claude Code is not reachable when the poll fails', () => {
    const status = { ...okStatus, agentsReachable: false };
    expect(statusNotices({ connection: 'connected', ready: true, status })).toContainEqual({
      text: 'Claude Code not reachable',
      problem: true,
    });
  });

  it('names a Claude Code version that is too old', () => {
    const status = {
      ...okStatus,
      cli: { found: true, version: '2.1.294', supported: false },
    };
    expect(statusNotices({ connection: 'connected', ready: true, status })).toContainEqual({
      text: 'Claude Code 2.1.294 is too old (needs 2.1.295)',
      problem: true,
    });
  });

  it('hints, without an alert, at a version below the tested one', () => {
    const status = { ...okStatus, cli: { found: true, version: '2.1.310', supported: true } };
    expect(statusNotices({ connection: 'connected', ready: true, status })).toContainEqual({
      text: 'Claude Code 2.1.310 has not been tested (tested: 2.1.332)',
      problem: false,
    });
  });

  it('says Claude Code was not found', () => {
    const status = { ...okStatus, cli: { found: false, version: null, supported: false } };
    expect(statusNotices({ connection: 'connected', ready: true, status })).toContainEqual({
      text: 'Claude Code not found',
      problem: true,
    });
  });

  it('says nothing about Claude Code before the app is ready', () => {
    const status = { ...okStatus, agentsReachable: false, cli: { ...okStatus.cli, found: false } };
    expect(statusNotices({ connection: 'connected', ready: false, status })).toEqual([
      { text: 'API connected', problem: false },
    ]);
  });

  it('counts damaged spool lines', () => {
    expect(
      statusNotices({
        connection: 'connected',
        ready: true,
        status: { ...okStatus, spoolDamaged: 1 },
      }),
    ).toContainEqual({ text: '1 damaged spool line kept', problem: true });
    expect(
      statusNotices({
        connection: 'connected',
        ready: true,
        status: { ...okStatus, spoolDamaged: 3 },
      }),
    ).toContainEqual({ text: '3 damaged spool lines kept', problem: true });
  });
});
