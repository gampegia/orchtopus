import { join } from 'node:path';
import { app, BrowserWindow, nativeTheme, session } from 'electron';
import { denyAllPermissions, hardenWebContents } from './security';
import { showMainWindow } from './show-window';
import { createMainWindowOptions } from './window-options';

app.enableSandbox();

app.on('web-contents-created', (_event, contents) => {
  hardenWebContents(contents);
});

function createMainWindow(): void {
  const window = new BrowserWindow(
    createMainWindowOptions({
      preloadPath: join(__dirname, '../preload/index.js'),
      dark: nativeTheme.shouldUseDarkColors,
    }),
  );
  window.once('ready-to-show', () => {
    showMainWindow(window, process.env);
  });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
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
