// The session header and the live terminal against the fake CLI: replay, input, stop, resume
// of stopped and failed sessions, remove with confirmation, and a takeover by another attach.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { SessionView } from '../src/shared/api-types';
import type { PreloadApi } from '../src/shared/preload-api';
import { createTempRepo, type TempRepo } from '../src/main/test-helpers/temp-repo';
import { closeApp, launchApp } from './launch';

const FAKE_CLAUDE = resolve(__dirname, '..', 'tooling', 'fake-claude', 'cli.mjs');
/** PROMPT_BOX in tooling/fake-claude/store.mjs. */
const PROMPT_BOX = 'fake prompt';

let app: ElectronApplication | undefined;
let page: Page;
let repo: TempRepo | undefined;
const claudeHome = mkdtempSync(join(tmpdir(), 'orchtopus-e2e-claude-'));
const fakeEnv = { ...process.env, CLAUDE_CONFIG_DIR: claudeHome };
const extraAttaches: ChildProcess[] = [];

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

function startSession(task: string): Promise<SessionView> {
  return api<SessionView>('POST', '/v1/sessions', {
    projectId: 'acme-app',
    task,
    branch: `orch/${task}`,
    base: 'local',
    prompt: 'fix the upload',
    model: null,
    effort: null,
    mode: 'auto',
    requestId: `view-start-${task}`,
  });
}

interface FakeAgent {
  id: string;
  pid: number;
  name: string;
  state: string;
  /** Only present while the worker process is alive. */
  status?: string;
}

function fakeAgents(): FakeAgent[] {
  const out = execFileSync(process.execPath, [FAKE_CLAUDE, 'agents', '--json', '--all'], {
    env: fakeEnv,
    encoding: 'utf8',
  });
  return JSON.parse(out) as FakeAgent[];
}

function liveAgent(name: string): FakeAgent {
  const agent = fakeAgents().find((a) => a.name === name && a.status !== undefined);
  if (agent === undefined) throw new Error(`No live fake session ${name}`);
  return agent;
}

function row(task: string) {
  return page.getByRole('navigation', { name: 'Sessions' }).getByRole('option', {
    name: new RegExp(task),
  });
}

function header() {
  return page.getByRole('main').locator('.session-header');
}

/** The text in the selected session's xterm buffer. */
async function terminalText(): Promise<string> {
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
    >('[data-terminal]');
    const buffer = host?.orchtopusTerminal?.buffer.active;
    if (buffer === undefined) return '';
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i += 1) {
      lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
    }
    return lines.join('\n');
  });
}

async function expectTerminal(text: string | RegExp, timeout = 15_000): Promise<void> {
  await expect.poll(terminalText, { timeout }).toMatch(text);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const launched = await launchApp({ claudeHome });
  app = launched.app;
  page = launched.page;
  await launched.app.context().addInitScript(() => {
    const scope = globalThis as unknown as { cspViolations: string[] };
    scope.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      scope.cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await page.reload();
  await page.waitForLoadState('load');
  repo = await createTempRepo();
  // The fake CLI reads workspace trust from the Claude home, like the real one.
  writeFileSync(
    join(claudeHome, '.claude.json'),
    JSON.stringify({
      projects: { [repo.root.replace(/\\/g, '/')]: { hasTrustDialogAccepted: true } },
    }),
  );
  await expect(page.getByRole('contentinfo')).toContainText('API connected', { timeout: 15_000 });
  await api('POST', '/v1/projects', {
    path: repo.root,
    checkCommands: { test: null, lint: null, typecheck: null },
    copyList: [],
    branchPrefix: 'orch/',
    requestId: 'view-add-project',
  });
  await startSession('upload-fix');
  await startSession('report-export');
  await expect(row('upload-fix')).toBeVisible();
  await expect(row('report-export')).toBeVisible();
});

test.afterAll(async () => {
  for (const child of extraAttaches) child.kill();
  if (app !== undefined) await closeApp(app);
  // Ends the fake background workers this test started.
  execFileSync(process.execPath, [FAKE_CLAUDE, '--fake-cleanup'], {
    env: fakeEnv,
    stdio: 'ignore',
  });
  await repo?.cleanup();
});

test('opening a session shows the replayed output and the prompt box', async () => {
  await row('upload-fix').click();
  await expect(header()).toContainText('upload-fix');
  await expect(header()).toContainText('orch/upload-fix');
  await expect(header()).toContainText(/ctx (\d+ %|unknown)/);
  await expectTerminal(/Done\./);
  await expectTerminal(PROMPT_BOX);
});

test('typed text reaches the session and the reply appears', async () => {
  await page.locator('[data-terminal]').click();
  await page.keyboard.type('hello there');
  await page.keyboard.press('Enter');
  await expectTerminal('fake reply: hello there');
});

test('stop changes the word to stopped within 2 s', async () => {
  const stopped = page.waitForResponse(
    (response) => response.url().includes('/stop') && response.request().method() === 'POST',
  );
  await header().getByRole('button', { name: 'Stop' }).click();
  expect((await stopped).status()).toBe(204);
  await expect(header()).toContainText('stopped', { timeout: 2_000 });
  await expect(row('upload-fix')).toContainText('stopped', { timeout: 2_000 });
  await expect(header().getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await expect(page.getByText('Terminal closed', { exact: true })).toBeVisible();
});

test('opening a stopped session resumes it and shows the terminal', async () => {
  await row('report-export').click();
  await expect(header()).toContainText('report-export');
  await row('upload-fix').click();
  await expect(header()).toContainText(/running|idle|needs you/, { timeout: 15_000 });
  await expectTerminal(PROMPT_BOX);
  await expect(page.getByText('Terminal closed', { exact: true })).toHaveCount(0);
});

test('opening a failed session after a reboot resumes it the same way', async () => {
  // A reboot: the worker is gone while Claude Code still records the session as working.
  const agent = liveAgent('report-export');
  process.kill(agent.pid);
  const file = join(claudeHome, 'fake', 'sessions', `${agent.id}.json`);
  await expect
    .poll(() => {
      try {
        process.kill(agent.pid, 0);
        return true;
      } catch {
        return false;
      }
    })
    .toBe(false);
  const record = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  writeFileSync(file, JSON.stringify({ ...record, state: 'working', status: 'busy' }));
  await expect(row('report-export')).toContainText('failed', { timeout: 10_000 });
  await row('report-export').click();
  await expect(header()).toContainText('report-export');
  await expect(header()).toContainText(/running|idle|needs you/, { timeout: 15_000 });
  await expectTerminal(PROMPT_BOX);
});

test('remove asks for confirmation and removes the row', async () => {
  await row('report-export').click();
  await header().getByRole('button', { name: 'More for report-export' }).click();
  await page.getByRole('menuitem', { name: 'Remove session' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('report-export');
  await expect(dialog).toContainText('orch/report-export');
  await expect(dialog).toContainText('kept');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(row('report-export')).toBeVisible();

  await header().getByRole('button', { name: 'More for report-export' }).click();
  await page.getByRole('menuitem', { name: 'Remove session' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(row('report-export')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a takeover shows Opened in another window and Reattach', async () => {
  await row('upload-fix').click();
  await expectTerminal(PROMPT_BOX);
  const agent = liveAgent('upload-fix');
  // The user's own terminal: a second attach takes the session over (Review Focus 3).
  const other = spawn(process.execPath, [FAKE_CLAUDE, 'attach', agent.id], {
    env: fakeEnv,
    stdio: 'pipe',
  });
  extraAttaches.push(other);
  await expect(page.getByText('Opened in another window', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  const reattach = page.getByRole('button', { name: 'Reattach' });
  await expect(reattach).toBeVisible();
  // The app never reattaches by itself.
  await page.waitForTimeout(1_500);
  await expect(page.getByText('Opened in another window', { exact: true })).toBeVisible();
  other.kill();
  await reattach.click();
  await expect(page.getByText('Opened in another window', { exact: true })).toHaveCount(0, {
    timeout: 10_000,
  });
  await expectTerminal(PROMPT_BOX);
});

test('no CSP violations while the terminal renders', async () => {
  const violations = await page.evaluate(
    () => (globalThis as unknown as { cspViolations?: string[] }).cspViolations ?? null,
  );
  expect(violations).toEqual([]);
});
