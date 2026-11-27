import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTempRepo, git, isolatedGitEnv, type TempRepo } from '../test-helpers/temp-repo';
import {
  checkNewWorktree,
  copyIntoWorktree,
  createWorktree,
  ensureWorktreesExcluded,
  removeWorktree,
  resolveBase,
  worktreeIsClean,
} from './worktrees';

let repos: TempRepo[] = [];

beforeAll(() => {
  for (const [key, value] of Object.entries(isolatedGitEnv())) vi.stubEnv(key, value);
});
afterAll(() => {
  vi.unstubAllEnvs();
});
afterEach(async () => {
  await Promise.all(repos.map((r) => r.cleanup()));
  repos = [];
});

async function repo(opts?: Parameters<typeof createTempRepo>[0]): Promise<TempRepo> {
  const r = await createTempRepo(opts);
  repos.push(r);
  return r;
}

function excludeFile(root: string): string {
  return join(root, '.git', 'info', 'exclude');
}

/** Files outside `.git` and `.claude/worktrees`, as sorted relative paths. */
function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).replaceAll('\\', '/');
      if (rel === '.git' || rel === '.claude/worktrees') continue;
      if (entry.isDirectory()) walk(full);
      else out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

function statusSnapshot(root: string): string[] {
  return git(root, ['status', '--porcelain', '--ignored=matching', '--untracked-files=all'])
    .split('\n')
    .filter((line) => line !== '' && !line.slice(3).startsWith('.claude/worktrees/'));
}

function gitExitCode(cwd: string, args: readonly string[]): number {
  try {
    execFileSync('git', args, { cwd, stdio: 'ignore', windowsHide: true });
    return 0;
  } catch (err) {
    return (err as { status: number }).status;
  }
}

function expectRefused(result: unknown): void {
  const refused = (result as { refused?: unknown }).refused;
  expect(typeof refused).toBe('string');
}

describe('ensureWorktreesExcluded', () => {
  it('adds the exclude line once and reports already-ignored next time', async () => {
    const r = await repo();
    expect(await ensureWorktreesExcluded(r.root)).toBe('added');
    expect(await ensureWorktreesExcluded(r.root)).toBe('already-ignored');
    const lines = readFileSync(excludeFile(r.root), 'utf8').split(/\r?\n/);
    expect(lines.filter((l) => l === '/.claude/worktrees/')).toHaveLength(1);
  });

  it('creates info/ when it is missing', async () => {
    const r = await repo();
    rmSync(join(r.root, '.git', 'info'), { recursive: true, force: true });
    expect(await ensureWorktreesExcluded(r.root)).toBe('added');
    expect(readFileSync(excludeFile(r.root), 'utf8')).toBe('/.claude/worktrees/\n');
  });

  it('refuses when a file under .claude/worktrees is tracked', async () => {
    const r = await repo();
    mkdirSync(join(r.root, '.claude', 'worktrees'), { recursive: true });
    writeFileSync(join(r.root, '.claude', 'worktrees', 'keep.txt'), 'x');
    git(r.root, ['add', '.claude/worktrees/keep.txt']);
    git(r.root, ['commit', '--quiet', '-m', 'track a file']);
    const result = await ensureWorktreesExcluded(r.root);
    expectRefused(result);
  });
});

describe('createWorktree', () => {
  it('leaves the repository unchanged apart from info/exclude and worktree metadata', async () => {
    const r = await repo({ withRemote: true });
    const filesBefore = listFiles(r.root);
    const statusBefore = statusSnapshot(r.root);

    await ensureWorktreesExcluded(r.root);
    const { base } = await resolveBase(r.root, 'origin', 'main', false);
    const { path } = await createWorktree({
      root: r.root,
      task: 'upload-fix',
      branch: 'orch/upload-fix',
      base,
    });
    await copyIntoWorktree(r.root, path, ['.env']);

    expect(listFiles(r.root)).toEqual(filesBefore);
    expect(statusSnapshot(r.root)).toEqual(statusBefore);
    expect(git(r.root, ['symbolic-ref', '--short', 'HEAD'])).toBe('main');
  });

  it('creates the branch without upstream', async () => {
    const r = await repo({ withRemote: true });
    await ensureWorktreesExcluded(r.root);
    const { base } = await resolveBase(r.root, 'origin', 'main', false);
    const { path } = await createWorktree({
      root: r.root,
      task: 'upload-fix',
      branch: 'orch/upload-fix',
      base,
    });
    expect(resolve(path)).toBe(resolve(r.root, '.claude', 'worktrees', 'upload-fix'));
    expect(git(path, ['symbolic-ref', '--short', 'HEAD'])).toBe('orch/upload-fix');
    expect(gitExitCode(r.root, ['config', 'branch.orch/upload-fix.merge'])).toBe(1);
  });

  it('create is idempotent', async () => {
    const r = await repo();
    await ensureWorktreesExcluded(r.root);
    const input = { root: r.root, task: 'upload-fix', branch: 'orch/upload-fix', base: 'main' };
    const first = await createWorktree(input);
    const second = await createWorktree(input);
    expect(second.path).toBe(first.path);
  });

  it('refuses an invalid task name', async () => {
    const r = await repo();
    await expect(
      createWorktree({ root: r.root, task: '../x', branch: 'orch/x', base: 'main' }),
    ).rejects.toThrow();
  });

  it('works on a repository path with a space', async () => {
    const r = await repo({ dirName: 'acme app é' });
    await ensureWorktreesExcluded(r.root);
    const { path } = await createWorktree({
      root: r.root,
      task: 'upload-fix',
      branch: 'orch/upload-fix',
      base: 'main',
    });
    expect(existsSync(join(path, 'README.md'))).toBe(true);
  });
});

describe('checkNewWorktree', () => {
  it('accepts a new task and branch', async () => {
    const r = await repo();
    expect(await checkNewWorktree(r.root, 'upload-fix', 'orch/upload-fix')).toBeNull();
  });

  it('rejects a duplicate task and an existing branch', async () => {
    const r = await repo({ withRemote: true });
    await ensureWorktreesExcluded(r.root);
    await createWorktree({
      root: r.root,
      task: 'upload-fix',
      branch: 'orch/upload-fix',
      base: 'main',
    });
    expect(await checkNewWorktree(r.root, 'upload-fix', 'orch/other')).toEqual(expect.any(String));
    expect(await checkNewWorktree(r.root, 'report-export', 'orch/upload-fix')).toEqual(
      expect.any(String),
    );

    git(r.root, ['branch', 'orch/i18n-de', 'main']);
    git(r.root, ['push', '--quiet', 'origin', 'orch/i18n-de']);
    git(r.root, ['branch', '-D', 'orch/i18n-de']);
    expect(await checkNewWorktree(r.root, 'i18n-de', 'orch/i18n-de')).toEqual(expect.any(String));
  });

  it('rejects an invalid task name and branch', async () => {
    const r = await repo();
    expect(await checkNewWorktree(r.root, 'Upload_Fix', 'orch/x')).toEqual(expect.any(String));
    expect(await checkNewWorktree(r.root, 'upload-fix', 'orch/upload..fix')).toEqual(
      expect.any(String),
    );
  });
});

describe('copyIntoWorktree', () => {
  it('copies .env, reports a missing file, refuses ../outside and C:\\x', async () => {
    const r = await repo();
    await ensureWorktreesExcluded(r.root);
    const { path } = await createWorktree({
      root: r.root,
      task: 'upload-fix',
      branch: 'orch/upload-fix',
      base: 'main',
    });
    const result = await copyIntoWorktree(r.root, path, [
      '.env',
      '.env.local',
      '../outside',
      'C:\\x',
      '/etc/passwd',
    ]);
    expect(result).toEqual({
      copied: ['.env'],
      missing: ['.env.local'],
      refused: ['../outside', 'C:\\x', '/etc/passwd'],
    });
    expect(readFileSync(join(path, '.env'), 'utf8')).toBe('API_URL=http://localhost\n');
    expect(await worktreeIsClean(path)).toBe(true);
  });
});

describe('resolveBase', () => {
  it('uses the fetched remote branch', async () => {
    const r = await repo({ withRemote: true });
    expect(await resolveBase(r.root, 'origin', 'main', false)).toEqual({
      base: 'origin/main',
      fetchFailed: false,
    });
  });

  it('reports fetchFailed when the remote is gone', async () => {
    const r = await repo({ withRemote: true });
    if (r.remote === null) throw new Error('expected remote');
    rmSync(r.remote, { recursive: true, force: true });
    const failed = await resolveBase(r.root, 'origin', 'main', false);
    expect(failed.fetchFailed).toBe(true);
    expect(failed.base).toBe('');
    expect(failed.message).toContain('Fetching main from origin failed');
    expect(await resolveBase(r.root, 'origin', 'main', true)).toEqual({
      base: 'main',
      fetchFailed: false,
    });
  });

  it('uses the local branch without a remote', async () => {
    const r = await repo();
    expect(await resolveBase(r.root, null, 'main', false)).toEqual({
      base: 'main',
      fetchFailed: false,
    });
  });
});

describe('removeWorktree', () => {
  it('refuses removal with an untracked file and removes a clean worktree keeping the branch', async () => {
    const r = await repo();
    await ensureWorktreesExcluded(r.root);
    const { path } = await createWorktree({
      root: r.root,
      task: 'upload-fix',
      branch: 'orch/upload-fix',
      base: 'main',
    });
    writeFileSync(join(path, 'notes.txt'), 'draft');
    expect(await worktreeIsClean(path)).toBe(false);
    expectRefused(await removeWorktree(r.root, path));
    expect(existsSync(path)).toBe(true);

    rmSync(join(path, 'notes.txt'));
    expect(await worktreeIsClean(path)).toBe(true);
    expect(await removeWorktree(r.root, path)).toBe('removed');
    expect(existsSync(path)).toBe(false);
    expect(git(r.root, ['branch', '--list', 'orch/upload-fix'])).toContain('orch/upload-fix');
    expect(await removeWorktree(r.root, path)).toBe('removed');
  });
});
