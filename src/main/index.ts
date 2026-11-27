import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, nativeTheme, protocol, session } from 'electron';
import { APP_SCHEME } from '../shared/app-origin';
import { APP_SCHEME_PRIVILEGES, createAppProtocolHandler } from './app-protocol';
import { loadRenderer, resolveRendererTarget } from './load-renderer';
import { denyAllPermissions, hardenWebContents } from './security';
import { showMainWindow } from './show-window';
import { createMainWindowOptions, pageBackgroundColor } from './window-options';

const warn = (message: string): void => {
  console.warn(message);
};

app.enableSandbox();
// Must run before the app is ready.
protocol.registerSchemesAsPrivileged([APP_SCHEME_PRIVILEGES]);

const renderer = resolveRendererTarget({
  packaged: app.isPackaged,
  rendererUrl: process.env['ELECTRON_RENDERER_URL'],
  warn,
});

app.on('web-contents-created', (_event, contents) => {
  hardenWebContents(
    contents,
    { startupOrigin: renderer.origin, allowReloadNavigation: renderer.devServer },
    warn,
  );
});

function createMainWindow(): void {
  const window = new BrowserWindow(
    createMainWindowOptions({
      preloadPath: join(__dirname, '../preload/index.js'),
      dark: nativeTheme.shouldUseDarkColors,
      devTools: !app.isPackaged,
    }),
  );
  window.once('ready-to-show', () => {
    showMainWindow(window, process.env);
  });

  // Keep the native background (seen while resizing or reloading) in step with the OS mode.
  const updateBackground = (): void => {
    window.setBackgroundColor(pageBackgroundColor(nativeTheme.shouldUseDarkColors));
  };
  nativeTheme.on('updated', updateBackground);
  window.on('closed', () => {
    nativeTheme.off('updated', updateBackground);
  });

  loadRenderer(window, renderer.url, warn).catch((error: unknown) => {
    console.error('Failed to load the renderer:', error);
    app.exit(1);
  });
}

app
  .whenReady()
  .then(() => {
    denyAllPermissions(session.defaultSession);
    protocol.handle(
      APP_SCHEME,
      createAppProtocolHandler(join(__dirname, '../renderer'), (path) => readFile(path)),
    );
    createMainWindow();
  })
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });

app.on('window-all-closed', () => {
  app.quit();
});
