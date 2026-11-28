// Request checks of the local API, in this order: Host (421), Origin (403), CORS preflight,
// token (401). The token is compared in constant time and never logged.
import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { STREAM_PROTOCOL, TOKEN_PROTOCOL_PREFIX } from '../../shared/api-types';

export interface AuthPolicy {
  port: number;
  /** The current token (it changes on renew). */
  token: () => string;
  /** Browser origins allowed to call the API. Requests without an Origin are allowed too. */
  allowedOrigins: readonly string[];
}

type Headers = IncomingHttpHeaders | Readonly<Record<string, string | undefined>>;

export type HttpDecision =
  | { kind: 'reject'; status: 401 | 403 | 405 | 421; corsHeaders?: Record<string, string> }
  | { kind: 'preflight'; corsHeaders: Record<string, string> }
  | { kind: 'ok'; corsHeaders: Record<string, string> };

export type UpgradeDecision =
  { kind: 'reject'; status: 401 | 403 | 421 } | { kind: 'ok'; token: string };

/** A token: 32 random bytes as lowercase hex. */
export const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function header(headers: Headers, name: string): string | undefined {
  const value = (headers as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? value[0] : value;
}

/** The Host header must name exactly the loopback address and port the server listens on. */
export function isAllowedHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${String(port)}`;
}

/** No Origin (hook helper, Node clients) or one of the allowed browser origins. */
export function isAllowedOrigin(origin: string | undefined, allowed: readonly string[]): boolean {
  return origin === undefined || allowed.includes(origin);
}

/** Constant-time comparison of a presented token with the expected one. */
export function tokenMatches(presented: string | null | undefined, expected: string): boolean {
  if (presented === null || presented === undefined || !TOKEN_PATTERN.test(presented)) {
    return false;
  }
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearerToken(authorization: string | undefined): string | null {
  const match = /^Bearer ([0-9a-f]{64})$/.exec(authorization ?? '');
  return match?.[1] ?? null;
}

function corsHeaders(origin: string | undefined): Record<string, string> {
  return origin === undefined ? {} : { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}

export function checkHttpRequest(
  request: { method: string | undefined; headers: Headers },
  policy: AuthPolicy,
): HttpDecision {
  const { headers } = request;
  if (!isAllowedHost(header(headers, 'host'), policy.port)) return { kind: 'reject', status: 421 };
  const origin = header(headers, 'origin');
  if (!isAllowedOrigin(origin, policy.allowedOrigins)) return { kind: 'reject', status: 403 };
  if (request.method === 'OPTIONS') {
    // A preflight comes from a browser and always carries an Origin.
    if (origin === undefined) return { kind: 'reject', status: 405 };
    return {
      kind: 'preflight',
      corsHeaders: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, DELETE',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      },
    };
  }
  if (!tokenMatches(bearerToken(header(headers, 'authorization')), policy.token())) {
    // An allowed page must be able to read the 401, so it can fetch the new token and retry.
    return origin === undefined
      ? { kind: 'reject', status: 401 }
      : { kind: 'reject', status: 401, corsHeaders: corsHeaders(origin) };
  }
  return { kind: 'ok', corsHeaders: corsHeaders(origin) };
}

/** The subprotocols a WebSocket client offered, from `Sec-WebSocket-Protocol`. */
export function offeredProtocols(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * Checks a WebSocket upgrade: Host, Origin, the `orchtopus.v1` subprotocol and the token
 * subprotocol `orchtopus.token.<hex>`. Returns the token used, so a renew can close the stream.
 */
export function checkUpgrade(request: { headers: Headers }, policy: AuthPolicy): UpgradeDecision {
  const { headers } = request;
  if (!isAllowedHost(header(headers, 'host'), policy.port)) return { kind: 'reject', status: 421 };
  if (!isAllowedOrigin(header(headers, 'origin'), policy.allowedOrigins)) {
    return { kind: 'reject', status: 403 };
  }
  const protocols = offeredProtocols(header(headers, 'sec-websocket-protocol'));
  const token = protocols
    .find((p) => p.startsWith(TOKEN_PROTOCOL_PREFIX))
    ?.slice(TOKEN_PROTOCOL_PREFIX.length);
  const expected = policy.token();
  if (!protocols.includes(STREAM_PROTOCOL) || !tokenMatches(token, expected)) {
    return { kind: 'reject', status: 401 };
  }
  return { kind: 'ok', token: expected };
}
