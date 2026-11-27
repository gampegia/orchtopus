import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { APP_HOST, APP_SCHEME } from '../shared/app-origin';
import { CONTENT_SECURITY_POLICY } from './security';

/**
 * Registration for the app scheme, passed to `protocol.registerSchemesAsPrivileged` before the
 * app is ready. `standard` gives pages a real origin (so CSP `'self'` means this origin only) and
 * relative URLs; `secure` makes it a secure context. It does not bypass CSP.
 */
export const APP_SCHEME_PRIVILEGES = {
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true },
} as const;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
};

/** The Content-Type for a served file, by extension; unknown types are not sniffed. */
export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/** Windows device names, reserved with any extension and in any case (`con`, `NUL.txt`). */
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * A decoded path segment that is an ordinary file or folder name: not empty, not a dot segment,
 * no separator, drive colon or NUL, not a Windows device name, and not ending in a dot or space
 * (Windows drops those, so the segment would name another file).
 */
function isPlainSegment(segment: string): boolean {
  return (
    segment !== '' &&
    segment !== '.' &&
    segment !== '..' &&
    !/[\\/:\0]/.test(segment) &&
    !WINDOWS_DEVICE_NAME.test(segment) &&
    !/[. ]$/.test(segment)
  );
}

/**
 * Maps an app URL to a file inside `root`, or null when the URL is not on the app origin, would
 * leave the root, or names something other than a plain file (encoded dot segments, separators,
 * drive letters, NUL, bad escapes, device names, trailing dots or spaces).
 * The root path itself maps to index.html.
 */
export function resolveAppPath(value: string, root: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;

  const raw = url.pathname === '/' ? ['index.html'] : url.pathname.slice(1).split('/');
  const segments: string[] = [];
  for (const part of raw) {
    let segment: string;
    try {
      segment = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (!isPlainSegment(segment)) return null;
    segments.push(segment);
  }

  const base = resolve(root);
  const file = join(base, ...segments);
  const inside = relative(base, file);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return null;
  return file;
}

/**
 * The CSP sent with HTML pages. The header adds `frame-ancestors`, which a `<meta>` CSP ignores,
 * so no other page can frame the app.
 */
export const DOCUMENT_CONTENT_SECURITY_POLICY = `${CONTENT_SECURITY_POLICY}; frame-ancestors 'none'`;

export type ReadFile = (path: string) => Promise<Uint8Array>;

function plainResponse(status: number): Response {
  return new Response(null, { status, headers: { 'X-Content-Type-Options': 'nosniff' } });
}

/** A `protocol.handle` handler that serves GET requests for files in `root` (405 otherwise). */
export function createAppProtocolHandler(
  root: string,
  readFile: ReadFile,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET') return plainResponse(405);
    const file = resolveAppPath(request.url, root);
    if (file === null) return plainResponse(404);
    let body: Uint8Array;
    try {
      body = await readFile(file);
    } catch {
      return plainResponse(404);
    }
    const contentType = contentTypeFor(file);
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
    };
    if (contentType.startsWith('text/html')) {
      headers['Content-Security-Policy'] = DOCUMENT_CONTENT_SECURITY_POLICY;
    }
    return new Response(body, { status: 200, headers });
  };
}
