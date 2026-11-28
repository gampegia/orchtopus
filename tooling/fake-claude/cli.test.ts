// The fake claude CLI, driven as real child processes with temp homes. It
// stands in for Claude Code in unit tests, e2e and CI.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const NODE = process.execPath;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface AgentJson {
  id: string;
  sessionId: string;
  cwd: string;
  kind: string;
  state: string;
  status?: string;
  name: string;
  pid: number;
  startedAt: string;
}

let root = '';
let cfg = '';
let env: NodeJS.ProcessEnv = {};

function run(args: string[], opts: { cwd?: string; scenario?: string } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE, [CLI, ...args], {
      cwd: opts.cwd ?? root,
      env: {
        ...env,
        ...(opts.scenario === undefined ? {} : { ORCH_FAKE_SCENARIO: opts.scenario }),
      },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

interface Interactive {
  child: ChildProcessWithoutNullStreams;
  output: () => string;
  exited: Promise<number | null>;
}

function interactive(args: string[], cwd = root, scenario?: string): Interactive {
  const child = spawn(NODE, [CLI, ...args], {
    cwd,
    env: { ...env, ...(scenario === undefined ? {} : { ORCH_FAKE_SCENARIO: scenario }) },
    windowsHide: true,
  });
  let out = '';
  child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
  child.stderr.on('data', (d: Buffer) => (out += d.toString('utf8')));
  const exited = new Promise<number | null>((resolve) => child.on('close', resolve));
  return { child, output: () => out, exited };
}

async function waitFor<T>(
  fn: () => Promise<T | undefined> | T | undefined,
  ms = 10_000,
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function makeRepo(name: string, trusted = true): Promise<string> {
  const dir = join(root, name);
  await fs.mkdir(dir, { recursive: true });
  if (trusted) {
    const file = join(cfg, '.claude.json');
    let config: { projects?: Record<string, unknown> } = {};
    try {
      config = JSON.parse(await fs.readFile(file, 'utf8')) as typeof config;
    } catch {
      config = {};
    }
    config.projects = {
      ...config.projects,
      [dir.replace(/\\/g, '/')]: { hasTrustDialogAccepted: true },
    };
    await fs.writeFile(file, JSON.stringify(config));
  }
  return dir;
}

async function agents(args: string[] = ['--all']): Promise<AgentJson[]> {
  const res = await run(['agents', '--json', ...args]);
  expect(res.code).toBe(0);
  return JSON.parse(res.stdout) as AgentJson[];
}

async function startBg(
  cwd: string,
  args: string[] = ['Reply with the single word OK.'],
  scenario = 'basic',
): Promise<string> {
  const res = await run(['--bg', ...args], { cwd, scenario });
  expect(res.stderr).toBe('');
  expect(res.code).toBe(0);
  const match = /^backgrounded · ([0-9a-f]{8}) · /.exec(res.stdout);
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A hook script that records its stdin to `<out>` and optionally denies. */
async function hookScript(name: string, deny: boolean): Promise<string> {
  const file = join(root, `${name}.mjs`);
  const out = join(root, `${name}.jsonl`);
  const reply = deny
    ? JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'No pull requests from sessions.',
        },
      })
    : '';
  await fs.writeFile(
    file,
    [
      "import { appendFileSync } from 'node:fs';",
      'let input = "";',
      "process.stdin.on('data', (d) => (input += d));",
      "process.stdin.on('end', () => {",
      `  appendFileSync(${JSON.stringify(out)}, input.trim() + '\\n');`,
      `  process.stdout.write(${JSON.stringify(reply)});`,
      '});',
    ].join('\n'),
  );
  return file;
}

async function readJsonl(name: string): Promise<Record<string, unknown>[]> {
  try {
    const text = await fs.readFile(join(root, `${name}.jsonl`), 'utf8');
    return text
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'orch-fake-claude-'));
  cfg = join(root, 'cfg');
  await fs.mkdir(cfg, { recursive: true });
  env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, CLAUDE_CONFIG_DIR: cfg };
});

afterEach(async () => {
  await run(['--fake-cleanup']);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('fake claude CLI', { timeout: 30_000 }, () => {
  it('prints the version', async () => {
    const res = await run(['--version']);
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('2.1.332 (Claude Code)');
  });

  it('refuses --bg in an untrusted folder', async () => {
    const dir = await makeRepo('acme-app', false);
    const res = await run(['--bg', 'hello'], { cwd: dir });
    expect(res.code).toBe(1);
    expect(res.stdout + res.stderr).toContain('Workspace not trusted');
    expect(await agents()).toEqual([]);
  });

  it('starts a background session that agents --json lists with a sessionId', async () => {
    const dir = await makeRepo('acme-app');
    const id = await startBg(dir);
    const list = await agents();
    expect(list).toHaveLength(1);
    const entry = list[0];
    expect(entry?.id).toBe(id);
    expect(entry?.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry?.sessionId.startsWith(id)).toBe(true);
    expect(entry?.cwd).toBe(dir);
    expect(entry?.kind).toBe('background');
    expect(entry?.name).toBe('acme-app');
    expect(typeof entry?.pid).toBe('number');
    expect(Number.isNaN(Date.parse(entry?.startedAt ?? ''))).toBe(false);
  });

  it('--cwd filters by folder', async () => {
    const app = await makeRepo('acme-app');
    const web = await makeRepo('acme-web');
    const appId = await startBg(app);
    await startBg(web);
    expect(await agents(['--all'])).toHaveLength(2);
    const filtered = await agents(['--all', '--cwd', app]);
    expect(filtered.map((a) => a.id)).toEqual([appId]);
  });

  it('runs a PreToolUse hook from --settings and logs a deny', async () => {
    const dir = await makeRepo('acme-app');
    const deny = await hookScript('deny', true);
    const other = await hookScript('other', false);
    const settings = join(root, 'settings.json');
    await fs.writeFile(
      settings,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash|PowerShell',
              hooks: [{ type: 'command', command: NODE, args: [deny] }],
            },
            { matcher: 'Read', hooks: [{ type: 'command', command: NODE, args: [other] }] },
          ],
        },
      }),
    );
    const id = await startBg(dir, ['--settings', settings, 'Open a pull request.'], 'pr-attempt');
    const calls = await waitFor(async () => {
      const rows = await readJsonl('deny');
      return rows.length > 0 ? rows : undefined;
    });
    const call = calls[0];
    expect(call?.hook_event_name).toBe('PreToolUse');
    expect(call?.tool_name).toBe('Bash');
    expect(JSON.stringify(call?.tool_input)).toContain('gh pr create');
    expect(call?.cwd).toBe(dir);
    const [entry] = await agents();
    expect(call?.session_id).toBe(entry?.sessionId);
    expect(await readJsonl('other')).toEqual([]);

    const view = interactive(['attach', id]);
    await waitFor(() => view.output().includes('No pull requests from sessions.') || undefined);
    view.child.kill();
  });

  it('stop turns the entry into done without status', async () => {
    const dir = await makeRepo('acme-app');
    const id = await startBg(dir, ['Install the packages.'], 'needs-you');
    await waitFor(async () => ((await agents())[0]?.state === 'blocked' ? true : undefined));
    const [before] = await agents();
    expect(before?.status).toBe('waiting');
    const res = await run(['stop', id]);
    expect(res.code).toBe(0);
    const [after] = await agents();
    expect(after?.state).toBe('done');
    expect(after).not.toHaveProperty('status');
    expect(alive(before?.pid ?? 0)).toBe(false);
  });

  it('resume keeps the saved options', async () => {
    const dir = await makeRepo('acme-app');
    const record = await hookScript('record', false);
    const settings = join(root, 'settings.json');
    await fs.writeFile(
      settings,
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: NODE, args: [record] }] }] },
      }),
    );
    const id = await startBg(dir, [
      '--settings',
      settings,
      '--name',
      'report-export',
      '--model',
      'haiku',
      '--effort',
      'low',
      '--permission-mode',
      'manual',
    ]);
    await waitFor(async () => ((await readJsonl('record')).length === 1 ? true : undefined));
    const [first] = await agents();
    expect((await run(['stop', id])).code).toBe(0);

    const res = await run(['--bg', '--resume', first?.sessionId ?? ''], { cwd: dir });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`backgrounded · ${id} · report-export`);
    const starts = await waitFor(async () => {
      const rows = await readJsonl('record');
      return rows.length === 2 ? rows : undefined;
    });
    expect(starts[1]).toMatchObject({
      hook_event_name: 'SessionStart',
      source: 'resume',
      model: 'haiku',
      permission_mode: 'default',
      session_id: first?.sessionId,
    });
    const [resumed] = await agents();
    expect(resumed?.name).toBe('report-export');
    expect(resumed?.sessionId).toBe(first?.sessionId);
    expect(resumed?.pid).not.toBe(first?.pid);
  });

  it('a second attach takes the session over', async () => {
    const dir = await makeRepo('acme-app');
    const id = await startBg(dir, ['Install the packages.'], 'needs-you');
    const a = interactive(['attach', id]);
    await waitFor(() => a.output().includes('╭─ fake prompt ─╮') || undefined);
    expect(a.output()).toContain('This command requires approval');

    const b = interactive(['attach', id]);
    expect(await a.exited).toBe(0);
    expect(a.output()).toContain('Session opened in another window');
    await waitFor(() => b.output().includes('╭─ fake prompt ─╮') || undefined);
    expect(b.output()).toContain('This command requires approval');

    b.child.stdin.write('hello there\n');
    await waitFor(() => b.output().includes('fake reply: hello there') || undefined);
    expect(b.output()).toContain('> hello there');
    b.child.kill();
  });

  it('the worker survives the death of the cli process', async () => {
    const dir = await makeRepo('acme-app');
    const id = await startBg(dir);
    const [entry] = await agents();
    const view = interactive(['attach', id]);
    await waitFor(() => view.output().includes('╭─ fake prompt ─╮') || undefined);
    view.child.kill();
    await view.exited;
    expect(alive(entry?.pid ?? 0)).toBe(true);
    const done = await waitFor(async () => {
      const [e] = await agents();
      return e?.state === 'done' ? e : undefined;
    });
    expect(done.status).toBe('idle');
    expect(alive(entry?.pid ?? 0)).toBe(true);
  });

  it('trust prompt writes the trust key', async () => {
    const dir = await makeRepo('acme-app', false);
    await fs.writeFile(
      join(cfg, '.claude.json'),
      JSON.stringify({ numStartups: 3, projects: { 'C:/elsewhere': { allowedTools: [] } } }),
    );
    const session = interactive([], dir);
    await waitFor(
      () => session.output().includes('Do you trust the files in this folder?') || undefined,
    );
    session.child.stdin.write('1\n');
    await waitFor(() => session.output().includes('╭─ fake prompt ─╮') || undefined);
    session.child.stdin.write('/exit\n');
    expect(await session.exited).toBe(0);
    const config = JSON.parse(await fs.readFile(join(cfg, '.claude.json'), 'utf8')) as {
      numStartups: number;
      projects: Record<string, Record<string, unknown>>;
    };
    expect(config.numStartups).toBe(3);
    expect(config.projects['C:/elsewhere']).toEqual({ allowedTools: [] });
    expect(config.projects[dir.replace(/\\/g, '/')]?.hasTrustDialogAccepted).toBe(true);
    expect((await run(['--bg', 'hello'], { cwd: dir })).code).toBe(0);
  });

  it('trust-select: Enter accepts trust like the real select list', async () => {
    const dir = await makeRepo('acme-web', false);
    const session = interactive([], dir, 'trust-select');
    await waitFor(
      () => session.output().includes('Do you trust the files in this folder?') || undefined,
    );
    // Typed text is ignored by the select list; the Enter confirms 'Yes, proceed'.
    session.child.stdin.write('/exit\n');
    await waitFor(() => session.output().includes('╭─ fake prompt ─╮') || undefined);
    session.child.stdin.write('/exit\n');
    expect(await session.exited).toBe(0);
    expect((await run(['--bg', 'hello'], { cwd: dir })).code).toBe(0);
  });

  it('trust-select: 2 declines trust', async () => {
    const dir = await makeRepo('docs-site', false);
    const session = interactive([], dir, 'trust-select');
    await waitFor(
      () => session.output().includes('Do you trust the files in this folder?') || undefined,
    );
    session.child.stdin.write('2\n');
    expect(await session.exited).not.toBe(0);
    expect((await run(['--bg', 'hello'], { cwd: dir })).code).toBe(1);
  });
});
