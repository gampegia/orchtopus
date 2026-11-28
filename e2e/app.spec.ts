import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { WebContents, WebPreferences } from 'electron';
import type { PreloadApi } from '../src/shared/preload-api';
import { launchApp } from './launch';

/** `getLastWebPreferences` exists at runtime but is missing from Electron's public types. */
type InspectableWebContents = WebContents & { getLastWebPreferences(): WebPreferences | null };

type Mode = 'light' | 'dark';
const tokens = JSON.parse(
  readFileSync(join(__dirname, '../themes/lagoon/tokens.json'), 'utf8'),
) as Record<Mode, Record<string, string>>;

function rgb(mode: Mode, token: string): string {
  const hex = tokens[mode][token];
  if (hex === undefined) throw new Error(`Unknown token ${token}`);
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  return `rgb(${channels.join(', ')})`;
}

let app: ElectronApplication | undefined;
let page: Page;
let dataDir = '';

function electronApp(): ElectronApplication {
  if (app === undefined) throw new Error('Electron did not launch');
  return app;
}
const consoleErrors: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const launched = await launchApp();
  app = launched.app;
  page = launched.page;
  dataDir = launched.dataDir;
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await page.reload();
  await page.waitForLoadState('load');
});

test.afterAll(async () => {
  // A failed launch leaves app undefined; closing it would hide the launch error.
  if (app !== undefined) await app.close();
});

test('starts without console errors', () => {
  expect(consoleErrors).toEqual([]);
});

test('opens one window titled Orchtopus that shows the name', async () => {
  await expect(page).toHaveTitle('Orchtopus');
  await expect(page.getByRole('heading', { level: 1, name: 'Orchtopus' })).toBeVisible();
  const titles = await electronApp().evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => window.getTitle()),
  );
  expect(titles).toEqual(['Orchtopus']);
  // The window is created with show: false; only ready-to-show makes it visible.
  await expect
    .poll(() =>
      electronApp().evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((window) => window.isVisible()),
      ),
    )
    .toEqual([true]);
});

test('serves the built renderer from app://orchtopus', async () => {
  expect(page.url()).toBe('app://orchtopus/index.html');
  expect(await page.evaluate(() => window.location.origin)).toBe('app://orchtopus');
  const response = await page.evaluate(async () => {
    const result = await fetch('/index.html');
    return { status: result.status, type: result.headers.get('content-type') };
  });
  expect(response).toEqual({ status: 200, type: 'text/html; charset=utf-8' });
});

test('the app protocol serves nothing outside the renderer folder', async () => {
  // out/main/index.js exists next to out/renderer; encoded separators must not reach it.
  const statuses = await page.evaluate(async () => {
    const paths = [
      '/..%2Fmain%2Findex.js',
      '/%2e%2e%2fmain%2findex.js',
      '/..%5Cmain%5Cindex.js',
      '/missing.js',
    ];
    return Promise.all(paths.map(async (path) => (await fetch(path)).status));
  });
  expect(statuses).toEqual([404, 404, 404, 404]);
});

for (const mode of ['light', 'dark'] as const) {
  test(`paints surface.page and text.primary in ${mode} mode`, async () => {
    await electronApp().evaluate(({ nativeTheme }, source) => {
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
    await expect
      .poll(() =>
        electronApp().evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.getBackgroundColor().toLowerCase(),
        ),
      )
      .toBe(tokens[mode]['surface.page']?.toLowerCase());
  });
}

// Guards nodeIntegration and preload leaks only: app.enableSandbox() keeps Node out of the
// renderer even with sandbox or contextIsolation off, so the next test checks those flags.
test('renderer has no Node.js access and the preload exposes only window.orchtopus', async () => {
  const globals = await page.evaluate(() => {
    const scope = globalThis as unknown as Record<string, unknown>;
    const bridge = scope['orchtopus'];
    return {
      require: typeof scope['require'],
      process: typeof scope['process'],
      module: typeof scope['module'],
      exposed: Object.keys(scope).filter((key) => /electron|ipc|orchtopus/i.test(key)),
      bridge: typeof bridge === 'object' && bridge !== null ? Object.keys(bridge).sort() : null,
    };
  });
  expect(globals).toEqual({
    require: 'undefined',
    process: 'undefined',
    module: 'undefined',
    exposed: ['orchtopus'],
    bridge: ['connection', 'pickFolder'],
  });
});

test('the renderer reaches the local API and the event stream with the token', async () => {
  const result = await page.evaluate(async () => {
    const bridge = (window as unknown as { orchtopus: PreloadApi }).orchtopus;
    const { baseUrl, token } = await bridge.connection();
    const health = await fetch(`${baseUrl}/v1/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const withoutToken = await fetch(`${baseUrl}/v1/health`);
    const first = await new Promise<unknown>((resolve, reject) => {
      const socket = new WebSocket(`${baseUrl.replace('http:', 'ws:')}/v1/events`, [
        'orchtopus.v1',
        `orchtopus.token.${token}`,
      ]);
      socket.onmessage = (event: MessageEvent<string>) => {
        socket.close();
        resolve(JSON.parse(event.data));
      };
      socket.onerror = () => {
        reject(new Error('event stream failed'));
      };
    });
    return {
      baseUrl,
      health: (await health.json()) as unknown,
      withoutToken: withoutToken.status,
      first,
    };
  });
  expect(result.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(result.health).toMatchObject({ apiVersion: 1 });
  expect(result.withoutToken).toBe(401);
  // The first snapshot may come before or after the restart sequence has finished.
  expect(result.first).toMatchObject({
    v: 1,
    kind: 'snapshot',
    snapshot: { ready: expect.any(Boolean) as unknown },
  });
});

test('the restart sequence ends with a ready snapshot and the fake CLI found', async () => {
  const state = (): Promise<{ ready: boolean; status: { cli: { found: boolean } } }> =>
    page.evaluate(async () => {
      const bridge = (window as unknown as { orchtopus: PreloadApi }).orchtopus;
      const { baseUrl, token } = await bridge.connection();
      const res = await fetch(`${baseUrl}/v1/state`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return (await res.json()) as { ready: boolean; status: { cli: { found: boolean } } };
    });
  await expect.poll(async () => (await state()).ready, { timeout: 15_000 }).toBe(true);
  expect((await state()).status.cli).toMatchObject({ found: true, supported: true });
});

test('keeps its files in the data folder and writes api.json', () => {
  const written = JSON.parse(readFileSync(join(dataDir, 'api.json'), 'utf8')) as {
    port: number;
  };
  expect(written.port).toBeGreaterThan(0);
  expect(existsSync(join(dataDir, 'state.db'))).toBe(true);
  expect(readFileSync(join(dataDir, 'api-token'), 'utf8')).toMatch(/^[0-9a-f]{64}$/);
  expect(existsSync(join(dataDir, 'electron'))).toBe(true);
});

test('web preferences are hardened at runtime', async () => {
  const preferences = await electronApp().evaluate(({ BrowserWindow }) => {
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

test('new windows are denied', async () => {
  expect(await page.evaluate(() => window.open('https://example.com/') !== null)).toBe(false);
  expect(
    await electronApp().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
  ).toBe(1);
});

test('permission requests are denied', async () => {
  expect(await page.evaluate(() => Notification.requestPermission())).toBe('denied');
});

test('navigation is denied', async () => {
  // A local target keeps the network out of it. `did-stop-loading` ends both outcomes: a
  // prevented navigation stops without `did-navigate`, an allowed one commits first.
  const outcome = await electronApp().evaluate(
    ({ BrowserWindow }) =>
      new Promise<{ before: string; after: string; committed: boolean }>((resolve, reject) => {
        const contents = BrowserWindow.getAllWindows()[0]?.webContents;
        if (!contents) throw new Error('No window');
        const before = contents.getURL();
        const target = new URL('?navigated', before).href;
        let committed = false;
        contents.on('did-navigate', () => {
          committed = true;
        });
        contents.once('did-stop-loading', () => {
          resolve({ before, after: contents.getURL(), committed });
        });
        contents
          .executeJavaScript(`window.location.href = ${JSON.stringify(target)};`)
          .catch(reject);
      }),
  );
  expect(outcome.committed).toBe(false);
  expect(outcome.after).toBe(outcome.before);
  expect(page.url()).toBe(outcome.before);
});
