// The add-project dialog (refusals, setup checklist, trust step) and the new-session dialog
// (derived branch, fetch failure, field errors, remembered start values) against the fake CLI.
import { mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { SETUP_ITEM_IDS } from '../src/main/projects/setup-check';
import { createTempRepo, type TempRepo } from '../src/main/test-helpers/temp-repo';
import { cleanupFakeClaude, closeApp, launchApp, makeTempDir, removeTempDir } from './launch';

let app: ElectronApplication | undefined;
let page: Page;
let repo: TempRepo;
// No .claude.json in this Claude home: the demo repo starts untrusted.
const claudeHome = makeTempDir('orchtopus-e2e-claude-');
let cleanupLaunch: (() => void) | undefined;

/** Makes the folder picker return this path, as if the user picked it. */
async function pickFolderReturns(path: string): Promise<void> {
  if (app === undefined) throw new Error('app not started');
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
  }, path);
}

function addDialog() {
  return page.getByRole('dialog', { name: 'Add a project' });
}

function sessionDialog() {
  return page.getByRole('dialog', { name: /^New session in/ });
}

function row(task: string) {
  return page.getByRole('navigation', { name: 'Sessions' }).getByRole('option', {
    name: new RegExp(task),
  });
}

/** The text in the trust step's xterm buffer. */
async function trustTerminalText(): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector<
      Element & {
        orchtopusTerminal?: {
          buffer: {
            active: {
              length: number;
              getLine(i: number): { translateToString(trim: boolean): string } | undefined;
            };
          };
        };
      }
    >('[data-trust-terminal]');
    const buffer = host?.orchtopusTerminal?.buffer.active;
    if (buffer === undefined) return '';
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i += 1) {
      lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
    }
    return lines.join('\n');
  });
}

async function openNewSession(): Promise<void> {
  await page.getByRole('button', { name: 'New session in acme-app' }).click();
  await expect(sessionDialog()).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  repo = await createTempRepo({ withRemote: true });
  mkdirSync(join(repo.root, 'src'));
  const launched = await launchApp({ claudeHome });
  cleanupLaunch = launched.cleanup;
  app = launched.app;
  page = launched.page;
  await expect(page.getByRole('contentinfo')).toContainText('API connected', { timeout: 15_000 });
});

test.afterAll(async () => {
  try {
    if (app !== undefined) await closeApp(app);
  } finally {
    // Ends the fake background workers this test started, then removes the temp folders.
    cleanupFakeClaude(claudeHome);
    await repo.cleanup();
    removeTempDir(claudeHome);
    cleanupLaunch?.();
  }
});

test('refuses a subfolder with a clear message', async () => {
  await pickFolderReturns(join(repo.root, 'src'));
  await page.getByRole('button', { name: 'Add a project' }).click();
  await expect(addDialog()).toBeVisible();
  await addDialog().getByRole('button', { name: 'Browse' }).click();
  await expect(addDialog().getByRole('alert')).toContainText(
    'Pick the top folder of the repository',
  );
  await expect(addDialog().getByRole('button', { name: 'Add project' })).toBeDisabled();
});

test('shows every setup item with a word', async () => {
  const folder = addDialog().getByLabel('Folder');
  await folder.fill(repo.root);
  await addDialog().getByRole('button', { name: 'Check' }).click();
  const items = addDialog().getByRole('list', { name: 'Setup check' }).getByRole('listitem');
  await expect(items).toHaveCount(SETUP_ITEM_IDS.length);
  for (const item of await items.all()) {
    await expect(item.locator('[data-status-word]')).toHaveText(/^(ok|hint|problem|info)$/);
  }
  await expect(addDialog().getByText('main', { exact: true })).toBeVisible();
  await expect(addDialog().getByLabel('Branch prefix')).toHaveValue('orch/');
  await expect(addDialog().getByRole('button', { name: 'Add project' })).toBeEnabled();
});

test('trust step trusts an untrusted demo repo through the terminal and closes it', async () => {
  const step = addDialog().getByRole('region', { name: 'Workspace trust' });
  await step.getByRole('button', { name: 'Trust in Claude Code' }).click();
  await expect(step.getByRole('button', { name: 'Close terminal' })).toBeVisible();
  await expect.poll(trustTerminalText, { timeout: 15_000 }).toContain('Do you trust');
  await page.locator('[data-trust-terminal]').click();
  await page.keyboard.type('1');
  await page.keyboard.press('Enter');
  // The dialog checks trust every 2 s and closes the terminal once Claude Code trusts the folder.
  await expect(page.locator('[data-trust-terminal]')).toHaveCount(0, { timeout: 10_000 });
  await expect(step).toContainText('Claude Code trusts this folder');
});

test('adds acme-app and shows the project empty state', async () => {
  await addDialog().getByRole('button', { name: 'Add project' }).click();
  await expect(addDialog()).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Sessions' })).toContainText('acme-app');
  await expect(
    page.getByRole('main').getByRole('button', { name: 'Start a session' }),
  ).toBeVisible();
});

test('new session derives orch/upload-fix and starts it', async () => {
  await page.getByRole('main').getByRole('button', { name: 'Start a session' }).click();
  await expect(sessionDialog()).toBeVisible();
  await sessionDialog().getByLabel('Task').fill('upload-fix');
  await expect(sessionDialog().getByLabel('Branch')).toHaveValue('orch/upload-fix');
  await expect(sessionDialog().getByLabel('Base')).toHaveValue('remote');
  await sessionDialog().getByRole('button', { name: 'Start session' }).click();
  await expect(sessionDialog()).toHaveCount(0, { timeout: 15_000 });
  await expect(row('upload-fix')).toBeVisible();
});

test('fetch failure offers start from local and the second request carries a new requestId', async () => {
  // The remote goes away, so the fetch before the start fails.
  if (repo.remote === null) throw new Error('repo has no remote');
  renameSync(repo.remote, `${repo.remote}.gone`);
  const bodies: { base: string; requestId: string }[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/sessions') {
      bodies.push(request.postDataJSON() as { base: string; requestId: string });
    }
  });
  await openNewSession();
  await sessionDialog().getByLabel('Task').fill('report-export');
  await sessionDialog().getByRole('button', { name: 'Start session' }).click();
  const alert = sessionDialog().getByRole('alert');
  await expect(alert).toContainText('Fetch failed:', { timeout: 15_000 });
  await expect(alert).toContainText('Start from the local branch?');
  await alert.getByRole('button', { name: 'Start from local' }).click();
  await expect(sessionDialog()).toHaveCount(0, { timeout: 15_000 });
  await expect(row('report-export')).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]?.base).toBe('remote');
  expect(bodies[1]?.base).toBe('local');
  expect(bodies[1]?.requestId).not.toBe(bodies[0]?.requestId);
});

test('a duplicate task name shows an error under the task field', async () => {
  await openNewSession();
  await sessionDialog().getByLabel('Task').fill('upload-fix');
  await sessionDialog().getByLabel('Base').selectOption('local');
  await sessionDialog().getByRole('button', { name: 'Start session' }).click();
  const task = sessionDialog().getByLabel('Task');
  await expect(task).toHaveAttribute('aria-invalid', 'true');
  await expect(task).toHaveAccessibleDescription(/already exists/);
  await page.keyboard.press('Escape');
  await expect(sessionDialog()).toHaveCount(0);
});

test('remembers model, effort and mode for the next start', async () => {
  await openNewSession();
  const dialog = sessionDialog();
  await dialog.getByLabel('Task').fill('i18n-de');
  await dialog.getByLabel('Base').selectOption('local');
  await dialog.getByLabel('Model').selectOption('opus');
  await dialog.getByLabel('Effort').selectOption('high');
  await dialog.getByRole('radio', { name: 'Manual' }).check();
  await dialog.getByRole('button', { name: 'Start session' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(row('i18n-de')).toBeVisible();

  await openNewSession();
  await expect(dialog.getByLabel('Model')).toHaveValue('opus');
  await expect(dialog.getByLabel('Effort')).toHaveValue('high');
  await expect(dialog.getByRole('radio', { name: 'Manual' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
