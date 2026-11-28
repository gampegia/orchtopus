import { describe, expect, it } from 'vitest';
import type { AppSnapshot, ProjectView, SessionView } from './api-types';
import { applyStreamMessage, initialClientState } from './client-state';

function session(id: string, task = id): SessionView {
  return {
    id,
    projectId: 'acme-app',
    task,
    branch: `orch/${task}`,
    worktreePath: `C:\\demo\\acme-app\\.claude\\worktrees\\${task}`,
    type: 'feature',
    state: 'running',
    stateReason: null,
    contextPct: null,
    mode: 'auto',
    model: null,
    effort: null,
    terminal: { id: null, status: 'none' },
    createdAt: '2026-11-27T09:00:00.000Z',
  };
}

function project(id: string): ProjectView {
  return {
    id,
    name: id,
    path: `C:\\demo\\${id}`,
    defaultBranch: 'main',
    remotes: [],
    provider: null,
    checkCommands: { test: null, lint: null, typecheck: null },
    copyList: [],
    branchPrefix: 'orch/',
    lastStart: { model: null, effort: null, mode: 'auto' },
  };
}

function snapshot(overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return { ...initialClientState(), ...overrides };
}

describe('applyStreamMessage', () => {
  it('session message replaces the session by id', () => {
    const state = snapshot({ sessions: [session('s1'), session('s2')] });
    const changed = { ...session('s1'), state: 'needs-you' as const };
    const next = applyStreamMessage(state, { v: 1, kind: 'session', session: changed });
    expect(next.sessions).toEqual([changed, session('s2')]);
    expect(state.sessions[0]?.state).toBe('running');
  });

  it('session message appends an unknown session', () => {
    const state = snapshot({ sessions: [session('s1')] });
    const next = applyStreamMessage(state, { v: 1, kind: 'session', session: session('s2') });
    expect(next.sessions.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('session-removed drops it', () => {
    const state = snapshot({ sessions: [session('s1'), session('s2')] });
    const next = applyStreamMessage(state, { v: 1, kind: 'session-removed', sessionId: 's1' });
    expect(next.sessions.map((s) => s.id)).toEqual(['s2']);
  });

  it('project and project-removed replace and drop by id', () => {
    const state = snapshot({ projects: [project('acme-app')] });
    const renamed = { ...project('acme-app'), name: 'acme-web' };
    const replaced = applyStreamMessage(state, { v: 1, kind: 'project', project: renamed });
    expect(replaced.projects).toEqual([renamed]);
    const dropped = applyStreamMessage(replaced, {
      v: 1,
      kind: 'project-removed',
      projectId: 'acme-app',
    });
    expect(dropped.projects).toEqual([]);
  });

  it('status message sets status and ready', () => {
    const state = snapshot();
    const status = { ...state.status, agentsReachable: true };
    const next = applyStreamMessage(state, { v: 1, kind: 'status', status, ready: true });
    expect(next.status).toEqual(status);
    expect(next.ready).toBe(true);
  });

  it('snapshot replaces everything', () => {
    const state = snapshot({ sessions: [session('s1')], projects: [project('acme-app')] });
    const fresh = snapshot({ ready: true, sessions: [session('s9')] });
    const next = applyStreamMessage(state, { v: 1, kind: 'snapshot', snapshot: fresh });
    expect(next).toEqual(fresh);
  });
});
