import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { StreamMessage } from '../../shared/api-types';
import { emptySnapshot, startTestApi, TEST_ORIGIN, type TestApi } from './testing';

let api: TestApi | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await api?.stop();
  api = undefined;
});

function connect(
  test: TestApi,
  path: string,
  options: { protocols?: string[]; origin?: string } = {},
): WebSocket {
  const protocols = options.protocols ?? ['orchtopus.v1', `orchtopus.token.${test.server.token()}`];
  const socket = new WebSocket(`ws://127.0.0.1:${String(test.server.port)}${path}`, protocols, {
    origin: options.origin ?? TEST_ORIGIN,
  });
  // Refused upgrades and terminate() emit errors; the tests look at events, not at errors.
  socket.on('error', () => undefined);
  sockets.push(socket);
  return socket;
}

/** Collects parsed messages and resolves when `count` have arrived. */
function collect(socket: WebSocket, count: number): Promise<unknown[]> {
  const messages: unknown[] = [];
  return new Promise((resolve, reject) => {
    socket.on('message', (data: Buffer) => {
      messages.push(JSON.parse(data.toString('utf8')));
      if (messages.length === count) resolve(messages);
    });
    socket.on('error', reject);
  });
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => {
      resolve();
    });
    socket.once('error', reject);
  });
}

/** Resolves with the HTTP status of a refused upgrade. */
function refusedWith(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    socket.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
    });
    socket.once('open', () => {
      reject(new Error('upgrade was accepted'));
    });
  });
}

function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve) =>
    socket.once('close', (code) => {
      resolve(code);
    }),
  );
}

describe('event stream', () => {
  it('event stream sends a snapshot first, then published messages', async () => {
    const snapshot = { ...emptySnapshot(), ready: true };
    const test = (api = await startTestApi({ snapshot: () => snapshot }));
    const socket = connect(test, '/v1/events');
    const message: StreamMessage = { v: 1, kind: 'session-removed', sessionId: 'upload-fix' };
    // The snapshot is sent on connect; publish once it has arrived.
    socket.once('message', () => {
      test.server.publish(message);
    });
    const received = collect(socket, 2);
    await opened(socket);
    expect(socket.protocol).toBe('orchtopus.v1');
    expect(await received).toEqual([{ v: 1, kind: 'snapshot', snapshot }, message]);
  });

  it('refuses an upgrade without the token subprotocol', async () => {
    const test = (api = await startTestApi());
    expect(await refusedWith(connect(test, '/v1/events', { protocols: ['orchtopus.v1'] }))).toBe(
      401,
    );
    expect(
      await refusedWith(
        connect(test, '/v1/events', { protocols: ['orchtopus.v1', 'orchtopus.token.abc'] }),
      ),
    ).toBe(401);
  });

  it('refuses an upgrade from a foreign origin', async () => {
    const test = (api = await startTestApi());
    expect(await refusedWith(connect(test, '/v1/events', { origin: 'https://evil.test' }))).toBe(
      403,
    );
  });

  it('refuses an unknown stream path and terminal streams while no handler is registered', async () => {
    const test = (api = await startTestApi());
    expect(await refusedWith(connect(test, '/v1/nothing'))).toBe(404);
    expect(await refusedWith(connect(test, '/v1/terminals/t1'))).toBe(404);
  });

  it('hands terminal upgrades to the registered handler', async () => {
    const test = (api = await startTestApi());
    const seen: string[] = [];
    test.server.registerTerminalStream((terminalId, socket) => {
      seen.push(terminalId);
      socket.close(1008, 'unknown terminal');
    });
    const socket = connect(test, '/v1/terminals/term-1');
    expect(await closed(socket)).toBe(1008);
    expect(seen).toEqual(['term-1']);
  });

  it('closes event streams opened with a renewed token', async () => {
    const test = (api = await startTestApi());
    const socket = connect(test, '/v1/events');
    const first = collect(socket, 1);
    await opened(socket);
    await first;
    const closing = closed(socket);
    const response = await test.request('/v1/token/renew', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(200);
    expect(await closing).toBe(4401);
    // A stream with the new token works.
    const fresh = connect(test, '/v1/events');
    const again = collect(fresh, 1);
    await opened(fresh);
    expect(await again).toHaveLength(1);
  });
});
