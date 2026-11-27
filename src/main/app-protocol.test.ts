import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { APP_ORIGIN } from '../shared/app-origin';
import {
  APP_SCHEME_PRIVILEGES,
  contentTypeFor,
  createAppProtocolHandler,
  resolveAppPath,
} from './app-protocol';

const root = resolve('out/renderer');

describe('APP_ORIGIN', () => {
  it('is app://orchtopus', () => {
    expect(APP_ORIGIN).toBe('app://orchtopus');
  });
});

describe('APP_SCHEME_PRIVILEGES', () => {
  it('registers app as a standard, secure scheme without bypassing CSP', () => {
    expect(APP_SCHEME_PRIVILEGES).toEqual({
      scheme: 'app',
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    });
  });
});

describe('resolveAppPath', () => {
  it.each([
    ['app://orchtopus/', 'index.html'],
    ['app://orchtopus/index.html', 'index.html'],
    ['app://orchtopus/assets/index-abc.js', join('assets', 'index-abc.js')],
    ['app://orchtopus/assets/a%20b.css', join('assets', 'a b.css')],
    ['app://orchtopus/index.html?x=1#top', 'index.html'],
    // The URL parser removes dot segments before the path is resolved.
    ['app://orchtopus/assets/../index.html', 'index.html'],
    // Encoded dot segments are dot segments too, and cannot climb above the root.
    ['app://orchtopus/assets/%2e%2e/%2e%2e/package.json', 'package.json'],
  ])('maps %s inside the root', (url, relative) => {
    expect(resolveAppPath(url, root)).toBe(join(root, relative));
  });

  it.each([
    'app://orchtopus/..%2F..%2Fpackage.json',
    'app://orchtopus/%2e%2e%2fmain%2findex.js',
    'app://orchtopus/..%5C..%5Cpackage.json',
    'app://orchtopus/C:%5CWindows%5Cwin.ini',
    'app://orchtopus/%5C%5Cserver%5Cshare',
    'app://orchtopus/index.html%00.js',
    'app://orchtopus/%E0%A4%A',
    'app://other/index.html',
    'file:///C:/acme-app/index.html',
    'http://localhost:5173/index.html',
    'not a url',
  ])('rejects %s', (url) => {
    expect(resolveAppPath(url, root)).toBeNull();
  });
});

describe('contentTypeFor', () => {
  it.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['main.js', 'text/javascript; charset=utf-8'],
    ['chunk.mjs', 'text/javascript; charset=utf-8'],
    ['app.css', 'text/css; charset=utf-8'],
    ['data.json', 'application/json; charset=utf-8'],
    ['main.js.map', 'application/json; charset=utf-8'],
    ['logo.svg', 'image/svg+xml'],
    ['logo.PNG', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['font.woff2', 'font/woff2'],
    ['module.wasm', 'application/wasm'],
    ['unknown.xyz', 'application/octet-stream'],
    ['noextension', 'application/octet-stream'],
  ])('%s is %s', (file, type) => {
    expect(contentTypeFor(file)).toBe(type);
  });
});

describe('createAppProtocolHandler', () => {
  function handlerWith(files: Record<string, string>) {
    const readFile = vi.fn((path: string) => {
      const content = files[path];
      if (content === undefined) {
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      }
      return Promise.resolve(Buffer.from(content));
    });
    return { handle: createAppProtocolHandler(root, readFile), readFile };
  }

  it('serves a file from the root with its type and nosniff', async () => {
    const { handle } = handlerWith({ [join(root, 'index.html')]: '<!doctype html>' });
    const response = await handle(new Request('app://orchtopus/index.html'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('<!doctype html>');
  });

  it('answers 404 for a missing file', async () => {
    const { handle } = handlerWith({});
    const response = await handle(new Request('app://orchtopus/missing.js'));
    expect(response.status).toBe(404);
  });

  it('answers 404 for a path outside the root without reading it', async () => {
    const { handle, readFile } = handlerWith({});
    const response = await handle(new Request('app://orchtopus/..%2F..%2Fpackage.json'));
    expect(response.status).toBe(404);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('answers 405 for anything but GET and HEAD', async () => {
    const { handle, readFile } = handlerWith({ [join(root, 'index.html')]: 'x' });
    const response = await handle(new Request('app://orchtopus/index.html', { method: 'POST' }));
    expect(response.status).toBe(405);
    expect(readFile).not.toHaveBeenCalled();
  });
});
