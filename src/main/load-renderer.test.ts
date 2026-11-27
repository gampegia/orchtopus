import { describe, expect, it, vi } from 'vitest';
import { isLocalDevServerUrl, loadRenderer } from './load-renderer';

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

function fakeWindow() {
  return {
    loadURL: vi.fn(() => Promise.resolve()),
    loadFile: vi.fn(() => Promise.resolve()),
  };
}

const indexPath = 'out/renderer/index.html';

describe('loadRenderer', () => {
  it('loads a local dev server URL when unpackaged', async () => {
    const window = fakeWindow();
    const warn = vi.fn();
    await loadRenderer(window, {
      packaged: false,
      rendererUrl: 'http://localhost:5173/',
      indexPath,
      warn,
    });
    expect(window.loadURL).toHaveBeenCalledWith('http://localhost:5173/');
    expect(window.loadFile).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('loads the file and warns when the URL is not a local dev server', async () => {
    const window = fakeWindow();
    const warn = vi.fn();
    await loadRenderer(window, {
      packaged: false,
      rendererUrl: 'https://example.com/',
      indexPath,
      warn,
    });
    expect(window.loadURL).not.toHaveBeenCalled();
    expect(window.loadFile).toHaveBeenCalledWith(indexPath);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('ignores the URL when packaged', async () => {
    const window = fakeWindow();
    const warn = vi.fn();
    await loadRenderer(window, {
      packaged: true,
      rendererUrl: 'http://localhost:5173/',
      indexPath,
      warn,
    });
    expect(window.loadURL).not.toHaveBeenCalled();
    expect(window.loadFile).toHaveBeenCalledWith(indexPath);
    expect(warn).not.toHaveBeenCalled();
  });

  it('loads the file when no URL is set', async () => {
    const window = fakeWindow();
    await loadRenderer(window, {
      packaged: false,
      rendererUrl: undefined,
      indexPath,
      warn: vi.fn(),
    });
    expect(window.loadFile).toHaveBeenCalledWith(indexPath);
  });

  it('passes a load failure on to the caller', async () => {
    const window = fakeWindow();
    window.loadFile.mockReturnValueOnce(Promise.reject(new Error('ERR_FILE_NOT_FOUND')));
    await expect(
      loadRenderer(window, { packaged: true, rendererUrl: undefined, indexPath, warn: vi.fn() }),
    ).rejects.toThrow('ERR_FILE_NOT_FOUND');
  });

  // A reload or a newer navigation replaces the first load; the window still shows a page.
  it('ignores a load that a newer navigation aborted', async () => {
    const window = fakeWindow();
    const aborted = Object.assign(new Error('ERR_ABORTED (-3) loading file'), {
      code: 'ERR_ABORTED',
      errno: -3,
    });
    window.loadFile.mockReturnValueOnce(Promise.reject(aborted));
    await expect(
      loadRenderer(window, { packaged: true, rendererUrl: undefined, indexPath, warn: vi.fn() }),
    ).resolves.toBeUndefined();
  });
});
