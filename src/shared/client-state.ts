// The renderer's copy of the app state, kept current by the event stream. Pure functions only.
import type { AppSnapshot, StreamMessage } from './api-types';

export type ClientState = AppSnapshot;

export function initialClientState(): ClientState {
  return {
    ready: false,
    status: {
      cli: { found: false, version: null, supported: false },
      agentsReachable: false,
      spoolDamaged: 0,
      vscodeAvailable: false,
    },
    projects: [],
    sessions: [],
  };
}

/** Replaces the item with the same id, or appends it; keeps the order of the others. */
function upsert<T extends { id: string }>(items: readonly T[], item: T): T[] {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) return [...items, item];
  return items.map((existing, i) => (i === index ? item : existing));
}

/** Returns the state after one stream message. The input state is never changed. */
export function applyStreamMessage(state: ClientState, message: StreamMessage): ClientState {
  switch (message.kind) {
    case 'snapshot':
      return message.snapshot;
    case 'project':
      return { ...state, projects: upsert(state.projects, message.project) };
    case 'project-removed':
      return { ...state, projects: state.projects.filter((p) => p.id !== message.projectId) };
    case 'session':
      return { ...state, sessions: upsert(state.sessions, message.session) };
    case 'session-removed':
      return { ...state, sessions: state.sessions.filter((s) => s.id !== message.sessionId) };
    case 'status':
      return { ...state, status: message.status, ready: message.ready };
  }
}
