import { describe, expect, it } from 'vitest';
import { checkHttpRequest, checkUpgrade, type AuthPolicy } from './auth';

const TOKEN = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const policy: AuthPolicy = {
  port: 47620,
  token: () => TOKEN,
  allowedOrigins: ['app://orchtopus'],
};

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { host: '127.0.0.1:47620', authorization: `Bearer ${TOKEN}`, ...extra };
}

describe('checkHttpRequest', () => {
  it('rejects a foreign Host', () => {
    for (const host of ['localhost:47620', 'evil.test', '127.0.0.1:1', '127.0.0.1']) {
      expect(checkHttpRequest({ method: 'GET', headers: headers({ host }) }, policy)).toEqual({
        kind: 'reject',
        status: 421,
      });
    }
    expect(checkHttpRequest({ method: 'GET', headers: { authorization: 'x' } }, policy)).toEqual({
      kind: 'reject',
      status: 421,
    });
  });

  it('rejects a missing or wrong token', () => {
    const missing = { host: '127.0.0.1:47620' };
    for (const h of [
      missing,
      headers({ authorization: `Bearer ${OTHER}` }),
      headers({ authorization: TOKEN }),
      headers({ authorization: `Bearer ${TOKEN}x` }),
      headers({ authorization: 'Bearer ' }),
    ]) {
      expect(checkHttpRequest({ method: 'GET', headers: h }, policy)).toEqual({
        kind: 'reject',
        status: 401,
      });
    }
  });

  it('lets the app origin read a 401', () => {
    expect(
      checkHttpRequest(
        { method: 'GET', headers: { host: '127.0.0.1:47620', origin: 'app://orchtopus' } },
        policy,
      ),
    ).toEqual({
      kind: 'reject',
      status: 401,
      corsHeaders: { 'Access-Control-Allow-Origin': 'app://orchtopus', Vary: 'Origin' },
    });
  });

  it('accepts no Origin and the app origin', () => {
    expect(checkHttpRequest({ method: 'GET', headers: headers() }, policy)).toEqual({
      kind: 'ok',
      corsHeaders: {},
    });
    expect(
      checkHttpRequest({ method: 'GET', headers: headers({ origin: 'app://orchtopus' }) }, policy),
    ).toEqual({
      kind: 'ok',
      corsHeaders: { 'Access-Control-Allow-Origin': 'app://orchtopus', Vary: 'Origin' },
    });
  });

  it('rejects https://evil.test with 403', () => {
    for (const origin of ['https://evil.test', 'null', 'app://orchtopus.evil.test']) {
      expect(checkHttpRequest({ method: 'GET', headers: headers({ origin }) }, policy)).toEqual({
        kind: 'reject',
        status: 403,
      });
    }
  });

  it('answers CORS preflight only for allowed origins', () => {
    const preflight = { host: '127.0.0.1:47620', 'access-control-request-method': 'POST' };
    expect(
      checkHttpRequest(
        { method: 'OPTIONS', headers: { ...preflight, origin: 'app://orchtopus' } },
        policy,
      ),
    ).toEqual({
      kind: 'preflight',
      corsHeaders: {
        'Access-Control-Allow-Origin': 'app://orchtopus',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      },
    });
    expect(
      checkHttpRequest(
        { method: 'OPTIONS', headers: { ...preflight, origin: 'https://evil.test' } },
        policy,
      ),
    ).toEqual({ kind: 'reject', status: 403 });
    expect(checkHttpRequest({ method: 'OPTIONS', headers: preflight }, policy)).toEqual({
      kind: 'reject',
      status: 405,
    });
  });
});

describe('checkUpgrade', () => {
  const ws = (extra: Record<string, string> = {}): Record<string, string> => ({
    host: '127.0.0.1:47620',
    'sec-websocket-protocol': `orchtopus.v1, orchtopus.token.${TOKEN}`,
    ...extra,
  });

  it('accepts the token subprotocol and returns the token used', () => {
    expect(checkUpgrade({ headers: ws({ origin: 'app://orchtopus' }) }, policy)).toEqual({
      kind: 'ok',
      token: TOKEN,
    });
  });

  it('rejects a foreign Host, a foreign Origin and a missing or wrong token', () => {
    expect(checkUpgrade({ headers: ws({ host: 'localhost:47620' }) }, policy)).toEqual({
      kind: 'reject',
      status: 421,
    });
    expect(checkUpgrade({ headers: ws({ origin: 'https://evil.test' }) }, policy)).toEqual({
      kind: 'reject',
      status: 403,
    });
    for (const protocols of [
      'orchtopus.v1',
      `orchtopus.token.${TOKEN}`,
      `orchtopus.v1, orchtopus.token.${OTHER}`,
    ]) {
      expect(
        checkUpgrade({ headers: ws({ 'sec-websocket-protocol': protocols }) }, policy),
      ).toEqual({ kind: 'reject', status: 401 });
    }
  });
});
