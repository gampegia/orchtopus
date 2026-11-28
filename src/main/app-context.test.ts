import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StreamMessage } from '../shared/api-types';
import { createAppContext, type AppContext } from './app-context';
import { resolveDataPaths } from './data-folder';
import { openStore, type Store } from './store/event-log';
import { makeTempDir, stepClock, type TempDir } from './store/testing';

let temp: TempDir;
let store: Store;
let ctx: AppContext;
const clock = stepClock();

beforeEach(() => {
  temp = makeTempDir();
  store = openStore(temp.file('state.db'));
  ctx = createAppContext({
    paths: resolveDataPaths({ env: { ORCHTOPUS_DATA_DIR: temp.dir }, appData: temp.dir }),
    store,
  });
});

afterEach(() => {
  store.close();
  temp.remove();
});

function addSession(): void {
  store.append({
    id: 'e1',
    type: 'project.added',
    at: clock(),
    projectId: 'acme-app',
    payload: {
      name: 'acme-app',
      path: 'C:\\demo\\acme-app',
      config: { schemaVersion: 1, id: 'acme-app', defaultBranch: 'main', copyList: [] },
    },
  });
  store.append({
    id: 'e2',
    type: 'session.created',
    at: clock(),
    projectId: 'acme-app',
    sessionId: 's1',
    payload: {
      task: 'upload-fix',
      branch: 'orch/upload-fix',
      worktreePath: 'C:\\demo\\acme-app\\.claude\\worktrees\\upload-fix',
      mode: 'auto',
      model: null,
      effort: null,
    },
  });
}

describe('app context', () => {
  it('starts not ready with an empty snapshot', () => {
    const snapshot = ctx.snapshot();
    expect(snapshot.ready).toBe(false);
    expect(snapshot.projects).toEqual([]);
    expect(snapshot.sessions).toEqual([]);
  });

  it('builds project and session views from the projections', () => {
    addSession();
    const snapshot = ctx.snapshot();
    expect(snapshot.projects).toEqual([
      {
        id: 'acme-app',
        name: 'acme-app',
        path: 'C:\\demo\\acme-app',
        defaultBranch: 'main',
        copyList: [],
      },
    ]);
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0]).toMatchObject({
      id: 's1',
      task: 'upload-fix',
      state: 'idle',
      mode: 'auto',
      terminal: { id: null, status: 'none' },
    });
  });

  it('shows a start failure as the state reason', () => {
    addSession();
    store.append({
      id: 'e3',
      type: 'session.state',
      at: clock(),
      sessionId: 's1',
      payload: { word: 'failed', startFailed: 'Folder is not trusted' },
    });
    expect(ctx.sessionView('s1')).toMatchObject({
      state: 'failed',
      stateReason: 'Folder is not trusted',
    });
  });

  it('publishes status, ready and terminal changes once a publisher is attached', () => {
    addSession();
    const sent: StreamMessage[] = [];
    ctx.setReady(true);
    ctx.attachPublisher((message) => sent.push(message));
    ctx.setStatus({ agentsReachable: true });
    ctx.setTerminal('s1', { id: 'term-1', status: 'attached' });
    expect(sent.map((m) => m.kind)).toEqual(['status', 'session']);
    expect(sent[0]).toMatchObject({ ready: true, status: { agentsReachable: true } });
    expect(ctx.snapshot().sessions[0]?.terminal).toEqual({ id: 'term-1', status: 'attached' });
  });
});
