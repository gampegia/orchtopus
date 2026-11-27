import type { BrowserWindow } from 'electron';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True only for a plain `http:` URL on localhost, 127.0.0.1 or [::1] (the Vite dev server). */
export function isLocalDevServerUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'http:' &&
    url.username === '' &&
    url.password === '' &&
    LOCAL_HOSTNAMES.has(url.hostname)
  );
}

/** Electron rejects a load with ERR_ABORTED when a reload or newer navigation replaces it. */
function isAbortedLoad(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ERR_ABORTED'
  );
}

export interface RendererSource {
  readonly packaged: boolean;
  /** The value of ELECTRON_RENDERER_URL, set by `electron-vite dev`. */
  readonly rendererUrl: string | undefined;
  readonly indexPath: string;
  readonly warn: (message: string) => void;
}

/**
 * Loads the dev server when unpackaged and the URL is local, otherwise the bundled index.html.
 * A load failure rejects, so the caller can stop instead of showing a blank window. A load
 * that a newer navigation replaced (ERR_ABORTED) is not a failure.
 */
export async function loadRenderer(
  window: Pick<BrowserWindow, 'loadURL' | 'loadFile'>,
  source: RendererSource,
): Promise<void> {
  try {
    await startLoad(window, source);
  } catch (error) {
    if (!isAbortedLoad(error)) throw error;
  }
}

async function startLoad(
  window: Pick<BrowserWindow, 'loadURL' | 'loadFile'>,
  source: RendererSource,
): Promise<void> {
  const { packaged, rendererUrl, indexPath } = source;
  if (!packaged && rendererUrl) {
    if (isLocalDevServerUrl(rendererUrl)) {
      await window.loadURL(rendererUrl);
      return;
    }
    source.warn(
      'ELECTRON_RENDERER_URL is not a local http dev server URL; loading the bundled page instead',
    );
  }
  await window.loadFile(indexPath);
}
