// The app's terminals: one attach PTY per session (never reopened by itself, spec section 4 and
// Review Focus 3) and trust-step terminals. The stream handler serves /v1/terminals/<id>:
// replay as one binary frame, then live output as binary frames; client frames are validated
// JSON text, and anything else closes the socket with 1008. A client that falls more than
// MAX_BUFFERED_BYTES behind is closed with 1013.
import type { RawData, WebSocket } from 'ws';
import type { TerminalStreamHandler } from '../api/streams';
import { terminalClientMessageSchema } from '../api/schemas';
import type { TerminalState } from '../app-context';
import type { AgentAdapter, SessionRef, TerminalHandle, TerminalSize } from './agent-adapter';

export const MAX_INPUT_BYTES = 64 * 1024;
/** A client this far behind is closed; it reconnects and gets the replay instead. */
export const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const POLICY_VIOLATION = 1008;
const TRY_AGAIN_LATER = 1013;
const NORMAL_CLOSE = 1000;

export interface TerminalRegistry {
  /** The session's live terminal id, or a new attach PTY. */
  openForSession(sessionId: string, ref: SessionRef, size: TerminalSize): Promise<string>;
  openTrust(cwd: string, size: TerminalSize): Promise<string>;
  /** Kills a trust terminal without typing into it; false for any other id. */
  closeTrust(id: string): Promise<boolean>;
  get(id: string): TerminalHandle | undefined;
  /** Calls `cb` once when the terminal exits or is disposed; returns the unsubscribe. */
  onEnd(id: string, cb: () => void): () => void;
  /** Ends the session's attach PTY (before its worktree is removed); the session keeps running. */
  closeSession(sessionId: string): Promise<void>;
  closeAll(): void;
}

interface Entry {
  kind: 'session' | 'trust';
  handle: TerminalHandle;
  ended: Set<() => void>;
}

export function createTerminalRegistry(
  adapter: AgentAdapter,
  opts: {
    /** Receives every change of a session's terminal state (for SessionView.terminal). */
    onStatus?: (sessionId: string, state: TerminalState) => void;
  } = {},
): TerminalRegistry {
  const entries = new Map<string, Entry>();
  const sessions = new Map<string, Promise<string>>();
  const report = (sessionId: string, state: TerminalState): void => {
    opts.onStatus?.(sessionId, state);
  };

  const add = (kind: Entry['kind'], handle: TerminalHandle, onExit?: (e: boolean) => void) => {
    const entry: Entry = { kind, handle, ended: new Set() };
    entries.set(handle.id, entry);
    handle.onExit(({ elsewhere }) => {
      remove(handle.id);
      onExit?.(elsewhere);
    });
    return entry;
  };

  function remove(id: string): void {
    const entry = entries.get(id);
    if (!entry) return;
    entries.delete(id);
    for (const cb of [...entry.ended]) cb();
    entry.ended.clear();
  }

  const dispose = (id: string): void => {
    const entry = entries.get(id);
    if (!entry) return;
    remove(id);
    entry.handle.dispose();
  };

  return {
    openForSession: (sessionId, ref, size) => {
      const pending = sessions.get(sessionId);
      if (pending) return pending;
      report(sessionId, { id: null, status: 'attaching' });
      const opening = (async () => {
        let handle: TerminalHandle;
        try {
          handle = await adapter.attach(ref, size);
        } catch (error) {
          sessions.delete(sessionId);
          report(sessionId, { id: null, status: 'exited' });
          throw error;
        }
        add('session', handle, (elsewhere) => {
          sessions.delete(sessionId);
          // Never reattach here: that would take the session back from the other window.
          report(sessionId, { id: null, status: elsewhere ? 'elsewhere' : 'exited' });
        });
        report(sessionId, { id: handle.id, status: 'attaching' });
        void handle.ready.then(() => {
          if (entries.has(handle.id)) report(sessionId, { id: handle.id, status: 'attached' });
        });
        return handle.id;
      })();
      sessions.set(sessionId, opening);
      return opening;
    },

    openTrust: async (cwd, size) => {
      const handle = await adapter.openPlain(cwd, size);
      add('trust', handle);
      return handle.id;
    },

    closeTrust: (id) => {
      const entry = entries.get(id);
      if (entry?.kind !== 'trust') return Promise.resolve(false);
      // Kill without typing: the trust dialog is a select list with 'Yes, proceed' focused, so
      // any Enter (even after '/exit') would accept trust the user did not give. Claude Code
      // writes trust as soon as it is accepted, so a trust terminal has nothing left to save.
      dispose(id);
      return Promise.resolve(true);
    },

    get: (id) => entries.get(id)?.handle,

    onEnd: (id, cb) => {
      const entry = entries.get(id);
      if (!entry) {
        cb();
        return () => undefined;
      }
      entry.ended.add(cb);
      return () => entry.ended.delete(cb);
    },

    closeSession: async (sessionId) => {
      const pending = sessions.get(sessionId);
      if (!pending) return;
      let id: string;
      try {
        id = await pending;
      } catch {
        return;
      }
      // A newer open may have replaced the entry while this one was attaching.
      if (sessions.get(sessionId) === pending) sessions.delete(sessionId);
      dispose(id);
      report(sessionId, { id: null, status: 'none' });
    },

    closeAll: () => {
      for (const id of [...entries.keys()]) dispose(id);
      sessions.clear();
    },
  };
}

function text(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data as ArrayBuffer).toString('utf8');
}

/** Serves /v1/terminals/<id>; several clients may watch one terminal. */
export function createTerminalStreamHandler(registry: TerminalRegistry): TerminalStreamHandler {
  return (terminalId: string, socket: WebSocket) => {
    const handle = registry.get(terminalId);
    if (!handle) {
      socket.close(POLICY_VIOLATION, 'unknown terminal');
      return;
    }
    const send = (chunk: string): void => {
      if (socket.readyState !== socket.OPEN) return;
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        socket.close(TRY_AGAIN_LATER, 'client too slow');
        return;
      }
      socket.send(Buffer.from(chunk, 'utf8'), { binary: true });
    };
    // Replay and subscription happen in one tick, so no chunk is lost or sent twice.
    send(handle.replay());
    const offData = handle.onData(send);
    const offEnd = registry.onEnd(terminalId, () => {
      socket.close(NORMAL_CLOSE, 'terminal ended');
    });
    let rejected = false;
    const reject = (): void => {
      rejected = true;
      socket.close(POLICY_VIOLATION, 'invalid frame');
    };

    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (rejected) return;
      if (isBinary) {
        reject();
        return;
      }
      let value: unknown;
      try {
        value = JSON.parse(text(data));
      } catch {
        reject();
        return;
      }
      const parsed = terminalClientMessageSchema.safeParse(value);
      if (!parsed.success) {
        reject();
        return;
      }
      const message = parsed.data;
      if (message.type === 'input') {
        if (Buffer.byteLength(message.data, 'utf8') > MAX_INPUT_BYTES) {
          reject();
          return;
        }
        handle.write(message.data);
      } else {
        handle.resize(message.cols, message.rows);
      }
    });
    socket.on('close', () => {
      offData();
      offEnd();
    });
  };
}
