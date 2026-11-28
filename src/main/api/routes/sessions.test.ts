// Session routes with a stub service: validation answers 422 with the field, valid bodies reach
// the service unchanged.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionView } from '../../../shared/api-types';
import type { SessionService } from '../../sessions/session-service';
import { startTestApi, type TestApi } from '../testing';
import { createSessionRoutes } from './sessions';

let api: TestApi | undefined;

afterEach(async () => {
  await api?.stop();
  api = undefined;
});

function stubService() {
  return {
    start: vi.fn<SessionService['start']>(() =>
      Promise.resolve({ id: 's1', state: 'running' } as SessionView),
    ),
    open: vi.fn<SessionService['open']>(() => Promise.resolve({ terminalId: 't1' })),
    stop: vi.fn<SessionService['stop']>(() => Promise.resolve()),
    remove: vi.fn<SessionService['remove']>(() => Promise.resolve()),
    reveal: vi.fn<SessionService['reveal']>(() => Promise.resolve()),
    vscodeAvailable: vi.fn<SessionService['vscodeAvailable']>(() => Promise.resolve(false)),
    rewriteSessionFiles: vi.fn<SessionService['rewriteSessionFiles']>(() => Promise.resolve()),
    resumePending: vi.fn<SessionService['resumePending']>(() => Promise.resolve()),
  } satisfies SessionService;
}

async function setup() {
  const service = stubService();
  api = await startTestApi({ routes: createSessionRoutes({ service }) });
  const send = (method: string, path: string, body: unknown) =>
    (api as TestApi).request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { service, send };
}

const START = {
  projectId: 'acme-app',
  task: 'upload-fix',
  branch: 'orch/upload-fix',
  base: 'remote',
  prompt: null,
  model: null,
  effort: null,
  mode: 'auto',
  requestId: 'request-0001',
};

describe('session routes', () => {
  it('POST /v1/sessions starts with the parsed input (the service uses its request id)', async () => {
    const { service, send } = await setup();
    const res = await send('POST', '/v1/sessions', START);
    expect(res.status).toBe(201);
    expect(service.start).toHaveBeenCalledWith(START);
  });

  it('POST /v1/sessions answers 422 on the task field for an invalid task name', async () => {
    const { service, send } = await setup();
    const res = await send('POST', '/v1/sessions', { ...START, task: 'Upload Fix' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ field: 'task' });
    expect(service.start).not.toHaveBeenCalled();
  });

  it('open, stop, remove and reveal validate their bodies', async () => {
    const { service, send } = await setup();
    expect((await send('POST', '/v1/sessions/s1/open', { cols: 0, rows: 30 })).status).toBe(422);
    const opened = await send('POST', '/v1/sessions/s1/open', { cols: 120, rows: 30 });
    expect(await opened.json()).toEqual({ terminalId: 't1' });
    expect((await send('POST', '/v1/sessions/s1/stop', {})).status).toBe(204);
    expect(service.stop).toHaveBeenCalledWith('s1');
    expect((await send('DELETE', '/v1/sessions/s1', {})).status).toBe(422);
    expect((await send('DELETE', '/v1/sessions/s1', { confirm: true })).status).toBe(204);
    expect(service.remove).toHaveBeenCalledWith('s1', true);
    expect((await send('POST', '/v1/sessions/s1/reveal', { target: 'finder' })).status).toBe(422);
    expect((await send('POST', '/v1/sessions/s1/reveal', { target: 'vscode' })).status).toBe(204);
  });
});
