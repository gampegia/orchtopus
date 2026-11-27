// Test helpers for the local API: a server on a temp data folder and small request helpers.
import { resolveDataPaths, type DataPaths } from '../data-folder';
import { makeTempDir, type TempDir } from '../store/testing';
import type { AppSnapshot } from '../../shared/api-types';
import { initialClientState } from '../../shared/client-state';
import { createCoreRoutes } from './routes/core';
import { startApiServer, type ApiServer } from './server';
import type { RouteTable } from './router';

export const TEST_ORIGIN = 'app://orchtopus';

export const emptySnapshot: () => AppSnapshot = initialClientState;

export interface TestApi {
  temp: TempDir;
  paths: DataPaths;
  server: ApiServer;
  url: (path: string) => string;
  /** fetch with Host and the current bearer token set. */
  request: (path: string, init?: RequestInit) => Promise<Response>;
  stop: () => Promise<void>;
}

export async function startTestApi(
  options: { preferredPort?: number; routes?: RouteTable; snapshot?: () => AppSnapshot } = {},
): Promise<TestApi> {
  const temp = makeTempDir();
  const paths = resolveDataPaths({ env: { ORCHTOPUS_DATA_DIR: temp.dir }, appData: temp.dir });
  const snapshot = options.snapshot ?? emptySnapshot;
  const server = await startApiServer({
    paths,
    preferredPort: options.preferredPort ?? 0,
    allowedOrigins: [TEST_ORIGIN],
    routes: { ...createCoreRoutes({ appVersion: '0.0.0-test', snapshot }), ...options.routes },
    snapshot,
  });
  const url = (path: string): string => `http://127.0.0.1:${String(server.port)}${path}`;
  return {
    temp,
    paths,
    server,
    url,
    request: (path, init = {}) => {
      const headers = new Headers(init.headers);
      if (!headers.has('authorization')) headers.set('authorization', `Bearer ${server.token()}`);
      return fetch(url(path), { ...init, headers });
    },
    stop: async () => {
      await server.close();
      temp.remove();
    },
  };
}
