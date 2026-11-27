import { describe, expect, it } from 'vitest';
import lagoon from '../../themes/lagoon/tokens.json';
import { createMainWindowOptions } from './window-options';

describe('createMainWindowOptions', () => {
  const preloadPath = 'out/preload/index.js';

  it('hardens the renderer', () => {
    expect(createMainWindowOptions({ preloadPath, dark: false }).webPreferences).toEqual({
      preload: preloadPath,
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
    const options = createMainWindowOptions({ preloadPath, dark: false });
    expect(options.title).toBe('Orchtopus');
    expect(options.show).toBe(false);
  });

  it('paints surface.page of the active mode before the page loads', () => {
    expect(createMainWindowOptions({ preloadPath, dark: false }).backgroundColor).toBe(
      lagoon.light['surface.page'],
    );
    expect(createMainWindowOptions({ preloadPath, dark: true }).backgroundColor).toBe(
      lagoon.dark['surface.page'],
    );
  });

  it('takes its size from the size tokens', () => {
    const options = createMainWindowOptions({ preloadPath, dark: false });
    expect(options.width).toBe(Number.parseInt(lagoon.light['size.window-width'], 10));
    expect(options.height).toBe(Number.parseInt(lagoon.light['size.window-height'], 10));
  });
});
