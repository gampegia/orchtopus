// The renderer's client of the local API: JSON requests with the token, the event stream with
// reconnect, and terminal streams. Connection details come from the preload on demand, so a
// renewed token or a new port is picked up on the next request or reconnect.
import {
  STREAM_PROTOCOL,
  TOKEN_PROTOCOL_PREFIX,
  type ApiError,
  type StreamMessage,
} from '../../shared/api-types';
import type { ApiConnection, PreloadApi } from '../../shared/preload-api';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface TerminalSocket {
  /** Sends keyboard input to the terminal. */
  input(data: string): void;
  resize(cols: number, rows: number): void;
  onClose(callback: (code: number) => void): () => void;
  close(): void;
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string, body?: unknown): Promise<T>;
  /** Subscribes to `/v1/events`; returns a function that stops it. */
  subscribe(
    onMessage: (message: StreamMessage) => void,
    onConnection: (status: ConnectionStatus) => void,
  ): () => void;
  openTerminal(terminalId: string, onData: (chunk: Uint8Array) => void): TerminalSocket;
}

const FIRST_RETRY_MS = 250;
const MAX_RETRY_MS = 5000;

function wsUrl(connection: ApiConnection, path: string): string {
  return `${connection.baseUrl.replace(/^http:/, 'ws:')}${path}`;
}

function protocols(connection: ApiConnection): string[] {
  return [STREAM_PROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${connection.token}`];
}

async function readError(response: Response): Promise<ApiRequestError> {
  let body: Partial<ApiError> = {};
  try {
    body = (await response.json()) as Partial<ApiError>;
  } catch {
    // Not JSON; keep the status text.
  }
  return new ApiRequestError(
    response.status,
    typeof body.error === 'string' ? body.error : response.statusText,
    typeof body.field === 'string' ? body.field : undefined,
  );
}

function isStreamMessage(value: unknown): value is StreamMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { v?: unknown }).v === 1 &&
    typeof (value as { kind?: unknown }).kind === 'string'
  );
}

export function createApiClient(preload: PreloadApi): ApiClient {
  let cached: Promise<ApiConnection> | null = null;
  const connection = (fresh = false): Promise<ApiConnection> => {
    if (fresh || cached === null) {
      const next = preload.connection();
      cached = next;
      // A failed lookup is not cached.
      next.catch(() => {
        if (cached === next) cached = null;
      });
    }
    return cached;
  };

  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const send = async (conn: ApiConnection): Promise<Response> => {
      const headers: Record<string, string> = { Authorization: `Bearer ${conn.token}` };
      const init: RequestInit = { method, headers, cache: 'no-store' };
      if (method === 'POST' || body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body ?? {});
      }
      return fetch(`${conn.baseUrl}${path}`, init);
    };
    let response = await send(await connection());
    // The token may have been renewed: fetch the connection once more and retry once.
    if (response.status === 401) response = await send(await connection(true));
    if (!response.ok) throw await readError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  };

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    delete: (path, body) => request('DELETE', path, body),

    subscribe: (onMessage, onConnection) => {
      let stopped = false;
      let socket: WebSocket | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let delay = FIRST_RETRY_MS;
      const isStopped = (): boolean => stopped;

      const retry = (): void => {
        if (stopped) return;
        onConnection('closed');
        timer = setTimeout(() => {
          timer = null;
          void open(true);
        }, delay);
        delay = Math.min(delay * 2, MAX_RETRY_MS);
      };

      const open = async (fresh: boolean): Promise<void> => {
        if (stopped) return;
        onConnection('connecting');
        let conn: ApiConnection;
        try {
          // After a drop the token or port may have changed; ask the preload again.
          conn = await connection(fresh);
        } catch {
          retry();
          return;
        }
        // `stopped` may have changed while the connection was looked up.
        if (isStopped()) return;
        const ws = new WebSocket(wsUrl(conn, '/v1/events'), protocols(conn));
        socket = ws;
        ws.onopen = () => {
          delay = FIRST_RETRY_MS;
          onConnection('open');
        };
        ws.onmessage = (event: MessageEvent) => {
          if (typeof event.data !== 'string') return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(event.data);
          } catch {
            return;
          }
          if (isStreamMessage(parsed)) onMessage(parsed);
        };
        ws.onclose = () => {
          if (socket === ws) socket = null;
          retry();
        };
      };

      void open(false);
      return () => {
        stopped = true;
        if (timer !== null) clearTimeout(timer);
        socket?.close();
        socket = null;
        onConnection('closed');
      };
    },

    openTerminal: (terminalId, onData) => {
      const closeCallbacks = new Set<(code: number) => void>();
      const queue: string[] = [];
      let ws: WebSocket | null = null;
      let closed = false;

      const sendText = (text: string): void => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(text);
        else if (!closed) queue.push(text);
      };

      connection()
        .then((conn) => {
          if (closed) return;
          const socket = new WebSocket(
            wsUrl(conn, `/v1/terminals/${encodeURIComponent(terminalId)}`),
            protocols(conn),
          );
          socket.binaryType = 'arraybuffer';
          ws = socket;
          socket.onopen = () => {
            for (const text of queue.splice(0)) socket.send(text);
          };
          socket.onmessage = (event: MessageEvent) => {
            if (event.data instanceof ArrayBuffer) onData(new Uint8Array(event.data));
          };
          socket.onclose = (event: CloseEvent) => {
            closed = true;
            for (const callback of closeCallbacks) callback(event.code);
          };
        })
        .catch(() => {
          closed = true;
          for (const callback of closeCallbacks) callback(1006);
        });

      return {
        input: (data) => {
          sendText(JSON.stringify({ type: 'input', data }));
        },
        resize: (cols, rows) => {
          sendText(JSON.stringify({ type: 'resize', cols, rows }));
        },
        onClose: (callback) => {
          closeCallbacks.add(callback);
          return () => closeCallbacks.delete(callback);
        },
        close: () => {
          closed = true;
          queue.length = 0;
          ws?.close();
        },
      };
    },
  };
}
