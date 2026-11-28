// The app shell against the fake CLI: title bar, session list, status bar and empty states.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { PreloadApi } from '../src/shared/preload-api';
import { createTempRepo, type TempRepo } from '../src/main/test-helpers/temp-repo';
import { cleanupFakeClaude, closeApp, launchApp, makeTempDir, removeTempDir } from './launch';

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
let repo: TempRepo | undefined;
const claudeHome = makeTempDir('orchtopus-e2e-claude-');
let cleanupLaunch: (() => void) | undefined;
const consoleErrors: string[] = [];

function electronApp(): ElectronApplication {
  if (app === undefined) throw new Error('Electron did not launch');
  return app;
}

/** Calls the local API from the renderer with the connection the preload gives it. */
async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const bridge = (window as unknown as { orchtopus: PreloadApi }).orchtopus;
      const { baseUrl, token } = await bridge.connection();
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path}: ${String(res.status)} ${text}`);
      return (text === '' ? undefined : JSON.parse(text)) as T;
    },
    { method, path, body },
  );
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const launched = await launchApp({ claudeHome });
  cleanupLaunch = launched.cleanup;
  app = launched.app;
  page = launched.page;
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await launched.app.context().addInitScript(() => {
    const scope = globalThis as unknown as { cspViolations: string[] };
    scope.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      scope.cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await page.reload();
  await page.waitForLoadState('load');
});

test.afterAll(async () => {
  try {
    if (app !== undefined) await closeApp(app);
  } finally {
    // Ends the fake background workers this test started, then removes the temp folders.
    cleanupFakeClaude(claudeHome);
    await repo?.cleanup();
    removeTempDir(claudeHome);
    cleanupLaunch?.();
  }
});

test('shows the no-project empty state with one action', async () => {
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'No project yet' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(main.getByRole('button')).toHaveCount(1);
  await expect(main.getByRole('button', { name: 'Add a project' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sessions' })).not.toContainText(
    'Loading sessions',
  );
});

test('status bar says API connected', async () => {
  await expect(page.getByRole('contentinfo')).toContainText('API connected');
});

async function setThemeSource(source: 'light' | 'dark' | 'system'): Promise<void> {
  await electronApp().evaluate(({ nativeTheme }, value) => {
    nativeTheme.themeSource = value;
  }, source);
}

for (const mode of ['light', 'dark'] as const) {
  test(`both colour modes paint panel and text tokens (${mode})`, async () => {
    await setThemeSource(mode);
    try {
      const list = page.getByRole('navigation', { name: 'Sessions' });
      await expect
        .poll(() => list.evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe(rgb(mode, 'surface.panel'));
      await expect
        .poll(() => list.evaluate((element) => getComputedStyle(element).color))
        .toBe(rgb(mode, 'text.primary'));
      const status = page.getByRole('contentinfo');
      await expect
        .poll(() => status.evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe(rgb(mode, 'surface.panel'));
    } finally {
      // Later tests run with the system colour mode again.
      await setThemeSource('system');
    }
  });
}

test('a project without sessions offers one action to start a session', async () => {
  repo = await createTempRepo();
  // The fake CLI reads workspace trust from the Claude home, like the real one.
  writeFileSync(
    join(claudeHome, '.claude.json'),
    JSON.stringify({
      projects: { [repo.root.replace(/\\/g, '/')]: { hasTrustDialogAccepted: true } },
    }),
  );
  await api('POST', '/v1/projects', {
    path: repo.root,
    checkCommands: { test: null, lint: null, typecheck: null },
    copyList: [],
    branchPrefix: 'orch/',
    requestId: 'shell-add-project',
  });
  const list = page.getByRole('navigation', { name: 'Sessions' });
  await expect(list).toContainText('acme-app');
  const main = page.getByRole('main');
  await expect(main.getByRole('button')).toHaveCount(1);
  await expect(main.getByRole('button', { name: 'Start a session' })).toBeVisible();
});

test('a started session shows as a row with a lamp and its state word', async () => {
  await api('POST', '/v1/sessions', {
    projectId: 'acme-app',
    task: 'upload-fix',
    branch: 'orch/upload-fix',
    base: 'local',
    prompt: null,
    model: null,
    effort: null,
    mode: 'auto',
    requestId: 'shell-start-upload-fix',
  });
  const row = page.getByRole('navigation', { name: 'Sessions' }).getByRole('option', {
    name: /upload-fix/,
  });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/running|idle|needs you/);
  await expect(page.getByRole('contentinfo')).toContainText(/1 (running|idle|needs you)/);
});

test('every lamp has a text label next to it', async () => {
  const lamps = page.locator('[data-lamp]');
  expect(await lamps.count()).toBeGreaterThan(0);
  const unlabelled = await lamps.evaluateAll(
    (elements) =>
      elements.filter((lamp) => {
        const sibling = lamp.nextElementSibling;
        return sibling === null || sibling.textContent.trim() === '';
      }).length,
  );
  expect(unlabelled).toBe(0);
});

test('no console errors and no CSP violations', async () => {
  const violations = await page.evaluate(
    () => (globalThis as unknown as { cspViolations?: string[] }).cspViolations ?? null,
  );
  expect(violations).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
