import type { BrowserWindowConstructorOptions } from 'electron';
import lagoonJson from '../../themes/lagoon/tokens.json';
import { PRODUCT_NAME } from '../shared/product';
import { parseTheme, tokenValue } from '../shared/tokens';

const theme = parseTheme(lagoonJson);

export interface MainWindowInput {
  readonly preloadPath: string;
  readonly dark: boolean;
  /** False in the packaged app, so the default menu cannot open DevTools. */
  readonly devTools: boolean;
}

const PIXEL_SIZE = /^(\d+)(?:px)?$/;

/** Reads a whole, positive pixel size such as `1440px` from a size token. */
export function parseWindowSize(value: string, token: string): number {
  const digits = PIXEL_SIZE.exec(value)?.[1];
  const size = digits === undefined ? Number.NaN : Number(digits);
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`Token "${token}" must be a positive pixel size, got "${value}"`);
  }
  return size;
}

/** The native window background for a mode: surface.page, so no flash of another colour. */
export function pageBackgroundColor(dark: boolean): string {
  return tokenValue(theme, dark ? 'dark' : 'light', 'surface.page');
}

/** Options for the main window: hidden until ready, sized and painted from theme tokens. */
export function createMainWindowOptions(input: MainWindowInput): BrowserWindowConstructorOptions {
  const mode = input.dark ? 'dark' : 'light';
  return {
    title: PRODUCT_NAME,
    width: parseWindowSize(tokenValue(theme, mode, 'size.window-width'), 'size.window-width'),
    height: parseWindowSize(tokenValue(theme, mode, 'size.window-height'), 'size.window-height'),
    show: false,
    backgroundColor: pageBackgroundColor(input.dark),
    webPreferences: {
      preload: input.preloadPath,
      devTools: input.devTools,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
      spellcheck: false,
    },
  };
}
