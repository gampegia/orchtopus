// UI state of the renderer: the app state from the event stream, the connection, the selected
// session and which dialog is asked for. The event stream is the only writer of `state`.
import { create } from 'zustand';
import type { ProjectView, SessionView, StreamMessage } from '../../shared/api-types';
import {
  applyStreamMessage,
  initialClientState,
  type ClientState,
} from '../../shared/client-state';
import type { ConnectionState } from '../../shared/state-words';
import { createApiClient, type ApiClient, type ConnectionStatus } from '../api/client';

/** A dialog the shell asks for; the dialogs themselves render from this (Task 15). */
export type DialogRequest =
  | { kind: 'add-project' }
  | { kind: 'new-session'; projectId: string }
  | { kind: 'setup-check'; projectId: string };

export interface AppStore {
  connection: ConnectionState;
  state: ClientState;
  selectedSessionId: string | null;
  dialog: DialogRequest | null;
  /** A failed project action, shown under that project. */
  projectError: { projectId: string; message: string } | null;
  select: (id: string | null) => void;
  openDialog: (request: DialogRequest) => void;
  closeDialog: () => void;
  setProjectError: (error: { projectId: string; message: string } | null) => void;
  apply: (message: StreamMessage) => void;
  setConnection: (status: ConnectionStatus) => void;
}

/** Sessions in list order: grouped by project in project order. */
export function sessionsInListOrder(state: ClientState): SessionView[] {
  return state.projects.flatMap((project) =>
    state.sessions.filter((session) => session.projectId === project.id),
  );
}

/** The selection after a state change: kept while the session exists, else the first row. */
function keepSelection(state: ClientState, selected: string | null): string | null {
  const ordered = sessionsInListOrder(state);
  if (selected !== null && ordered.some((session) => session.id === selected)) return selected;
  return ordered[0]?.id ?? null;
}

export const useAppStore = create<AppStore>()((set) => ({
  connection: 'connecting',
  state: initialClientState(),
  selectedSessionId: null,
  dialog: null,
  projectError: null,
  select: (id) => {
    set({ selectedSessionId: id });
  },
  openDialog: (request) => {
    set({ dialog: request });
  },
  closeDialog: () => {
    set({ dialog: null });
  },
  setProjectError: (error) => {
    set({ projectError: error });
  },
  apply: (message) => {
    set((current) => {
      const state = applyStreamMessage(current.state, message);
      return { state, selectedSessionId: keepSelection(state, current.selectedSessionId) };
    });
  },
  setConnection: (status) => {
    set((current) => ({
      // A drop after a working connection is "lost"; before the first one it is "connecting".
      connection:
        status === 'open'
          ? 'connected'
          : current.connection === 'connected' || current.connection === 'lost'
            ? 'lost'
            : 'connecting',
    }));
  },
}));

export function selectedSession(store: AppStore): SessionView | null {
  return store.state.sessions.find((session) => session.id === store.selectedSessionId) ?? null;
}

export function projectOf(store: AppStore, session: SessionView | null): ProjectView | null {
  if (session === null) return null;
  return store.state.projects.find((project) => project.id === session.projectId) ?? null;
}

let client: ApiClient | null = null;

/** The API client, created on first use from the preload bridge. */
export function apiClient(): ApiClient {
  client ??= createApiClient(window.orchtopus);
  return client;
}

/** Subscribes the store to the event stream; returns a function that stops it. */
export function connectStore(): () => void {
  const { apply, setConnection } = useAppStore.getState();
  return apiClient().subscribe(apply, setConnection);
}
