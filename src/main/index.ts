import { join } from 'node:path';
import { app, BrowserWindow, nativeTheme, session } from 'electron';
import { loadRenderer } from './load-renderer';
import { denyAllPermissions, hardenWebContents } from './security';
import { showMainWindow } from './show-window';
import { createMainWindowOptions, pageBackgroundColor } from './window-options';

app.enableSandbox();

app.on('web-contents-created', (_event, contents) => {
  hardenWebContents(contents);
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

  loadRenderer(window, {
    packaged: app.isPackaged,
    rendererUrl: process.env['ELECTRON_RENDERER_URL'],
    indexPath: join(__dirname, '../renderer/index.html'),
    warn: (message) => {
      console.warn(message);
    },
  }).catch((error: unknown) => {
    console.error('Failed to load the renderer:', error);
    app.exit(1);
  });
}

app
  .whenReady()
  .then(() => {
    denyAllPermissions(session.defaultSession);
    createMainWindow();
  })
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });

app.on('window-all-closed', () => {
  app.quit();
});
