// Route table of the local API. Keys are '<METHOD> <path>' with ':param' segments, for example
// 'POST /v1/sessions/:id/stop'. Handlers get decoded params and the parsed JSON body.

export interface RouteRequest {
  params: Record<string, string>;
  /** The parsed JSON body, or undefined when the request had none. */
  body: unknown;
}

export interface RouteResponse {
  status: number;
  body?: unknown;
}

export type RouteHandler = (req: RouteRequest) => Promise<RouteResponse>;

export type RouteTable = Record<string, RouteHandler>;

/** Thrown by a handler (or `parseBody`) to answer with a status and an `ApiError` body. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export type RouteMatch =
  | { kind: 'found'; handler: RouteHandler; params: Record<string, string> }
  | { kind: 'not-found' }
  | { kind: 'method-not-allowed' };

interface CompiledRoute {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

const METHODS = new Set(['GET', 'POST', 'DELETE']);

function compile(key: string, handler: RouteHandler): CompiledRoute {
  const [method, path, ...rest] = key.split(' ');
  if (method === undefined || path === undefined || rest.length > 0 || !METHODS.has(method)) {
    throw new Error(`invalid route key: ${key}`);
  }
  if (!path.startsWith('/')) throw new Error(`route path must start with /: ${key}`);
  return { method, segments: path.slice(1).split('/'), handler };
}

/**
 * A decoded param must not be empty, `.` or `..`, nor contain `/`, `\` or NUL. Defence in depth:
 * later routes may build paths from ids.
 */
function isSafeParam(value: string): boolean {
  return value !== '' && value !== '.' && value !== '..' && !/[/\\\0]/.test(value);
}

/** Matches one route; null when the path does not fit. Params are URI-decoded. */
function matchSegments(route: CompiledRoute, parts: string[]): Record<string, string> | null {
  if (route.segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (const [i, segment] of route.segments.entries()) {
    const part = parts[i] ?? '';
    if (segment.startsWith(':')) {
      let value: string;
      try {
        value = decodeURIComponent(part);
      } catch {
        return null;
      }
      if (!isSafeParam(value)) return null;
      params[segment.slice(1)] = value;
    } else if (segment !== part) {
      return null;
    }
  }
  return params;
}

export function createRouter(table: RouteTable): (method: string, path: string) => RouteMatch {
  const routes = Object.entries(table).map(([key, handler]) => compile(key, handler));
  return (method, path) => {
    const parts = path.slice(1).split('/');
    let pathKnown = false;
    for (const route of routes) {
      const params = matchSegments(route, parts);
      if (params === null) continue;
      if (route.method === method) return { kind: 'found', handler: route.handler, params };
      pathKnown = true;
    }
    return pathKnown ? { kind: 'method-not-allowed' } : { kind: 'not-found' };
  };
}
