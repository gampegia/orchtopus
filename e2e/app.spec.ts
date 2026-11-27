import { readFileSync } from 'node:fs';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import type { WebContents, WebPreferences } from 'electron';

/** `getLastWebPreferences` exists at runtime but is missing from Electron's public types. */
type InspectableWebContents = WebContents & { getLastWebPreferences(): WebPreferences | null };

type Mode = 'light' | 'dark';
const tokens = JSON.parse(readFileSync('themes/lagoon/tokens.json', 'utf8')) as Record<
  Mode,
  Record<string, string>
>;

function rgb(mode: Mode, token: string): string {
  const hex = tokens[mode][token];
  if (hex === undefined) throw new Error(`Unknown token ${token}`);
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  return `rgb(${channels.join(', ')})`;
}

function launchEnv(): Record<string, string> {
  const blocked = new Set(['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL']);
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !blocked.has(entry[0]),
    ),
  );
}

let app: ElectronApplication;
let page: Page;
const consoleErrors: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const executablePath = process.env['E2E_EXECUTABLE'];
  // Playwright emulates prefers-color-scheme: light by default; null lets nativeTheme decide.
  app = await electron.launch(
    executablePath
      ? { executablePath, env: launchEnv(), colorScheme: null, timeout: 60_000 }
      : { args: ['.'], env: launchEnv(), colorScheme: null, timeout: 60_000 },
  );
  page = await app.firstWindow();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await page.reload();
  await page.waitForLoadState('load');
});

test.afterAll(async () => {
  await app.close();
});

test('starts without console errors', () => {
  expect(consoleErrors).toEqual([]);
});

test('opens one window titled Orchtopus that shows the name', async () => {
  await expect(page).toHaveTitle('Orchtopus');
  await expect(page.getByRole('heading', { level: 1, name: 'Orchtopus' })).toBeVisible();
  const titles = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => window.getTitle()),
  );
  expect(titles).toEqual(['Orchtopus']);
});

for (const mode of ['light', 'dark'] as const) {
  test(`paints surface.page and text.primary in ${mode} mode`, async () => {
    await app.evaluate(({ nativeTheme }, source) => {
      nativeTheme.themeSource = source;
    }, mode);
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe(rgb(mode, 'surface.page'));
    await expect
      .poll(() =>
        page.evaluate(() => {
          const heading = document.querySelector('h1');
          return heading ? getComputedStyle(heading).color : null;
        }),
      )
      .toBe(rgb(mode, 'text.primary'));
  });
}

test('renderer has no Node.js access and the preload exposes nothing', async () => {
  const globals = await page.evaluate(() => {
    const scope = globalThis as unknown as Record<string, unknown>;
    return {
      require: typeof scope['require'],
      process: typeof scope['process'],
      module: typeof scope['module'],
      exposed: Object.keys(scope).filter((key) => /electron|ipc/i.test(key)),
    };
  });
  expect(globals).toEqual({
    require: 'undefined',
    process: 'undefined',
    module: 'undefined',
    exposed: [],
  });
});

test('web preferences are hardened at runtime', async () => {
  const preferences = await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents as
      InspectableWebContents | undefined;
    const last = contents?.getLastWebPreferences();
    return last
      ? {
          contextIsolation: last.contextIsolation,
          sandbox: last.sandbox,
          nodeIntegration: last.nodeIntegration,
          webviewTag: last.webviewTag,
        }
      : null;
  });
  expect(preferences).toEqual({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webviewTag: false,
  });
});

test('content security policy blocks inline scripts', async () => {
  const ran = await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'globalThis.cspProbe = true';
    document.head.append(script);
    return (globalThis as unknown as Record<string, unknown>)['cspProbe'] === true;
  });
  expect(ran).toBe(false);
});

test('new windows and navigation are denied', async () => {
  expect(await page.evaluate(() => window.open('https://example.com/') !== null)).toBe(false);
  const before = page.url();
  await page.evaluate(() => {
    window.location.href = 'https://example.com/';
  });
  await page.waitForTimeout(1_000);
  expect(page.url()).toBe(before);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});
