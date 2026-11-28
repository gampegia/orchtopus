// WebSocket streams of the local API (ws in noServer mode). The server checks Host, Origin and
// the token before handing an upgrade here.
//   /v1/events           snapshot on connect, then every published StreamMessage (JSON text)
//   /v1/terminals/<id>   handed to the terminal stream handler (registered by the terminals module)
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  STREAM_PROTOCOL,
  TOKEN_RENEWED_CLOSE_CODE,
  type AppSnapshot,
  type StreamMessage,
} from '../../shared/api-types';

/** Called after an upgrade passed the auth checks. An unknown id closes the socket with 1008. */
export type TerminalStreamHandler = (terminalId: string, socket: WebSocket) => void;

export interface StreamHub {
  /** True when the path is a stream this hub serves right now. */
  accepts(path: string): boolean;
  /** `path` is the request path the server already parsed from `req.url`. */
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    token: string,
    path: string,
  ): void;
  publish(message: StreamMessage): void;
  registerTerminalStream(handler: TerminalStreamHandler): void;
  /** Closes every stream opened with a token other than `current`. */
  closeStale(current: string): void;
  closeAll(): void;
}

const EVENTS_PATH = '/v1/events';
const TERMINAL_PATH = /^\/v1\/terminals\/([A-Za-z0-9._-]{1,128})$/;

export function createStreamHub(options: { snapshot: () => AppSnapshot }): StreamHub {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
    // The token subprotocol is never echoed back; only the version is selected.
    handleProtocols: (protocols) => (protocols.has(STREAM_PROTOCOL) ? STREAM_PROTOCOL : false),
  });
  const tokens = new Map<WebSocket, string>();
  const eventSockets = new Set<WebSocket>();
  let terminalHandler: TerminalStreamHandler | null = null;

  const track = (socket: WebSocket, token: string): void => {
    tokens.set(socket, token);
    socket.on('close', () => {
      tokens.delete(socket);
      eventSockets.delete(socket);
    });
    // A socket error (peer reset) is followed by close; without a listener ws would throw.
    socket.on('error', () => undefined);
  };

  return {
    accepts: (path) =>
      path === EVENTS_PATH || (terminalHandler !== null && TERMINAL_PATH.test(path)),

    handleUpgrade: (req, socket, head, token, path) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        track(ws, token);
        if (path === EVENTS_PATH) {
          eventSockets.add(ws);
          const message: StreamMessage = { v: 1, kind: 'snapshot', snapshot: options.snapshot() };
          ws.send(JSON.stringify(message));
          return;
        }
        const terminalId = TERMINAL_PATH.exec(path)?.[1];
        if (terminalId !== undefined && terminalHandler !== null) {
          terminalHandler(terminalId, ws);
          return;
        }
        ws.close(1008, 'unknown stream');
      });
    },

    publish: (message) => {
      const text = JSON.stringify(message);
      for (const ws of eventSockets) {
        if (ws.readyState === ws.OPEN) ws.send(text);
      }
    },

    registerTerminalStream: (handler) => {
      terminalHandler = handler;
    },

    closeStale: (current) => {
      for (const [ws, token] of tokens) {
        if (token === current) continue;
        ws.close(TOKEN_RENEWED_CLOSE_CODE, 'token renewed');
        // A peer that does not answer the close handshake is cut off.
        setTimeout(() => {
          ws.terminate();
        }, 2000).unref();
      }
    },

    closeAll: () => {
      for (const ws of tokens.keys()) ws.terminate();
      wss.close();
    },
  };
}
