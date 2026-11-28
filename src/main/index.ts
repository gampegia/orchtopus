import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, session } from 'electron';
import { APP_ORIGIN, APP_SCHEME } from '../shared/app-origin';
import { createCoreRoutes } from './api/routes/core';
import { createHookRoutes, setEnvelopeListener } from './api/routes/hooks';
import { DEFAULT_API_PORT, startApiServer, type ApiServer } from './api/server';
import { createAppContext } from './app-context';
import { APP_SCHEME_PRIVILEGES, createAppProtocolHandler } from './app-protocol';
import { resolveDataPaths } from './data-folder';
import { installHookFiles } from './hooks/install';
import { registerIpc } from './ipc';
import { loadRenderer, resolveRendererTarget } from './load-renderer';
import { denyAllPermissions, hardenWebContents } from './security';
import { createStateTracker } from './sessions/state-tracker';
import { showMainWindow } from './show-window';
import { tryStartupStep } from './startup-step';
import { importSpool } from './spool/import';
import { openStore, type Store } from './store/event-log';
import { createMainWindowOptions, pageBackgroundColor } from './window-options';

const warn = (message: string): void => {
  console.warn(message);
};

app.enableSandbox();
// Must run before the app is ready.
protocol.registerSchemesAsPrivileged([APP_SCHEME_PRIVILEGES]);

// All Orchtopus files live in the data folder, Electron's own profile included.
const paths = resolveDataPaths({ env: process.env, appData: app.getPath('appData') });
app.setPath('userData', paths.electronUserData);

const renderer = resolveRendererTarget({
  packaged: app.isPackaged,
  rendererUrl: process.env['ELECTRON_RENDERER_URL'],
  warn,
});
// Browser origins allowed to call the local API and the IPC handlers.
const allowedOrigins = renderer.devServer ? [APP_ORIGIN, renderer.origin] : [APP_ORIGIN];

app.on('web-contents-created', (_event, contents) => {
  hardenWebContents(
    contents,
    { startupUrl: renderer.url, allowReloadNavigation: renderer.devServer },
    warn,
  );
});

let store: Store | null = null;
let api: ApiServer | null = null;

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

async function startServices(): Promise<void> {
  const opened = openStore(paths.stateDb);
  store = opened;
  const ctx = createAppContext({ paths, store: opened });
  // Hook envelopes update the session state at once; the agents poller comes with Task 12.
  const tracker = createStateTracker({
    store: opened,
    publish: ctx.publish,
    now: Date.now,
    setStatus: ctx.setStatus,
    sessionView: ctx.sessionView,
  });
  setEnvelopeListener(tracker.onEnvelope);
  // Hooks of running sessions call the launcher in bin\; refresh it before anything else.
  // A failure keeps the old launcher and must not stop the app from starting.
  await tryStartupStep(
    'Hook file install',
    () =>
      installHookFiles(paths, {
        exePath: process.execPath,
        helperBundle: join(__dirname, 'hook-helper.js'),
      }),
    warn,
  );
  const server = await startApiServer({
    paths,
    preferredPort: DEFAULT_API_PORT,
    allowedOrigins,
    routes: {
      ...createCoreRoutes({ appVersion: app.getVersion(), snapshot: ctx.snapshot }),
      ...createHookRoutes({ store: opened, log: warn }),
    },
    snapshot: ctx.snapshot,
    log: warn,
  });
  api = server;
  ctx.attachPublisher(server.publish);
  // Envelopes spooled while the app was closed. Task 12 moves this into the restart sequence.
  // A spool that cannot be imported now (locked file, unwritable folder) waits for the next import.
  const spooled = await tryStartupStep('Spool import', () => importSpool(opened, paths), warn);
  if (spooled !== null && spooled.damaged > 0)
    warn(`Spool import kept ${String(spooled.damaged)} damaged lines`);
  registerIpc({
    ipcMain,
    pickFolder: async (event) => {
      const options = { properties: ['openDirectory' as const] };
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await (window === null
        ? dialog.showOpenDialog(options)
        : dialog.showOpenDialog(window, options));
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    allowedOrigins,
    connection: () => ({
      baseUrl: `http://127.0.0.1:${String(server.port)}`,
      token: server.token(),
    }),
    log: warn,
  });
}

app
  .whenReady()
  .then(async () => {
    denyAllPermissions(session.defaultSession);
    protocol.handle(
      APP_SCHEME,
      createAppProtocolHandler(join(__dirname, '../renderer'), (path) => readFile(path), warn),
    );
    // The API is up before the window loads, so the renderer can connect at once.
    await startServices();
    createMainWindow();
  })
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });

app.on('window-all-closed', () => {
  app.quit();
});

// Close the API (which deletes api.json) and the store before the process ends.
let shutDown = false;
app.on('before-quit', (event) => {
  if (shutDown) return;
  event.preventDefault();
  shutDown = true;
  const server = api;
  api = null;
  (server?.close() ?? Promise.resolve())
    .catch((error: unknown) => {
      console.error('Failed to close the local API:', error);
    })
    .finally(() => {
      store?.close();
      store = null;
      app.quit();
    });
});
