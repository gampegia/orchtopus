import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HookEnvelope } from '../../../shared/hook-envelope';
import { openStore, readEvents, type Store } from '../../store/event-log';
import { getSessionState } from '../../store/projections';
import { makeTempDir, type TempDir } from '../../store/testing';
import { startTestApi, type TestApi } from '../testing';
import { createHookRoutes, setEnvelopeListener } from './hooks';

const CLAUDE_ID = 'c0ffee00-0000-4000-8000-000000000001';
const WORKTREE = 'C:\\repos\\acme-app\\.claude\\worktrees\\upload-fix';

let temp: TempDir;
let store: Store;
let api: TestApi;

beforeEach(async () => {
  temp = makeTempDir();
  store = openStore(temp.file('state.db'));
  api = await startTestApi({ routes: createHookRoutes({ store }) });
});

afterEach(async () => {
  setEnvelopeListener(null);
  await api.stop();
  store.close();
  temp.remove();
});

function envelope(overrides: Partial<HookEnvelope> = {}): HookEnvelope {
  return {
    v: 1,
    id: randomUUID(),
    at: '2026-11-27T09:00:05.000Z',
    mode: 'hook',
    hook: 'Stop',
    sessionId: CLAUDE_ID,
    cwd: WORKTREE,
    fields: { stop_hook_active: false },
    ...overrides,
  };
}

function post(body: unknown): Promise<Response> {
  return api.request('/v1/hooks/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function addSession(): void {
  store.append({
    id: randomUUID(),
    type: 'session.created',
    at: '2026-11-27T09:00:00.000Z',
    projectId: 'acme-app',
    sessionId: 'upload-fix',
    payload: {
      task: 'upload-fix',
      branch: 'upload-fix',
      worktreePath: WORKTREE,
      mode: 'manual',
      model: null,
      effort: null,
    },
  });
  store.append({
    id: randomUUID(),
    type: 'session.started',
    at: '2026-11-27T09:00:01.000Z',
    projectId: 'acme-app',
    sessionId: 'upload-fix',
    payload: { claudeSessionId: CLAUDE_ID, shortId: 'c0ffee00' },
  });
}

describe('POST /v1/hooks/events', () => {
  it('appends a new envelope with 202 and a known id with 200', async () => {
    addSession();
    const item = envelope();
    expect((await post(item)).status).toBe(202);
    expect((await post(item)).status).toBe(200);
    const events = readEvents(store.db).filter((e) => e.type === 'hook.received');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: item.id, sessionId: 'upload-fix' });
    expect(getSessionState(store.db, 'upload-fix')?.lastStopAt).toBe(item.at);
  });

  it('calls the envelope listener once per new envelope', async () => {
    const seen: string[] = [];
    setEnvelopeListener((e) => {
      seen.push(e.id);
    });
    const item = envelope();
    await post(item);
    await post(item);
    expect(seen).toEqual([item.id]);
  });

  it('answers 202 when the listener throws', async () => {
    setEnvelopeListener(() => {
      throw new Error('listener failed');
    });
    expect((await post(envelope())).status).toBe(202);
  });

  it('answers 422 for a body that is not an envelope', async () => {
    expect((await post({ v: 2 })).status).toBe(422);
    expect((await post(envelope({ id: 'bad id!' }))).status).toBe(422);
    expect(readEvents(store.db)).toHaveLength(0);
  });

  it('drops fields outside the kept list', async () => {
    const item = { ...envelope(), fields: { tool_name: 'Bash', prompt: 'secret prompt text' } };
    await post(item);
    const stored = JSON.stringify(readEvents(store.db));
    expect(stored).not.toContain('secret prompt text');
  });

  it('needs the token', async () => {
    const response = await api.request('/v1/hooks/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
      body: JSON.stringify(envelope()),
    });
    expect(response.status).toBe(401);
  });
});
