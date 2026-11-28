// The M1 walking skeleton end to end against the fake claude CLI, following the spec's "Done
// when" list: add a project through the dialog, start a session with live output, the PR block,
// quit and kill mid-turn with events arriving while the app is closed, the untouched repository,
// and removing a session while keeping its branch.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { AppSnapshot, SessionView } from '../src/shared/api-types';
import type { PreloadApi } from '../src/shared/preload-api';
import { PR_BLOCK_REASON } from '../src/shared/pr-block';
import { SETUP_ITEM_IDS } from '../src/main/projects/setup-check';
import { git } from '../src/main/test-helpers/temp-repo';
import { ranFile } from '../tooling/fake-claude/store.mjs';
import { createDemoRepo, type DemoRepo } from './fixtures/demo-repo';
import { cleanupFakeClaude, closeApp, launchApp, makeTempDir, removeTempDir } from './launch';

const FAKE_CLAUDE = resolve(__dirname, '..', 'tooling', 'fake-claude', 'cli.mjs');
/** PROMPT_BOX in tooling/fake-claude/store.mjs. */
const PROMPT_BOX = 'fake prompt';
/** The line Orchtopus adds to .git/info/exclude (src/main/git/worktrees.ts). */
const EXCLUDE_LINE = '/.claude/worktrees/';

/** Which fake scenario each session plays (tooling/fake-claude/scenarios). */
const SCENARIOS = {
  'upload-fix': 'mid-turn',
  'report-export': 'pr-attempt',
  'image-resize': 'mid-turn',
};

const dataDir = makeTempDir('orchtopus-e2e-data-');
// No .claude.json: the demo repo starts untrusted and is trusted through the dialog.
const claudeHome = makeTempDir('orchtopus-e2e-claude-');
const fakeEnv = { ...process.env, CLAUDE_CONFIG_DIR: claudeHome };

let app: ElectronApplication | undefined;
let page: Page;
let repo: DemoRepo | undefined;
let repoBefore: RepoSnapshot;

// ---- helpers ------------------------------------------------------------------------------

async function launch(): Promise<void> {
  // Always the unpacked app: a packaged build ignores ORCHTOPUS_CLAUDE_COMMAND and would reach
  // the real claude CLI.
  const launched = await launchApp({
    dataDir,
    claudeHome,
    unpacked: true,
    env: { ORCH_FAKE_SCENARIOS: JSON.stringify(SCENARIOS) },
  });
  app = launched.app;
  page = launched.page;
  await expect(page.getByRole('contentinfo')).toContainText('API connected', { timeout: 15_000 });
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

async function sessionByTask(task: string): Promise<SessionView> {
  const state = await api<AppSnapshot>('GET', '/v1/state');
  const session = state.sessions.find((s) => s.task === task);
  if (session === undefined) throw new Error(`No session ${task}`);
  return session;
}

interface FakeAgent {
  id: string;
  sessionId: string;
  pid: number;
  name: string;
  state: string;
  status?: string;
}

function fakeAgents(): FakeAgent[] {
  const out = execFileSync(process.execPath, [FAKE_CLAUDE, 'agents', '--json', '--all'], {
    env: fakeEnv,
    encoding: 'utf8',
  });
  return JSON.parse(out) as FakeAgent[];
}

function fakeAgent(name: string): FakeAgent {
  const agent = fakeAgents().find((a) => a.name === name);
  if (agent === undefined) throw new Error(`No fake session ${name}`);
  return agent;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseTurn(name: string): void {
  execFileSync(process.execPath, [FAKE_CLAUDE, '--fake-release', name, 'finish'], {
    env: fakeEnv,
  });
}

function row(task: string) {
  return page.getByRole('navigation', { name: 'Sessions' }).getByRole('option', {
    name: new RegExp(task),
  });
}

function header() {
  return page.getByRole('main').locator('.session-header');
}

/** The text in an xterm buffer: the selected session's, or the trust step's. */
async function terminalText(selector = '[data-terminal]'): Promise<string> {
  return page.evaluate((selector) => {
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
    >(selector);
    const buffer = host?.orchtopusTerminal?.buffer.active;
    if (buffer === undefined) return '';
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i += 1) {
      lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
    }
    return lines.join('\n');
  }, selector);
}

async function expectTerminal(text: string | RegExp, timeout = 15_000): Promise<void> {
  await expect.poll(() => terminalText(), { timeout }).toMatch(text);
}

/** Whitespace-insensitive, because xterm wraps long lines. */
function squash(text: string): string {
  return text.replace(/\s+/g, '');
}

interface SpoolLine {
  id: string;
  hook: string;
  sessionId: string | null;
}

function spoolLines(): SpoolLine[] {
  const file = join(dataDir, 'spool', 'events.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as SpoolLine);
}

/** Waits until the hook helpers spooled the rest of the turn of this Claude session. */
async function spooledTurn(claudeSessionId: string): Promise<SpoolLine[]> {
  let lines: SpoolLine[] = [];
  await expect
    .poll(
      () => {
        lines = spoolLines().filter((line) => line.sessionId === claudeSessionId);
        return ['PostToolUse', 'statusline', 'Stop'].every((hook) =>
          lines.some((line) => line.hook === hook),
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return lines;
}

interface EventRow {
  id: string;
  type: string;
  session_id: string | null;
}

function storedEvents(ids: readonly string[]): EventRow[] {
  const db = new Database(join(dataDir, 'state.db'), { readonly: true, fileMustExist: true });
  try {
    const marks = ids.map(() => '?').join(', ');
    return db
      .prepare(`SELECT id, type, session_id FROM events WHERE id IN (${marks})`)
      .all(...ids) as EventRow[];
  } finally {
    db.close();
  }
}

/** Relaunches after a quit or a kill and checks state, spooled events and the live terminal. */
async function expectRecovered(task: string, spooled: readonly SpoolLine[]): Promise<void> {
  await launch();
  await expect(row(task)).toBeVisible({ timeout: 15_000 });
  await expect(row(task)).toContainText('idle', { timeout: 2_000 });

  const session = await sessionByTask(task);
  expect(session.state).toBe('idle');
  const ids = spooled.map((line) => line.id);
  const rows = storedEvents(ids);
  expect(rows.map((r) => r.id).sort()).toEqual([...ids].sort());
  for (const event of rows) {
    expect(event.session_id).toBe(session.id);
    expect(['hook.received', 'statusline.received']).toContain(event.type);
  }

  await row(task).click();
  await expect(header()).toContainText(task);
  await expectTerminal(/Done\./);
  await expectTerminal(PROMPT_BOX);
  await page.locator('[data-terminal]').click();
  await page.keyboard.type(`hello ${task}`);
  await page.keyboard.press('Enter');
  await expectTerminal(`fake reply: hello ${task}`);
}

interface RepoSnapshot {
  /** Path to content hash of every file outside .git and .claude/worktrees. */
  work: Map<string, string>;
  /** Path to content hash of every file under .git. */
  gitDir: Map<string, string>;
  status: string;
  exclude: string;
}

function hashFile(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function walk(dir: string, base: string, skip: (rel: string) => boolean, out: Map<string, string>) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(base, full).replace(/\\/g, '/');
    if (skip(rel)) continue;
    if (statSync(full).isDirectory()) walk(full, base, skip, out);
    else out.set(rel, hashFile(full));
  }
}

function snapshotRepo(root: string): RepoSnapshot {
  // Status first: it can rewrite .git/index (a refreshed stat cache), which the walk below hashes.
  const status = git(root, ['status', '--porcelain', '--ignored']);
  const work = new Map<string, string>();
  walk(root, root, (rel) => rel === '.git' || rel === '.claude/worktrees', work);
  const gitDir = new Map<string, string>();
  const dotGit = join(root, '.git');
  walk(dotGit, dotGit, () => false, gitDir);
  return {
    work,
    gitDir,
    status,
    exclude: readFileSync(join(dotGit, 'info', 'exclude'), 'utf8'),
  };
}

/**
 * Files under .git that may change: what `git worktree add` writes (the worktree's admin folder,
 * the new branch ref and its reflog), git's own record of the fetch before a start, the index
 * (git status and git worktree refresh its stat cache, the content is unchanged) and the exclude
 * file (its content is checked exactly).
 */
const ALLOWED_GIT_CHANGES = [
  /^worktrees\//,
  /^refs\/heads\/orch\//,
  /^logs\/refs\/heads\/orch\//,
  /^FETCH_HEAD$/,
  /^index$/,
  /^info\/exclude$/,
];

// ---- tests --------------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  repo = await createDemoRepo();
  repoBefore = snapshotRepo(demo().root);
  await launch();
});

/** The demo repo; beforeAll made it, so every test can rely on it. */
function demo(): DemoRepo {
  if (repo === undefined) throw new Error('demo repo not created');
  return repo;
}

test.afterAll(async () => {
  try {
    if (app !== undefined) await closeApp(app);
  } finally {
    // Ends the fake background workers, then removes the repo and the temp folders.
    try {
      cleanupFakeClaude(claudeHome);
    } finally {
      await repo?.cleanup();
      removeTempDir(claudeHome);
      removeTempDir(dataDir);
    }
  }
});

test('adds acme-app through the dialog and shows the checklist', async () => {
  if (app === undefined) throw new Error('app not started');
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
  }, demo().root);
  await page.getByRole('button', { name: 'Add a project' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a project' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Browse' }).click();
  await expect(dialog.getByLabel('Folder')).toHaveValue(demo().root);

  const items = dialog.getByRole('list', { name: 'Setup check' }).getByRole('listitem');
  await expect(items).toHaveCount(SETUP_ITEM_IDS.length, { timeout: 15_000 });
  for (const item of await items.all()) {
    await expect(item.locator('[data-status-word]')).toHaveText(/^(ok|hint|problem|info)$/);
  }
  // Every finding comes with a suggested fix the user can copy.
  const findings = items.filter({ has: page.locator('[data-status-word]', { hasText: 'hint' }) });
  for (const finding of await findings.all()) {
    await expect(finding.getByRole('button', { name: /^Copy fix for/ })).toBeVisible();
  }

  const step = dialog.getByRole('region', { name: 'Workspace trust' });
  await step.getByRole('button', { name: 'Trust in Claude Code' }).click();
  await expect(step.getByRole('button', { name: 'Close terminal' })).toBeVisible();
  await expect
    .poll(() => terminalText('[data-trust-terminal]'), { timeout: 15_000 })
    .toContain('Do you trust');
  await page.locator('[data-trust-terminal]').click();
  await page.keyboard.type('1');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-trust-terminal]')).toHaveCount(0, { timeout: 10_000 });
  await expect(step).toContainText('Claude Code trusts this folder');

  await dialog.getByRole('button', { name: 'Add project' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Sessions' })).toContainText('acme-app');
});

test('starts upload-fix with a first prompt and shows live output and running within 2 s', async () => {
  await page.getByRole('main').getByRole('button', { name: 'Start a session' }).click();
  const dialog = page.getByRole('dialog', { name: 'New session in acme-app' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Task').fill('upload-fix');
  await expect(dialog.getByLabel('Branch')).toHaveValue('orch/upload-fix');
  await dialog.getByLabel('First prompt').fill('Fix the upload of large files.');
  await dialog.getByRole('button', { name: 'Start session' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  // The row shows 'running' within 2 s of the start returning. That does not measure N2 (the
  // start sets the row to running at once); the Task 11 unit test pins N2.
  await expect(row('upload-fix')).toContainText('running', { timeout: 2_000 });

  const worktree = join(demo().root, '.claude', 'worktrees', 'upload-fix');
  expect(existsSync(worktree)).toBe(true);
  expect(git(worktree, ['branch', '--show-current'])).toBe('orch/upload-fix');
  const session = await sessionByTask('upload-fix');
  expect(resolve(session.worktreePath)).toBe(resolve(worktree));

  // The new session is selected and its live terminal shows the turn in progress.
  await expect(header()).toContainText('upload-fix');
  await expectTerminal('Working on the fix');
  await expectTerminal(PROMPT_BOX);
  expect(fakeAgent('upload-fix').state).toBe('working');
});

test('the PR attempt scenario is blocked by the hook', async () => {
  await api('POST', '/v1/sessions', {
    projectId: 'acme-app',
    task: 'report-export',
    branch: 'orch/report-export',
    base: 'local',
    prompt: 'Open a pull request for the export.',
    model: null,
    effort: null,
    mode: 'auto',
    requestId: 'walking-skeleton-report-export',
  });
  await expect(row('report-export')).toContainText('idle', { timeout: 15_000 });
  await row('report-export').click();
  await expect(header()).toContainText('report-export');
  await expectTerminal(/the pull request was not created/);
  await expect.poll(async () => squash(await terminalText())).toContain(squash(PR_BLOCK_REASON));

  // The fake ran the push but never the PR command.
  const agent = fakeAgent('report-export');
  const ran = readFileSync(ranFile(join(claudeHome, 'fake'), agent.id), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => (JSON.parse(line) as { tool_input: { command: string } }).tool_input.command);
  expect(ran).toEqual(['git push -u origin HEAD']);
});

test('quits mid-turn, events arrive while closed, restart shows state and live terminal', async () => {
  if (app === undefined) throw new Error('app not started');
  const agent = fakeAgent('upload-fix');
  expect(agent.state).toBe('working');
  await closeApp(app);
  app = undefined;

  releaseTurn('upload-fix');
  const spooled = await spooledTurn(agent.sessionId);
  await expect.poll(() => fakeAgent('upload-fix').state).toBe('done');
  expect(fakeAgent('upload-fix').pid).toBe(agent.pid);

  await expectRecovered('upload-fix', spooled);
});

test('killed app (TerminateProcess) keeps the session and recovers', async () => {
  await api('POST', '/v1/sessions', {
    projectId: 'acme-app',
    task: 'image-resize',
    branch: 'orch/image-resize',
    base: 'local',
    prompt: 'Resize the preview images.',
    model: null,
    effort: null,
    mode: 'auto',
    requestId: 'walking-skeleton-image-resize',
  });
  // As for upload-fix: not a measure of N2.
  await expect(row('image-resize')).toContainText('running', { timeout: 2_000 });
  await expect.poll(() => fakeAgent('image-resize').state).toBe('working');
  const agent = fakeAgent('image-resize');

  if (app === undefined) throw new Error('app not started');
  // app.process() can be a launcher in front of Electron's main process; the main process is
  // the one that holds the API, the store and the PTYs.
  const mainPid = await app.evaluate(() => process.pid);
  // On Windows process.kill ends the process with TerminateProcess, like the Task Manager.
  process.kill(mainPid);
  await expect.poll(() => isAlive(mainPid)).toBe(false);
  app = undefined;

  releaseTurn('image-resize');
  const spooled = await spooledTurn(agent.sessionId);
  await expect.poll(() => fakeAgent('image-resize').state).toBe('done');
  expect(fakeAgent('image-resize').pid).toBe(agent.pid);

  await expectRecovered('image-resize', spooled);
});

test('the repository changed only by one exclude line and worktree metadata', async () => {
  // Let the sessions' last writes settle; nothing below may depend on timing.
  await expect(row('image-resize')).toContainText('idle');
  const after = snapshotRepo(demo().root);

  expect([...after.work.entries()]).toEqual([...repoBefore.work.entries()]);
  // The worktrees folder is the only new path, and git sees it as ignored (the exclude line).
  const statusLines = (status: string) => status.split('\n').filter((line) => line !== '');
  expect(statusLines(after.status).sort()).toEqual(
    [...statusLines(repoBefore.status), '!! .claude/'].sort(),
  );
  expect(readdirSync(join(demo().root, '.claude'))).toEqual(['worktrees']);
  expect(after.exclude).toBe(`${repoBefore.exclude}${EXCLUDE_LINE}\n`);

  const changed = new Set<string>();
  for (const [path, hash] of after.gitDir) {
    if (repoBefore.gitDir.get(path) !== hash) changed.add(path);
  }
  for (const path of repoBefore.gitDir.keys()) {
    if (!after.gitDir.has(path)) changed.add(path);
  }
  const unexpected = [...changed].filter(
    (path) => !ALLOWED_GIT_CHANGES.some((pattern) => pattern.test(path)),
  );
  expect(unexpected).toEqual([]);
  expect([...changed].some((path) => path.startsWith('worktrees/upload-fix/'))).toBe(true);
  expect(changed.has('refs/heads/orch/upload-fix')).toBe(true);
});

test('removes the session and keeps the branch', async () => {
  const worker = fakeAgent('upload-fix').pid;
  await row('upload-fix').click();
  await header().getByRole('button', { name: 'More for upload-fix' }).click();
  await page.getByRole('menuitem', { name: 'Remove session' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(row('upload-fix')).toHaveCount(0, { timeout: 15_000 });

  await expect
    .poll(() => existsSync(join(demo().root, '.claude', 'worktrees', 'upload-fix')), {
      timeout: 15_000,
    })
    .toBe(false);
  expect(git(demo().root, ['branch', '--list', 'orch/upload-fix'])).toContain('orch/upload-fix');
  // git no longer lists the worktree, and the fake background worker has ended.
  expect(git(demo().root, ['worktree', 'list', '--porcelain'])).not.toMatch(
    /worktrees[\\/]upload-fix/,
  );
  await expect.poll(() => isAlive(worker), { timeout: 15_000 }).toBe(false);
  // The exclude line stays for the other sessions.
  expect(readFileSync(join(demo().root, '.git', 'info', 'exclude'), 'utf8')).toContain(
    EXCLUDE_LINE,
  );
});
