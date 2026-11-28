import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join } from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchApp } from './launch';

// Stands in for the Vite dev server: serves the built renderer over http on 127.0.0.1 and is
// passed to the app as ELECTRON_RENDERER_URL, so the main process takes its dev server path.
const rendererRoot = join(__dirname, '../out/renderer');
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

let server: Server | undefined;
let app: ElectronApplication | undefined;
let devUrl = '';
let cleanupLaunch: (() => void) | undefined;

function electronApp(): ElectronApplication {
  if (app === undefined) throw new Error('Electron did not launch');
  return app;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const started = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const name = path === '/' ? 'index.html' : path.slice(1);
    // Test fixture only: the built output has no nested user paths, refuse anything unusual.
    if (!/^[\w./-]+$/.test(name) || name.includes('..')) {
      response.writeHead(404).end();
      return;
    }
    readFile(join(rendererRoot, name)).then(
      (body) => {
        response
          .writeHead(200, { 'Content-Type': types[extname(name)] ?? 'application/octet-stream' })
          .end(body);
      },
      () => {
        response.writeHead(404).end();
      },
    );
  });
  await new Promise<void>((resolve) => started.listen(0, '127.0.0.1', resolve));
  server = started;
  devUrl = `http://127.0.0.1:${String((started.address() as AddressInfo).port)}/`;

  // The packaged app ignores ELECTRON_RENDERER_URL, so this suite always runs the unpacked one.
  const launched = await launchApp({ env: { ELECTRON_RENDERER_URL: devUrl }, unpacked: true });
  cleanupLaunch = launched.cleanup;
  app = launched.app;
  await launched.page.waitForLoadState('load');
});

test.afterAll(async () => {
  try {
    if (app !== undefined) await app.close();
  } finally {
    // Removes the data folder and Claude home launchApp made for this suite.
    cleanupLaunch?.();
  }
  const running = server;
  if (running !== undefined) {
    await new Promise<void>((resolve) => {
      running.close(() => {
        resolve();
      });
    });
  }
});

/** Runs `script` in the page and reports whether a main-frame navigation committed. */
function navigateBy(script: string) {
  return electronApp().evaluate(
    ({ BrowserWindow }, source) =>
      new Promise<{ before: string; after: string; committed: boolean }>((resolve, reject) => {
        const contents = BrowserWindow.getAllWindows()[0]?.webContents;
        if (!contents) throw new Error('No window');
        const before = contents.getURL();
        let committed = false;
        const onNavigate = (): void => {
          committed = true;
        };
        contents.once('did-navigate', onNavigate);
        contents.once('did-stop-loading', () => {
          // A denied navigation never fires did-navigate; drop the listener so it cannot leak
          // into the next test.
          contents.off('did-navigate', onNavigate);
          resolve({ before, after: contents.getURL(), committed });
        });
        contents.executeJavaScript(source).catch(reject);
      }),
    script,
  );
}

test('loads the dev server URL', async () => {
  const url = await electronApp().evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.getURL(),
  );
  expect(url).toBe(devUrl);
});

// Vite's full reload calls location.reload(), which Electron reports as will-navigate.
test('a page reload works with the dev server', async () => {
  const outcome = await navigateBy('location.reload()');
  expect(outcome.committed).toBe(true);
  expect(outcome.after).toBe(devUrl);
});

test('navigation to another page stays denied with the dev server', async () => {
  const outcome = await navigateBy(`location.href = ${JSON.stringify(`${devUrl}?navigated`)}`);
  expect(outcome.committed).toBe(false);
  expect(outcome.after).toBe(outcome.before);
});

// The reload exception follows the URL the window loaded first, not one set by pushState.
test('a reload after history.pushState stays denied with the dev server', async () => {
  const outcome = await navigateBy("history.pushState(null, '', '/pushed'); location.reload()");
  expect(outcome.committed).toBe(false);
  expect(outcome.after).toBe(`${devUrl}pushed`);
});
