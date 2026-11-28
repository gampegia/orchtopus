import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseBody } from './schemas';
import { isPortUnavailable } from './server';
import { startTestApi, type TestApi } from './testing';

let api: TestApi | undefined;
let blocker: Server | undefined;

afterEach(async () => {
  await api?.stop();
  api = undefined;
  const held = blocker;
  blocker = undefined;
  if (held)
    await new Promise<void>((resolve) =>
      held.close(() => {
        resolve();
      }),
    );
});

async function started(options: Parameters<typeof startTestApi>[0] = {}): Promise<TestApi> {
  api = await startTestApi(options);
  return api;
}

/** A raw request with a chosen Host header (fetch does not allow setting Host). */
function rawGet(port: number, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('startApiServer', () => {
  it('listens on 127.0.0.1 only', async () => {
    const { server } = await started();
    expect(server.address().address).toBe('127.0.0.1');
  });

  it('falls back to a free port when the preferred one is taken', async () => {
    const held = createServer();
    blocker = held;
    await new Promise<void>((resolve) => held.listen(0, '127.0.0.1', resolve));
    const taken = (held.address() as AddressInfo).port;
    const { server, request } = await started({ preferredPort: taken });
    expect(server.port).not.toBe(taken);
    expect(server.port).toBeGreaterThan(0);
    expect((await request('/v1/health')).status).toBe(200);
  });

  it('takes a free port for a taken or a reserved (EACCES) preferred port only', () => {
    expect(isPortUnavailable(Object.assign(new Error('taken'), { code: 'EADDRINUSE' }))).toBe(true);
    expect(isPortUnavailable(Object.assign(new Error('reserved'), { code: 'EACCES' }))).toBe(true);
    expect(isPortUnavailable(Object.assign(new Error('other'), { code: 'EINVAL' }))).toBe(false);
    expect(isPortUnavailable(null)).toBe(false);
  });

  it('writes api.json with the port and removes it on close', async () => {
    const test = await started();
    const written = JSON.parse(readFileSync(test.paths.apiFile, 'utf8')) as Record<string, unknown>;
    expect(written['port']).toBe(test.server.port);
    expect(written['pid']).toBe(process.pid);
    expect(typeof written['startedAt']).toBe('string');
    expect(Number.isNaN(Date.parse(String(written['startedAt'])))).toBe(false);
    await test.server.close();
    expect(existsSync(test.paths.apiFile)).toBe(false);
  });

  it('closes the server even when api.json cannot be deleted', async () => {
    const test = await started();
    api = undefined;
    // A folder in place of api.json makes the delete fail.
    rmSync(test.paths.apiFile);
    mkdirSync(test.paths.apiFile);
    try {
      await expect(test.server.close()).rejects.toThrow();
      await expect(fetch(test.url('/v1/health'))).rejects.toThrow();
    } finally {
      test.temp.remove();
    }
  });

  it('sends the status line of a refused WebSocket upgrade', async () => {
    const { server } = await started();
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port: server.port,
        path: '/v1/events',
        headers: {
          host: `localhost:${String(server.port)}`,
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-version': '13',
          'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        },
      });
      req.on('response', (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(421);
  });

  it('GET /v1/health with the token returns apiVersion 1', async () => {
    const { request } = await started();
    const response = await request('/v1/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ apiVersion: 1, appVersion: '0.0.0-test' });
  });

  it('GET /v1/health without the token is 401', async () => {
    const { url } = await started();
    expect((await fetch(url('/v1/health'))).status).toBe(401);
  });

  it('rejects a foreign Host with 421 before checking the token', async () => {
    const { server } = await started();
    const status = await rawGet(server.port, '/v1/health', {
      host: `localhost:${String(server.port)}`,
      authorization: `Bearer ${server.token()}`,
    });
    expect(status).toBe(421);
  });

  it('GET /v1/state returns the snapshot', async () => {
    const { request } = await started();
    const body = (await (await request('/v1/state')).json()) as Record<string, unknown>;
    expect(body['ready']).toBe(false);
    expect(body['projects']).toEqual([]);
  });

  it('rejects a 2 MiB body with 413', async () => {
    const { request } = await started({
      routes: { 'POST /v1/echo': (req) => Promise.resolve({ status: 200, body: req.body }) },
    });
    const response = await request('/v1/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blob: 'x'.repeat(2 * 1024 * 1024) }),
    });
    expect(response.status).toBe(413);
  });

  it('answers a chunked upload over 1 MiB with 413 and closes the connection', async () => {
    const { server } = await started({
      routes: { 'POST /v1/echo': (req) => Promise.resolve({ status: 200, body: req.body }) },
    });
    const result = await new Promise<{ status: number; closed: boolean }>((resolve, reject) => {
      const chunk = Buffer.alloc(64 * 1024, 0x20);
      let status = 0;
      const req = httpRequest({
        host: '127.0.0.1',
        port: server.port,
        path: '/v1/echo',
        method: 'POST',
        headers: {
          host: `127.0.0.1:${String(server.port)}`,
          authorization: `Bearer ${server.token()}`,
          'content-type': 'application/json',
          'transfer-encoding': 'chunked',
        },
      });
      // Keeps sending until the server ends the connection; a server that drains forever
      // would never end it.
      const pump = setInterval(() => {
        if (!req.destroyed) req.write(chunk);
      }, 1);
      const deadline = setTimeout(() => {
        clearInterval(pump);
        req.destroy();
        resolve({ status, closed: false });
      }, 5000);
      req.on('response', (res) => {
        status = res.statusCode ?? 0;
        res.resume();
      });
      req.on('error', () => undefined);
      req.on('close', () => {
        clearInterval(pump);
        clearTimeout(deadline);
        if (status === 0) reject(new Error('closed before a response'));
        else resolve({ status, closed: true });
      });
    });
    expect(result).toEqual({ status: 413, closed: true });
  });

  it('rejects text/plain with 415', async () => {
    const { request } = await started({
      routes: { 'POST /v1/echo': (req) => Promise.resolve({ status: 200, body: req.body }) },
    });
    const response = await request('/v1/echo', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    expect(response.status).toBe(415);
  });

  it('passes params and the parsed body to the route, and answers bad JSON with 400', async () => {
    const { request } = await started({
      routes: {
        'POST /v1/things/:id/poke': (req) =>
          Promise.resolve({ status: 200, body: { params: req.params, body: req.body } }),
      },
    });
    const ok = await request('/v1/things/upload-fix/poke', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: '{"n":1}',
    });
    expect(await ok.json()).toEqual({ params: { id: 'upload-fix' }, body: { n: 1 } });
    const bad = await request('/v1/things/upload-fix/poke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(bad.status).toBe(400);
  });

  it('answers unknown routes with 404 and a known path with another method with 405', async () => {
    const { request } = await started();
    expect((await request('/v1/nothing')).status).toBe(404);
    expect((await request('/v1/health', { method: 'DELETE' })).status).toBe(405);
  });

  it('turns a validation error into 422 with the field', async () => {
    const schema = z.object({ task: z.string().min(1) });
    const { request } = await started({
      routes: {
        'POST /v1/validate': (req) => {
          const body = parseBody(schema, req.body);
          return Promise.resolve({ status: 200, body });
        },
      },
    });
    const response = await request('/v1/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"task":""}',
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body['field']).toBe('task');
    expect(typeof body['error']).toBe('string');
  });

  it('answers a throwing route with 500 and no details', async () => {
    const { request } = await started({
      routes: { 'GET /v1/boom': () => Promise.reject(new Error('secret detail')) },
    });
    const response = await request('/v1/boom');
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secret detail');
  });

  it('POST /v1/token/renew invalidates the old token', async () => {
    const test = await started();
    const old = test.server.token();
    const response = await test.request('/v1/token/renew', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(200);
    const { token } = (await response.json()) as { token: string };
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toBe(old);
    expect(test.server.token()).toBe(token);
    const withOld = await fetch(test.url('/v1/health'), {
      headers: { authorization: `Bearer ${old}` },
    });
    expect(withOld.status).toBe(401);
    const withNew = await fetch(test.url('/v1/health'), {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(withNew.status).toBe(200);
  });

  it('runs concurrent renews one after the other, and the last token wins', async () => {
    const test = await started();
    const renew = (): Promise<Response> =>
      test.request('/v1/token/renew', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
    const responses = await Promise.all([renew(), renew(), renew()]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    const tokens = await Promise.all(
      responses.map(async (r) => ((await r.json()) as { token: string }).token),
    );
    expect(new Set(tokens).size).toBe(3);
    expect(tokens).toContain(test.server.token());
    expect(readFileSync(test.paths.tokenFile, 'utf8')).toBe(test.server.token());
  });
});
