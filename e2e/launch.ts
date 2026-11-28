// Launches the built app for e2e tests with its own temp data folder and Claude home, so a test
// never touches the real %APPDATA%\Orchtopus or ~/.claude.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

export interface LaunchOptions {
  /** Data folder (ORCHTOPUS_DATA_DIR); a new temp folder when omitted. */
  dataDir?: string;
  /** Claude home (CLAUDE_CONFIG_DIR); a new temp folder when omitted. */
  claudeHome?: string;
  /** Extra variables, applied last (for example ELECTRON_RENDERER_URL for the dev server test). */
  env?: Record<string, string>;
  /** Run the unpacked app (`electron .`) even when E2E_EXECUTABLE names a packaged build. */
  unpacked?: boolean;
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  dataDir: string;
  claudeHome: string;
  /** Removes the temp folders launchApp made itself (not ones passed in). Call after closeApp. */
  cleanup: () => void;
}

const BLOCKED = new Set(['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL']);

const FAKE_CLAUDE = resolve(__dirname, '..', 'tooling', 'fake-claude', 'cli.mjs');
const CLOSE_TIMEOUT_MS = 15_000;

function baseEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !BLOCKED.has(entry[0]),
    ),
  );
}

/** A new folder under the OS temp folder; remove it with removeTempDir. */
export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Removes a temp folder, retrying while Windows still holds a file in it. */
export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
}

export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const dataDir = options.dataDir ?? makeTempDir('orchtopus-e2e-data-');
  const claudeHome = options.claudeHome ?? makeTempDir('orchtopus-e2e-claude-');
  const owned = [
    ...(options.dataDir === undefined ? [dataDir] : []),
    ...(options.claudeHome === undefined ? [claudeHome] : []),
  ];
  const env = {
    ...baseEnv(),
    ORCHTOPUS_DATA_DIR: dataDir,
    CLAUDE_CONFIG_DIR: claudeHome,
    // BACKGROUND_WINDOW_ENV in src/main/show-window.ts: show the window without taking focus.
    ORCHTOPUS_BACKGROUND_WINDOW: '1',
    // CLAUDE_COMMAND_ENV in src/main/claude/cli.ts: the restart sequence polls the fake CLI,
    // never the real one. A real Node command, because the clean env drops ELECTRON_RUN_AS_NODE.
    ORCHTOPUS_CLAUDE_COMMAND: JSON.stringify([process.execPath, FAKE_CLAUDE]),
    ...options.env,
  };
  const executablePath = options.unpacked ? undefined : process.env['E2E_EXECUTABLE'];
  // Playwright emulates prefers-color-scheme: light by default; null lets nativeTheme decide.
  const app = await electron.launch(
    executablePath
      ? { executablePath, env, colorScheme: null, timeout: 60_000 }
      : { args: ['.'], env, colorScheme: null, timeout: 60_000 },
  );
  const page = await app.firstWindow();
  const cleanup = (): void => {
    for (const dir of owned) removeTempDir(dir);
  };
  return { app, page, dataDir, claudeHome, cleanup };
}

/** Ends every fake background worker of this Claude home and removes the fake's state. */
export function cleanupFakeClaude(claudeHome: string): void {
  execFileSync(process.execPath, [FAKE_CLAUDE, '--fake-cleanup'], {
    env: { ...baseEnv(), CLAUDE_CONFIG_DIR: claudeHome },
    stdio: 'ignore',
  });
}

/**
 * Quits the app and waits for its process to exit. `app.close()` alone can wait forever once a
 * session was started: on Windows the detached background worker inherits the app's stdio
 * pipes, so Playwright never sees them close although Electron has exited. Kills the app and
 * throws when it has not exited after CLOSE_TIMEOUT_MS.
 */
export async function closeApp(app: ElectronApplication): Promise<void> {
  const child = app.process();
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => {
      resolve();
    });
  });
  app.close().catch(() => {
    // The process exit below is what counts.
  });
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      resolve('timeout');
    }, CLOSE_TIMEOUT_MS);
  });
  const result = await Promise.race([exited, timedOut]);
  clearTimeout(timer);
  if (result === 'timeout') {
    child.kill();
    throw new Error(
      `The app (pid ${String(child.pid)}) did not exit within ${String(CLOSE_TIMEOUT_MS / 1000)} s ` +
        'after close; it was killed.',
    );
  }
}
