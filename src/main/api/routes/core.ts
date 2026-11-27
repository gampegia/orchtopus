// Core routes: health and the app snapshot. `POST /v1/token/renew` lives in server.ts, which
// owns the token.
import { API_VERSION, type AppSnapshot, type HealthResponse } from '../../../shared/api-types';
import type { RouteTable } from '../router';

export function createCoreRoutes(deps: {
  appVersion: string;
  snapshot: () => AppSnapshot;
}): RouteTable {
  return {
    'GET /v1/health': () => {
      const body: HealthResponse = { apiVersion: API_VERSION, appVersion: deps.appVersion };
      return Promise.resolve({ status: 200, body });
    },
    'GET /v1/state': () => Promise.resolve({ status: 200, body: deps.snapshot() }),
  };
}
