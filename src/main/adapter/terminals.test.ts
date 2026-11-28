// Terminal registry, the /v1/terminals/<id> stream and the trust terminal routes. The adapter
// is a stub whose handles are scripted, so the tests control output and exits.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { startTestApi, TEST_ORIGIN, type TestApi } from '../api/testing';
import { createTerminalRoutes } from '../api/routes/terminals';
import type { TerminalState } from '../app-context';
import type {
  AgentAdapter,
  SessionRef,
  TerminalExit,
  TerminalHandle,
  TerminalSize,
} from './agent-adapter';
import {
  createTerminalRegistry,
  createTerminalStreamHandler,
  MAX_INPUT_BYTES,
  TRUST_CLOSE_MS,
} from './terminals';

interface StubHandle extends TerminalHandle {
  written: string[];
  sizes: TerminalSize[];
  disposed: boolean;
  emit: (chunk: string) => void;
  exit: (info: TerminalExit) => void;
}

let counter = 0;

function stubHandle(): StubHandle {
  const data = new Set<(chunk: string) => void>();
  const exits = new Set<(info: TerminalExit) => void>();
  let output = '';
  counter += 1;
  const handle: StubHandle = {
    id: `term-${String(counter)}`,
    ready: Promise.resolve(),
    written: [],
    sizes: [],
    disposed: false,
    write: (d) => handle.written.push(d),
    resize: (cols, rows) => handle.sizes.push({ cols, rows }),
    onData: (cb) => {
      data.add(cb);
      return () => data.delete(cb);
    },
    onExit: (cb) => {
      exits.add(cb);
      return () => exits.delete(cb);
    },
    replay: () => output,
    dispose: () => {
      handle.disposed = true;
    },
    emit: (chunk) => {
      output += chunk;
      for (const cb of data) cb(chunk);
    },
    exit: (info) => {
      for (const cb of exits) cb(info);
    },
  };
  return handle;
}

function stubAdapter() {
  const attached: StubHandle[] = [];
  const plain: StubHandle[] = [];
  const attach = vi.fn<AgentAdapter['attach']>(() => {
    const h = stubHandle();
    attached.push(h);
    return Promise.resolve(h);
  });
  const openPlain = vi.fn<AgentAdapter['openPlain']>(() => {
    const h = stubHandle();
    plain.push(h);
    return Promise.resolve(h);
  });
  const adapter: AgentAdapter = {
    start: () => Promise.reject(new Error('not used')),
    list: () => Promise.resolve([]),
    resume: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    attach,
    openPlain,
  };
  return { adapter, attach, openPlain, attached, plain };
}

const REF: SessionRef = { sessionId: '0f1e2d3c-0000-4000-8000-000000000001', shortId: '0f1e2d3c' };
const SIZE = { cols: 120, rows: 40 };

let api: TestApi | undefined;
const sockets: WebSocket[] = [];
const temps: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const s of sockets.splice(0)) s.terminate();
  await api?.stop();
  api = undefined;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function connect(test: TestApi, id: string): WebSocket {
  const socket = new WebSocket(
    `ws://127.0.0.1:${String(test.server.port)}/v1/terminals/${id}`,
    ['orchtopus.v1', `orchtopus.token.${test.server.token()}`],
    { origin: TEST_ORIGIN },
  );
  socket.on('error', () => undefined);
  sockets.push(socket);
  return socket;
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => {
      resolve();
    });
    socket.once('error', reject);
  });
}

function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve) =>
    socket.once('close', (code) => {
      resolve(code);
    }),
  );
}

function frames(socket: WebSocket): { list: { text: string; binary: boolean }[] } {
  const list: { text: string; binary: boolean }[] = [];
  socket.on('message', (data: Buffer, isBinary: boolean) => {
    list.push({ text: data.toString('utf8'), binary: isBinary });
  });
  return { list };
}

async function until(fn: () => boolean): Promise<void> {
  const end = Date.now() + 5_000;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function withStream() {
  const stub = stubAdapter();
  const statuses: [string, TerminalState][] = [];
  const registry = createTerminalRegistry(stub.adapter, {
    onStatus: (sessionId, state) => statuses.push([sessionId, state]),
  });
  const test = (api = await startTestApi({ routes: createTerminalRoutes({ registry }) }));
  test.server.registerTerminalStream(createTerminalStreamHandler(registry));
  return { ...stub, registry, statuses, test };
}

describe('terminal registry', () => {
  it('one handle per session', async () => {
    const { adapter, attach, attached } = stubAdapter();
    const statuses: [string, TerminalState][] = [];
    const registry = createTerminalRegistry(adapter, {
      onStatus: (sessionId, state) => statuses.push([sessionId, state]),
    });
    const [a, b] = await Promise.all([
      registry.openForSession('upload-fix', REF, SIZE),
      registry.openForSession('upload-fix', REF, SIZE),
    ]);
    const c = await registry.openForSession('upload-fix', REF, SIZE);
    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(attached).toHaveLength(1);
    expect(attach).toHaveBeenCalledWith(REF, SIZE);
    expect(registry.get(a)).toBe(attached[0]);
    await until(() => statuses.some(([, s]) => s.status === 'attached'));
    expect(statuses[0]).toEqual(['upload-fix', { id: null, status: 'attaching' }]);
    expect(statuses.at(-1)).toEqual(['upload-fix', { id: a, status: 'attached' }]);

    const other = await registry.openForSession('report-export', REF, SIZE);
    expect(other).not.toBe(a);
    expect(attached).toHaveLength(2);
  });

  it('does not reopen a handle that ended elsewhere', async () => {
    const { adapter, attached } = stubAdapter();
    const statuses: [string, TerminalState][] = [];
    const registry = createTerminalRegistry(adapter, {
      onStatus: (sessionId, state) => statuses.push([sessionId, state]),
    });
    const id = await registry.openForSession('upload-fix', REF, SIZE);
    attached[0]?.exit({ code: 0, elsewhere: true });
    expect(statuses.at(-1)).toEqual(['upload-fix', { id: null, status: 'elsewhere' }]);
    expect(registry.get(id)).toBeUndefined();
    await new Promise((r) => setTimeout(r, 50));
    expect(attached).toHaveLength(1);

    // Only the user's action (Reattach) opens a new one.
    const again = await registry.openForSession('upload-fix', REF, SIZE);
    expect(again).not.toBe(id);
    expect(attached).toHaveLength(2);
    attached[1]?.exit({ code: 1, elsewhere: false });
    expect(statuses.at(-1)).toEqual(['upload-fix', { id: null, status: 'exited' }]);
  });

  it('reports a failed attach as exited and lets a later call retry', async () => {
    const { adapter, attach } = stubAdapter();
    const statuses: [string, TerminalState][] = [];
    attach.mockRejectedValueOnce(new Error('No session found'));
    const registry = createTerminalRegistry(adapter, {
      onStatus: (sessionId, state) => statuses.push([sessionId, state]),
    });
    await expect(registry.openForSession('upload-fix', REF, SIZE)).rejects.toThrow(
      'No session found',
    );
    expect(statuses.at(-1)).toEqual(['upload-fix', { id: null, status: 'exited' }]);
    await expect(registry.openForSession('upload-fix', REF, SIZE)).resolves.toMatch(/^term-/);
  });

  it('closeAll disposes every handle', async () => {
    const { adapter, attached, plain } = stubAdapter();
    const registry = createTerminalRegistry(adapter);
    await registry.openForSession('upload-fix', REF, SIZE);
    await registry.openTrust('C:\\acme-app', SIZE);
    registry.closeAll();
    expect(attached[0]?.disposed).toBe(true);
    expect(plain[0]?.disposed).toBe(true);
  });

  it('closeTrust writes /exit and kills the trust terminal after 5 s', async () => {
    vi.useFakeTimers();
    const { adapter, plain } = stubAdapter();
    const registry = createTerminalRegistry(adapter);
    const id = await registry.openTrust('C:\\acme-app', SIZE);
    expect(await registry.closeTrust(id)).toBe(true);
    expect(plain[0]?.written).toEqual(['/exit\r']);
    await vi.advanceTimersByTimeAsync(TRUST_CLOSE_MS - 1);
    expect(plain[0]?.disposed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(plain[0]?.disposed).toBe(true);
    expect(registry.get(id)).toBeUndefined();
  });

  it('closeTrust refuses a session terminal', async () => {
    const { adapter, attached } = stubAdapter();
    const registry = createTerminalRegistry(adapter);
    const id = await registry.openForSession('upload-fix', REF, SIZE);
    expect(await registry.closeTrust(id)).toBe(false);
    expect(attached[0]?.written).toEqual([]);
  });
});

describe('terminal stream', () => {
  it('the stream replays then streams', async () => {
    const { registry, attached, test } = await withStream();
    const id = await registry.openForSession('upload-fix', REF, SIZE);
    const h = attached[0];
    h?.emit('earlier output\r\n');
    const first = connect(test, id);
    const got = frames(first);
    await opened(first);
    await until(() => got.list.length === 1);
    h?.emit('live chunk');
    await until(() => got.list.length === 2);
    expect(got.list).toEqual([
      { text: 'earlier output\r\n', binary: true },
      { text: 'live chunk', binary: true },
    ]);

    // A second client sees the same replay; input from either goes to the one PTY.
    const second = connect(test, id);
    const got2 = frames(second);
    await opened(second);
    await until(() => got2.list.length === 1);
    expect(got2.list[0]?.text).toBe('earlier output\r\nlive chunk');
    first.send(JSON.stringify({ type: 'input', data: 'ls\r' }));
    second.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
    await until(() => (h?.written.length ?? 0) === 1 && (h?.sizes.length ?? 0) === 1);
    expect(h?.written).toEqual(['ls\r']);
    expect(h?.sizes).toEqual([{ cols: 80, rows: 24 }]);

    // The PTY ending closes its streams.
    const code = closed(first);
    h?.exit({ code: 0, elsewhere: true });
    expect(await code).toBe(1000);
  });

  it('rejects an oversize input frame with 1008', async () => {
    const { registry, attached, test } = await withStream();
    const id = await registry.openForSession('upload-fix', REF, SIZE);
    const socket = connect(test, id);
    await opened(socket);
    const code = closed(socket);
    socket.send(JSON.stringify({ type: 'input', data: 'x'.repeat(MAX_INPUT_BYTES + 1) }));
    expect(await code).toBe(1008);
    expect(attached[0]?.written).toEqual([]);

    // Exactly the limit is accepted.
    const ok = connect(test, id);
    await opened(ok);
    ok.send(JSON.stringify({ type: 'input', data: 'y'.repeat(MAX_INPUT_BYTES) }));
    await until(() => attached[0]?.written.length === 1);
  });

  it.each([
    ['not json', 'hello'],
    ['unknown type', JSON.stringify({ type: 'paste', data: 'x' })],
    ['resize out of range', JSON.stringify({ type: 'resize', cols: 501, rows: 24 })],
    ['resize zero', JSON.stringify({ type: 'resize', cols: 80, rows: 0 })],
    ['resize not integer', JSON.stringify({ type: 'resize', cols: 80.5, rows: 24 })],
    ['extra field', JSON.stringify({ type: 'input', data: 'x', exec: true })],
  ])('closes the socket with 1008 on %s', async (_label, frame) => {
    const { registry, attached, test } = await withStream();
    const id = await registry.openForSession('upload-fix', REF, SIZE);
    const socket = connect(test, id);
    await opened(socket);
    const code = closed(socket);
    socket.send(frame);
    expect(await code).toBe(1008);
    expect(attached[0]?.written).toEqual([]);
    expect(attached[0]?.sizes).toEqual([]);
  });

  it('closes a binary client frame with 1008', async () => {
    const { registry, test } = await withStream();
    const id = await registry.openForSession('upload-fix', REF, SIZE);
    const socket = connect(test, id);
    await opened(socket);
    const code = closed(socket);
    socket.send(Buffer.from(JSON.stringify({ type: 'input', data: 'x' })), { binary: true });
    expect(await code).toBe(1008);
  });

  it('closes a stream for an unknown terminal id with 1008', async () => {
    const { test } = await withStream();
    const socket = connect(test, 'no-such-terminal');
    expect(await closed(socket)).toBe(1008);
  });
});

describe('trust terminal routes', () => {
  function tempFolder(): string {
    const dir = mkdtempSync(join(tmpdir(), 'orch-trust-'));
    temps.push(dir);
    return dir;
  }

  async function post(test: TestApi, body: unknown): Promise<Response> {
    return test.request('/v1/terminals/trust', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('POST /v1/terminals/trust opens plain claude in the folder', async () => {
    const { openPlain, test, registry } = await withStream();
    const dir = tempFolder();
    const res = await post(test, { path: dir });
    expect(res.status).toBe(200);
    const { terminalId } = (await res.json()) as { terminalId: string };
    expect(registry.get(terminalId)).toBeDefined();
    expect(openPlain).toHaveBeenCalledWith(dir, { cols: 120, rows: 30 });
  });

  it.each([
    ['a missing path', {}],
    ['a relative path', { path: 'acme-app' }],
    ['a folder that does not exist', { path: join(tmpdir(), 'orch-no-such-folder-acme') }],
  ])('POST /v1/terminals/trust answers 422 for %s', async (_label, body) => {
    const { openPlain, test } = await withStream();
    const res = await post(test, body);
    expect(res.status).toBe(422);
    expect(openPlain).not.toHaveBeenCalled();
  });

  it('DELETE /v1/terminals/:id closes only trust terminals', async () => {
    const { test, registry, plain, attached } = await withStream();
    const res = await post(test, { path: tempFolder() });
    const { terminalId } = (await res.json()) as { terminalId: string };
    const del = await test.request(`/v1/terminals/${terminalId}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect(plain[0]?.written).toEqual(['/exit\r']);

    const sessionTerminal = await registry.openForSession('upload-fix', REF, SIZE);
    const refused = await test.request(`/v1/terminals/${sessionTerminal}`, { method: 'DELETE' });
    expect(refused.status).toBe(404);
    expect(attached[0]?.written).toEqual([]);
    const unknown = await test.request('/v1/terminals/term-none', { method: 'DELETE' });
    expect(unknown.status).toBe(404);
  });
});
