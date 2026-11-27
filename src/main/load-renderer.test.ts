import { describe, expect, it, vi } from 'vitest';
import { APP_ORIGIN } from '../shared/app-origin';
import { isLocalDevServerUrl, loadRenderer, resolveRendererTarget } from './load-renderer';

describe('isLocalDevServerUrl', () => {
  it.each([
    'http://localhost:5173/',
    'http://localhost:5173',
    'http://127.0.0.1:5173/',
    'http://[::1]:5173/',
    'http://localhost/',
  ])('accepts %s', (url) => {
    expect(isLocalDevServerUrl(url)).toBe(true);
  });

  it.each([
    'https://localhost:5173/',
    'https://example.com/',
    'http://example.com/',
    'http://localhost.evil.example/',
    'http://localhost@evil.example/',
    'http://127.0.0.2:5173/',
    'http://0.0.0.0:5173/',
    'file:///C:/acme-app/index.html',
    'ws://localhost:5173/',
    'localhost:5173',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(isLocalDevServerUrl(url)).toBe(false);
  });
});

const builtPage = `${APP_ORIGIN}/index.html`;

describe('resolveRendererTarget', () => {
  it('uses a local dev server URL when unpackaged, in its parsed form', () => {
    const warn = vi.fn();
    expect(
      resolveRendererTarget({ packaged: false, rendererUrl: 'http://LOCALHOST:5173', warn }),
    ).toEqual({ url: 'http://localhost:5173/', origin: 'http://localhost:5173', devServer: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses the built page and warns when the URL is not a local dev server', () => {
    const warn = vi.fn();
    expect(
      resolveRendererTarget({ packaged: false, rendererUrl: 'https://example.com/', warn }),
    ).toEqual({ url: builtPage, origin: APP_ORIGIN, devServer: false });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('ignores the URL when packaged', () => {
    const warn = vi.fn();
    expect(
      resolveRendererTarget({ packaged: true, rendererUrl: 'http://localhost:5173/', warn }),
    ).toEqual({ url: builtPage, origin: APP_ORIGIN, devServer: false });
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses the built page when no URL is set', () => {
    expect(
      resolveRendererTarget({ packaged: false, rendererUrl: undefined, warn: vi.fn() }),
    ).toEqual({ url: builtPage, origin: APP_ORIGIN, devServer: false });
  });
});

describe('loadRenderer', () => {
  function fakeWindow() {
    return { loadURL: vi.fn(() => Promise.resolve()) };
  }

  it('loads the given URL', async () => {
    const window = fakeWindow();
    await loadRenderer(window, builtPage, vi.fn());
    expect(window.loadURL).toHaveBeenCalledWith(builtPage);
  });

  it('passes a load failure on to the caller', async () => {
    const window = fakeWindow();
    window.loadURL.mockReturnValueOnce(Promise.reject(new Error('ERR_FILE_NOT_FOUND')));
    await expect(loadRenderer(window, builtPage, vi.fn())).rejects.toThrow('ERR_FILE_NOT_FOUND');
  });

  // A reload or a newer navigation replaces the first load; the window still shows a page.
  it('logs and ignores a load that a newer navigation aborted', async () => {
    const window = fakeWindow();
    const log = vi.fn();
    const aborted = Object.assign(new Error('ERR_ABORTED (-3) loading app://orchtopus/'), {
      code: 'ERR_ABORTED',
      errno: -3,
    });
    window.loadURL.mockReturnValueOnce(Promise.reject(aborted));
    await expect(loadRenderer(window, builtPage, log)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toContain('ERR_ABORTED');
  });
});
