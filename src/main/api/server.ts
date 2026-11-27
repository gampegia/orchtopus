// The local API: HTTP and WebSocket on 127.0.0.1 only. Every request and stream needs the
// per-installation token; Host and Origin are checked first (see auth.ts). Writes api.json for
// the hook helper once it listens and deletes it on close.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import type { DataPaths } from '../data-folder';
import type { AppSnapshot, ApiError, StreamMessage } from '../../shared/api-types';
import { checkHttpRequest, checkUpgrade, type AuthPolicy } from './auth';
import { removePortFile, writePortFile } from './port-file';
import { createRouter, HttpError, type RouteTable } from './router';
import { createStreamHub, type TerminalStreamHandler } from './streams';
import { ensureToken, renewToken } from './token-file';

export type { TerminalStreamHandler } from './streams';

export const DEFAULT_API_PORT = 47620;
export const MAX_BODY_BYTES = 1024 * 1024;
const HOST = '127.0.0.1';

export interface ApiServerOptions {
  paths: DataPaths;
  preferredPort: number;
  allowedOrigins: readonly string[];
  routes: RouteTable;
  /** The state sent as the first message of every event stream. */
  snapshot: () => AppSnapshot;
  onTokenRenewed?: () => void;
  /** Where unexpected route errors go. Never receives the token. */
  log?: (message: string) => void;
}

// Members are function properties, so callers can pass them on (`ctx.attachPublisher(api.publish)`).
export interface ApiServer {
  readonly port: number;
  readonly address: () => AddressInfo;
  readonly token: () => string;
  readonly publish: (message: StreamMessage) => void;
  readonly registerTerminalStream: (handler: TerminalStreamHandler) => void;
  /** Deletes api.json, closes every stream and the server. Safe to call twice. */
  readonly close: () => Promise<void>;
}

const STATUS_TEXT: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  421: 'Misdirected Request',
};

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): void {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  };
  if (body === undefined) {
    res.writeHead(status, headers).end();
    return;
  }
  const text = JSON.stringify(body);
  res
    .writeHead(status, {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(text)),
    })
    .end(text);
}

function sendError(
  res: ServerResponse,
  status: number,
  extra: Record<string, string> = {},
  message?: string,
  field?: string,
): void {
  const body: ApiError = { error: message ?? STATUS_TEXT[status] ?? 'Error' };
  if (field !== undefined) body.field = field;
  send(res, status, body, extra);
}

function isJson(contentType: string | undefined): boolean {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() === 'application/json';
}

function hasBody(req: IncomingMessage): boolean {
  const length = req.headers['content-length'];
  return req.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0');
}

class BodyTooLarge extends Error {}

/** Reads the body up to MAX_BODY_BYTES; larger bodies reject with BodyTooLarge. */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.off('data', onData);
        // Keep draining so the client can read the 413 instead of a reset.
        req.resume();
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => {
      if (size <= MAX_BODY_BYTES) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function rejectUpgrade(socket: Duplex, status: number): void {
  const text = STATUS_TEXT[status] ?? 'Error';
  socket.end(
    `HTTP/1.1 ${String(status)} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

function listen(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

export async function startApiServer(options: ApiServerOptions): Promise<ApiServer> {
  const { paths } = options;
  const log =
    options.log ??
    ((message: string): void => {
      console.warn(message);
    });
  let token = await ensureToken(paths.tokenFile);
  let port = 0;
  const policy: AuthPolicy = {
    get port() {
      return port;
    },
    token: () => token,
    allowedOrigins: options.allowedOrigins,
  };
  const hub = createStreamHub({ snapshot: options.snapshot });

  const routes: RouteTable = {
    ...options.routes,
    'POST /v1/token/renew': async () => {
      token = await renewToken(paths.tokenFile);
      hub.closeStale(token);
      options.onTokenRenewed?.();
      return { status: 200, body: { token } };
    },
  };
  const route = createRouter(routes);

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const decision = checkHttpRequest({ method: req.method, headers: req.headers }, policy);
    if (decision.kind === 'reject') {
      req.resume();
      sendError(res, decision.status, decision.corsHeaders);
      return;
    }
    if (decision.kind === 'preflight') {
      req.resume();
      send(res, 204, undefined, decision.corsHeaders);
      return;
    }
    const cors = decision.corsHeaders;
    const method = req.method ?? 'GET';
    const path = new URL(req.url ?? '/', `http://${HOST}`).pathname;
    const match = route(method, path);
    if (match.kind !== 'found') {
      req.resume();
      sendError(res, match.kind === 'not-found' ? 404 : 405, cors);
      return;
    }

    let body: unknown;
    if (method === 'POST' || hasBody(req)) {
      if (!isJson(req.headers['content-type'])) {
        req.resume();
        sendError(res, 415, cors);
        return;
      }
      if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
        req.resume();
        sendError(res, 413, cors);
        return;
      }
      let raw: Buffer;
      try {
        raw = await readBody(req);
      } catch (error) {
        if (error instanceof BodyTooLarge) {
          sendError(res, 413, cors);
          return;
        }
        throw error;
      }
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as unknown;
        } catch {
          sendError(res, 400, cors, 'Invalid JSON');
          return;
        }
      }
    } else {
      req.resume();
    }

    try {
      const result = await match.handler({ params: match.params, body });
      send(res, result.status, result.body, cors);
    } catch (error) {
      if (error instanceof HttpError) {
        sendError(res, error.status, cors, error.message, error.field);
        return;
      }
      log(
        `API route ${method} ${path} failed: ${error instanceof Error ? error.message : 'error'}`,
      );
      sendError(res, 500, cors, 'Internal error');
    }
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendError(res, 500, {}, 'Internal error');
      else res.destroy();
    });
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => undefined);
    const decision = checkUpgrade({ headers: req.headers }, policy);
    if (decision.kind === 'reject') {
      rejectUpgrade(socket, decision.status);
      return;
    }
    const path = new URL(req.url ?? '/', `http://${HOST}`).pathname;
    if (!hub.accepts(path)) {
      rejectUpgrade(socket, 404);
      return;
    }
    hub.handleUpgrade(req, socket, head, decision.token);
  });

  try {
    await listen(server, options.preferredPort);
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'EADDRINUSE') throw error;
    await listen(server, 0);
  }
  const address = server.address() as AddressInfo;
  port = address.port;
  await writePortFile(paths.apiFile, {
    port,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });

  let closing: Promise<void> | null = null;
  return {
    port,
    address: () => address,
    token: () => token,
    publish: (message) => {
      hub.publish(message);
    },
    registerTerminalStream: (handler) => {
      hub.registerTerminalStream(handler);
    },
    close: () => {
      closing ??= (async () => {
        await removePortFile(paths.apiFile);
        hub.closeAll();
        await new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
          server.closeAllConnections();
        });
      })();
      return closing;
    },
  };
}
