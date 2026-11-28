import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InspectResult, ProjectView, SetupCheckResponse } from '../../../shared/api-types';
import { claudeConfigPaths } from '../../claude/claude-home';
import { resolveDataPaths } from '../../data-folder';
import { createProjectService } from '../../projects/project-service';
import { createActionRunner } from '../../store/actions';
import { openStore, type Store } from '../../store/event-log';
import { makeTempDir, stepClock, type TempDir } from '../../store/testing';
import { createTempRepo, isolatedGitEnv, type TempRepo } from '../../test-helpers/temp-repo';
import { startTestApi, type TestApi } from '../testing';
import { createProjectRoutes } from './projects';

let api: TestApi;
let temp: TempDir;
let store: Store;
let repo: TempRepo;
let claudeDir: string;

beforeAll(() => {
  for (const [key, value] of Object.entries(isolatedGitEnv())) vi.stubEnv(key, value);
});
afterAll(() => {
  vi.unstubAllEnvs();
});
beforeEach(async () => {
  repo = await createTempRepo();
  claudeDir = mkdtempSync(join(tmpdir(), 'orchtopus-claude-home-'));
  temp = makeTempDir();
  store = openStore(temp.file('state.db'));
  const service = createProjectService({
    paths: resolveDataPaths({ env: { ORCHTOPUS_DATA_DIR: temp.dir }, appData: temp.dir }),
    store,
    actions: createActionRunner(store, stepClock()),
    clock: stepClock(),
    cliStatus: () => ({ found: true, version: '2.1.332', supported: true }),
    claudePaths: claudeConfigPaths({ CLAUDE_CONFIG_DIR: claudeDir }, claudeDir),
    env: {},
  });
  api = await startTestApi({ routes: createProjectRoutes({ service }) });
});
afterEach(async () => {
  await api.stop();
  store.close();
  temp.remove();
  await repo.cleanup();
  rmSync(claudeDir, { recursive: true, force: true });
});

function post(path: string, body: unknown): Promise<Response> {
  return api.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const addBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  path: repo.root,
  checkCommands: { test: 'npm test', lint: null, typecheck: null },
  copyList: ['.env'],
  branchPrefix: 'orch/',
  requestId: 'req-route-0001',
  ...overrides,
});

describe('project routes', () => {
  it('POST /v1/projects/inspect answers the inspection', async () => {
    const res = await post('/v1/projects/inspect', { path: repo.root });
    expect(res.status).toBe(200);
    const body = (await res.json()) as InspectResult;
    expect(body.repo.ok).toBe(true);
    expect(body.copyList).toEqual(['.env']);
    expect(body.setup).toHaveLength(12);
  });

  it('POST /v1/projects/inspect rejects a relative path with 422', async () => {
    const res = await post('/v1/projects/inspect', { path: 'acme-app' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ field: 'path' });
  });

  it('POST /v1/projects adds, repeats by requestId, and validates fields', async () => {
    const res = await post('/v1/projects', addBody());
    expect(res.status).toBe(201);
    const view = (await res.json()) as ProjectView;
    expect(view.id).toBe('acme-app');
    const again = await post('/v1/projects', addBody());
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(view);

    for (const [field, value] of [
      ['copyList', ['../x']],
      ['branchPrefix', '/bad'],
      ['requestId', 'a b'],
      ['checkCommands', { test: 1, lint: null, typecheck: null }],
    ] as const) {
      const bad = await post('/v1/projects', addBody({ [field]: value, requestId: 'req-x-1' }));
      expect(bad.status, field).toBe(422);
      const body = (await bad.json()) as { field?: string };
      expect(body.field?.split('.')[0], field).toBe(field);
    }
  });

  it('POST /v1/projects stores a blank check command as null', async () => {
    const res = await post(
      '/v1/projects',
      addBody({ checkCommands: { test: '  ', lint: ' npm run lint ', typecheck: null } }),
    );
    const view = (await res.json()) as ProjectView;
    expect(view.checkCommands).toEqual({ test: null, lint: 'npm run lint', typecheck: null });
  });

  it('POST /v1/projects/:id/setup-check and DELETE /v1/projects/:id', async () => {
    await post('/v1/projects', addBody());
    const check = await post('/v1/projects/acme-app/setup-check', {});
    expect(check.status).toBe(200);
    expect(((await check.json()) as SetupCheckResponse).items).toHaveLength(12);

    const del = await api.request('/v1/projects/acme-app', { method: 'DELETE' });
    expect(del.status).toBe(204);
    const again = await api.request('/v1/projects/acme-app', { method: 'DELETE' });
    expect(again.status).toBe(404);
  });
});
