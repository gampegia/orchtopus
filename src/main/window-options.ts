import type { BrowserWindowConstructorOptions } from 'electron';
import lagoonJson from '../../themes/lagoon/tokens.json';
import { PRODUCT_NAME } from '../shared/product';
import { parseTheme, tokenValue } from '../shared/tokens';

const theme = parseTheme(lagoonJson);

export interface MainWindowInput {
  readonly preloadPath: string;
  readonly dark: boolean;
}

/** Options for the main window: hidden until ready, sized and painted from theme tokens. */
export function createMainWindowOptions(input: MainWindowInput): BrowserWindowConstructorOptions {
  const mode = input.dark ? 'dark' : 'light';
  return {
    title: PRODUCT_NAME,
    width: Number.parseInt(tokenValue(theme, mode, 'size.window-width'), 10),
    height: Number.parseInt(tokenValue(theme, mode, 'size.window-height'), 10),
    show: false,
    backgroundColor: tokenValue(theme, mode, 'surface.page'),
    webPreferences: {
      preload: input.preloadPath,
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
