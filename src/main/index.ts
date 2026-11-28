import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  protocol,
  session,
  shell,
} from 'electron';
import { APP_ORIGIN, APP_SCHEME } from '../shared/app-origin';
import { DEFAULT_API_PORT, type ApiServer } from './api/server';
import { buildingBlocksDir } from './base-setup/building-blocks';
import { claudeConfigPaths } from './claude/claude-home';
import { resolveClaudeCommand, whereClaude, type ClaudeCommand } from './claude/cli';
import { APP_SCHEME_PRIVILEGES, createAppProtocolHandler } from './app-protocol';
import { resolveDataPaths } from './data-folder';
import { registerIpc } from './ipc';
import { loadRenderer, resolveRendererTarget } from './load-renderer';
import { denyAllPermissions, hardenWebContents } from './security';
import { showMainWindow } from './show-window';
import { runStartup, type RunningApp } from './startup';
import { createMainWindowOptions, pageBackgroundColor, titleBarOverlay } from './window-options';

const warn = (message: string): void => {
  console.warn(message);
};

app.enableSandbox();
// Must run before the app is ready.
protocol.registerSchemesAsPrivileged([APP_SCHEME_PRIVILEGES]);

// All Orchtopus files live in the data folder, Electron's own profile included.
const paths = resolveDataPaths({ env: process.env, appData: app.getPath('appData') });
app.setPath('userData', paths.electronUserData);

// One instance per data folder (the lock lives in userData, so it is taken after setPath). A
// second instance would open the same state.db, attach the same PTYs and overwrite api.json.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.exit(0);

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

let running: RunningApp | null = null;
let mainWindow: BrowserWindow | null = null;

// A second start brings the running window to the front instead.
app.on('second-instance', () => {
  const window = mainWindow;
  if (window === null || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});

function createMainWindow(): void {
  const window = new BrowserWindow(
    createMainWindowOptions({
      preloadPath: join(__dirname, '../preload/index.js'),
      dark: nativeTheme.shouldUseDarkColors,
      devTools: !app.isPackaged,
    }),
  );
  mainWindow = window;
  window.once('ready-to-show', () => {
    showMainWindow(window, process.env);
  });

  // Keep the native background (seen while resizing or reloading) and the window controls in
  // step with the OS mode.
  const updateBackground = (): void => {
    const dark = nativeTheme.shouldUseDarkColors;
    window.setBackgroundColor(pageBackgroundColor(dark));
    window.setTitleBarOverlay(titleBarOverlay(dark));
  };
  nativeTheme.on('updated', updateBackground);
  window.on('closed', () => {
    nativeTheme.off('updated', updateBackground);
    if (mainWindow === window) mainWindow = null;
  });

  loadRenderer(window, renderer.url, warn).catch((error: unknown) => {
    console.error('Failed to load the renderer:', error);
    app.exit(1);
  });
}

function registerConnectionIpc(server: ApiServer): void {
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

/** The claude command, or null when none is found (session starts are then blocked). */
async function findClaude(): Promise<ClaudeCommand | null> {
  try {
    return await resolveClaudeCommand({
      env: process.env,
      packaged: app.isPackaged,
      where: whereClaude,
    });
  } catch (error: unknown) {
    warn(`Claude Code command: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function startServices(): Promise<void> {
  running = await runStartup({
    paths,
    hookSource: { exePath: process.execPath, helperBundle: join(__dirname, 'hook-helper.js') },
    claude: await findClaude(),
    buildingBlocksDir: buildingBlocksDir(app.isPackaged, process.resourcesPath, app.getAppPath()),
    claudePaths: claudeConfigPaths(process.env, homedir()),
    env: process.env,
    appVersion: app.getVersion(),
    allowedOrigins,
    preferredPort: DEFAULT_API_PORT,
    shell: {
      openPath: (path) => shell.openPath(path),
      openExternal: (url) => shell.openExternal(url),
    },
    log: warn,
    // The API is up before the window loads, so the renderer can connect at once; it shows no
    // sessions until the snapshot says ready.
    onApiReady: (server) => {
      registerConnectionIpc(server);
      createMainWindow();
    },
  });
}

// app.exit does not stop this module from running, so a second instance never starts services.
if (primaryInstance) {
  app
    .whenReady()
    .then(async () => {
      denyAllPermissions(session.defaultSession);
      protocol.handle(
        APP_SCHEME,
        createAppProtocolHandler(join(__dirname, '../renderer'), (path) => readFile(path), warn),
      );
      await startServices();
    })
    .catch((error: unknown) => {
      console.error(error);
      app.exit(1);
    });
}

app.on('window-all-closed', () => {
  app.quit();
});

// Stop polling, end the app's attach PTYs (the sessions keep running under Claude Code's
// supervisor), close the API (which deletes api.json) and the store before the process ends.
let shutDown = false;
app.on('before-quit', (event) => {
  if (shutDown) return;
  event.preventDefault();
  shutDown = true;
  const current = running;
  running = null;
  (current?.close() ?? Promise.resolve())
    .catch((error: unknown) => {
      console.error('Failed to shut down cleanly:', error);
    })
    .finally(() => {
      app.quit();
    });
});
