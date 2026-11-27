import type { BrowserWindow } from 'electron';
import { APP_ORIGIN } from '../shared/app-origin';
import { originOf } from './navigation';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The built renderer's entry page, served by the app protocol. */
export const BUILT_RENDERER_URL = `${APP_ORIGIN}/index.html`;

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
  readonly warn: (message: string) => void;
}

export interface RendererTarget {
  /** The exact URL to load: the parsed form of the checked value. */
  readonly url: string;
  /** `scheme://host[:port]` of `url`. */
  readonly origin: string;
  /** True when `url` is the Vite dev server. */
  readonly devServer: boolean;
}

/** The dev server when unpackaged and the URL is local, otherwise the built page. */
export function resolveRendererTarget(source: RendererSource): RendererTarget {
  const { packaged, rendererUrl } = source;
  if (!packaged && rendererUrl) {
    const url = isLocalDevServerUrl(rendererUrl) ? new URL(rendererUrl).href : null;
    const origin = url === null ? null : originOf(url);
    if (url !== null && origin !== null) return { url, origin, devServer: true };
    source.warn(
      'ELECTRON_RENDERER_URL is not a local http dev server URL; loading the bundled page instead',
    );
  }
  return { url: BUILT_RENDERER_URL, origin: APP_ORIGIN, devServer: false };
}

/**
 * Loads the renderer. A load failure rejects, so the caller can stop instead of showing a blank
 * window. A load that a newer navigation replaced (ERR_ABORTED) is logged, not a failure.
 */
export async function loadRenderer(
  window: Pick<BrowserWindow, 'loadURL'>,
  url: string,
  log: (message: string) => void,
): Promise<void> {
  try {
    await window.loadURL(url);
  } catch (error) {
    if (!isAbortedLoad(error)) throw error;
    log(`Renderer load of ${url} was replaced by a newer navigation (ERR_ABORTED)`);
  }
}
