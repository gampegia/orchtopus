import { describe, expect, it } from 'vitest';
import lagoon from '../../themes/lagoon/tokens.json';
import {
  createMainWindowOptions,
  pageBackgroundColor,
  parseWindowSize,
  titleBarOverlay,
} from './window-options';

const preloadPath = 'out/preload/index.js';
const base = { preloadPath, devTools: true };

describe('createMainWindowOptions', () => {
  it('hardens the renderer', () => {
    expect(createMainWindowOptions({ ...base, dark: false }).webPreferences).toEqual({
      preload: preloadPath,
      devTools: true,
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
    });
  });

  it('starts hidden with the product title', () => {
    const options = createMainWindowOptions({ ...base, dark: false });
    expect(options.title).toBe('Orchtopus');
    expect(options.show).toBe(false);
  });

  it('paints surface.page of the active mode before the page loads', () => {
    expect(createMainWindowOptions({ ...base, dark: false }).backgroundColor).toBe(
      lagoon.light['surface.page'],
    );
    expect(createMainWindowOptions({ ...base, dark: true }).backgroundColor).toBe(
      lagoon.dark['surface.page'],
    );
  });

  it('turns DevTools off when asked', () => {
    expect(
      createMainWindowOptions({ ...base, devTools: false, dark: false }).webPreferences?.devTools,
    ).toBe(false);
  });

  it('takes its size from the size tokens', () => {
    const options = createMainWindowOptions({ ...base, dark: false });
    expect(options.width).toBe(Number.parseInt(lagoon.light['size.window-width'], 10));
    expect(options.height).toBe(Number.parseInt(lagoon.light['size.window-height'], 10));
  });
});

describe('title bar', () => {
  it('hides the native title bar and paints the overlay from tokens per mode', () => {
    for (const dark of [false, true]) {
      const mode = dark ? lagoon.dark : lagoon.light;
      const options = createMainWindowOptions({ ...base, dark });
      expect(options.titleBarStyle).toBe('hidden');
      expect(options.titleBarOverlay).toEqual({
        color: mode['surface.page'],
        symbolColor: mode['text.primary'],
        height: Number.parseInt(mode['size.titlebar'], 10),
      });
      expect(titleBarOverlay(dark)).toEqual(options.titleBarOverlay);
    }
  });

  it('keeps the window at least 1100 x 700', () => {
    const options = createMainWindowOptions({ ...base, dark: false });
    expect(options.minWidth).toBe(1100);
    expect(options.minHeight).toBe(700);
  });
});

describe('pageBackgroundColor', () => {
  it('returns surface.page of the mode', () => {
    expect(pageBackgroundColor(false)).toBe(lagoon.light['surface.page']);
    expect(pageBackgroundColor(true)).toBe(lagoon.dark['surface.page']);
  });
});

describe('parseWindowSize', () => {
  it('reads a positive pixel size', () => {
    expect(parseWindowSize('1280px', 'size.window-width')).toBe(1280);
    expect(parseWindowSize('800', 'size.window-height')).toBe(800);
  });

  it.each(['', 'auto', '0px', '-5px', 'NaNpx', 'Infinity'])('refuses %j', (value) => {
    expect(() => parseWindowSize(value, 'size.window-width')).toThrow('size.window-width');
  });
});
