// Launches the built app for e2e tests with its own temp data folder and Claude home, so a test
// never touches the real %APPDATA%\Orchtopus or ~/.claude.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
}

const BLOCKED = new Set(['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL']);

function baseEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !BLOCKED.has(entry[0]),
    ),
  );
}

export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'orchtopus-e2e-data-'));
  const claudeHome = options.claudeHome ?? mkdtempSync(join(tmpdir(), 'orchtopus-e2e-claude-'));
  const env = {
    ...baseEnv(),
    ORCHTOPUS_DATA_DIR: dataDir,
    CLAUDE_CONFIG_DIR: claudeHome,
    // BACKGROUND_WINDOW_ENV in src/main/show-window.ts: show the window without taking focus.
    ORCHTOPUS_BACKGROUND_WINDOW: '1',
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
  return { app, page, dataDir };
}
