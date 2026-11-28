import { describe, expect, it } from 'vitest';
import { createRouter, type RouteHandler } from './router';

const handler: RouteHandler = () => Promise.resolve({ status: 204 });
const route = createRouter({ 'POST /v1/sessions/:id/stop': handler });

describe('createRouter', () => {
  it('passes a decoded param', () => {
    const match = route('POST', '/v1/sessions/upload%2Dfix/stop');
    expect(match).toMatchObject({ kind: 'found', params: { id: 'upload-fix' } });
  });

  it('refuses decoded params with a path separator, NUL, . or ..', () => {
    for (const part of ['a%2Fb', 'a%5Cb', 'a%00b', '..', '%2E%2E', '.%2E', '.']) {
      expect(route('POST', `/v1/sessions/${part}/stop`).kind, part).toBe('not-found');
    }
  });

  it('keeps dots inside a name', () => {
    expect(route('POST', '/v1/sessions/acme.app/stop').kind).toBe('found');
  });
});
