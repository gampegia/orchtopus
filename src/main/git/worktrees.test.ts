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
  isSafeCopyEntry,
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

  it('refuses when a later ! rule un-ignores .claude/worktrees', async () => {
    const r = await repo();
    mkdirSync(join(r.root, '.git', 'info'), { recursive: true });
    writeFileSync(excludeFile(r.root), '/.claude/worktrees/\n!/.claude/worktrees/\n');
    const result = await ensureWorktreesExcluded(r.root);
    expectRefused(result);
    expect((result as { refused: string }).refused).toContain('!');
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

  it('recreates the folder of a registered worktree whose folder is gone, keeping the branch', async () => {
    const r = await repo();
    await ensureWorktreesExcluded(r.root);
    const input = { root: r.root, task: 'upload-fix', branch: 'orch/upload-fix', base: 'main' };
    const { path } = await createWorktree(input);
    writeFileSync(join(path, 'note.txt'), 'work\n');
    git(path, ['add', 'note.txt']);
    git(path, ['commit', '--quiet', '-m', 'work on the task']);
    rmSync(path, { recursive: true, force: true });

    const again = await createWorktree(input);
    expect(again.path).toBe(path);
    expect(existsSync(join(path, 'note.txt'))).toBe(true);
    expect(git(path, ['symbolic-ref', '--short', 'HEAD'])).toBe('orch/upload-fix');
  });

  it('finishes a create that stopped after git made the branch', async () => {
    const r = await repo();
    await ensureWorktreesExcluded(r.root);
    // `worktree add -b` writes the branch before the checkout; a crash leaves only the branch.
    git(r.root, ['branch', '--no-track', 'orch/upload-fix', 'main']);
    const input = { root: r.root, task: 'upload-fix', branch: 'orch/upload-fix', base: 'main' };
    const { path } = await createWorktree(input);
    expect(git(path, ['symbolic-ref', '--short', 'HEAD'])).toBe('orch/upload-fix');
    expect(gitExitCode(r.root, ['config', 'branch.orch/upload-fix.merge'])).toBe(1);
  });

  it('finishes a re-create that stopped after the worktree entry was removed', async () => {
    const r = await repo();
    await ensureWorktreesExcluded(r.root);
    const input = { root: r.root, task: 'upload-fix', branch: 'orch/upload-fix', base: 'main' };
    const { path } = await createWorktree(input);
    writeFileSync(join(path, 'note.txt'), 'work\n');
    git(path, ['add', 'note.txt']);
    git(path, ['commit', '--quiet', '-m', 'work on the task']);
    git(r.root, ['worktree', 'remove', path]);

    const again = await createWorktree(input);
    expect(again.path).toBe(path);
    expect(existsSync(join(path, 'note.txt'))).toBe(true);
    expect(git(path, ['symbolic-ref', '--short', 'HEAD'])).toBe('orch/upload-fix');
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
    expect(await checkNewWorktree(r.root, 'upload-fix', 'orch/other')).toContain(
      'A worktree named upload-fix already exists',
    );
    expect(await checkNewWorktree(r.root, 'report-export', 'orch/upload-fix')).toContain(
      'The branch orch/upload-fix already exists',
    );

    git(r.root, ['branch', 'orch/i18n-de', 'main']);
    git(r.root, ['push', '--quiet', 'origin', 'orch/i18n-de']);
    git(r.root, ['branch', '-D', 'orch/i18n-de']);
    expect(await checkNewWorktree(r.root, 'i18n-de', 'orch/i18n-de')).toContain(
      'A remote already has a branch orch/i18n-de',
    );
  });

  it('rejects an invalid task name and branch', async () => {
    const r = await repo();
    expect(await checkNewWorktree(r.root, 'Upload_Fix', 'orch/x')).toContain(
      'Use lower-case letters',
    );
    expect(await checkNewWorktree(r.root, 'upload-fix', 'orch/upload..fix')).toContain(
      'is not a valid branch name',
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
      '.git',
      '.claude/worktrees/upload-fix',
    ]);
    expect(result).toEqual({
      copied: ['.env'],
      missing: ['.env.local'],
      refused: ['../outside', 'C:\\x', '/etc/passwd', '.git', '.claude/worktrees/upload-fix'],
    });
    expect(readFileSync(join(path, '.env'), 'utf8')).toBe('API_URL=http://localhost\n');
    expect(await worktreeIsClean(path)).toBe(true);
  });
});

describe('isSafeCopyEntry', () => {
  it.each(['.env', '.env.local', 'config/local.json', './.env', '.claude/settings.local.json'])(
    'accepts %s',
    (entry) => {
      expect(isSafeCopyEntry(entry)).toBe(true);
    },
  );

  it.each([
    '',
    '.',
    '../outside',
    'a/../../b',
    'C:\\x',
    '/etc/passwd',
    '\\\\host\\share',
    '.git',
    '.GIT/config',
    './.git/hooks',
    '.git.',
    '.claude',
    '.claude/worktrees',
    '.claude\\worktrees\\upload-fix',
    '.Claude/Worktrees/x',
    '.env:stream',
  ])('refuses %s', (entry) => {
    expect(isSafeCopyEntry(entry)).toBe(false);
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

  it('finishes a partial remove when the folder is gone but the worktree is still registered', async () => {
    const r = await repo();
    await ensureWorktreesExcluded(r.root);
    const { path } = await createWorktree({
      root: r.root,
      task: 'report-export',
      branch: 'orch/report-export',
      base: 'main',
    });
    // An unrelated stale worktree of the user (e.g. on an unmounted drive) must survive.
    const other = await createWorktree({
      root: r.root,
      task: 'upload-fix',
      branch: 'orch/upload-fix',
      base: 'main',
    });
    rmSync(other.path, { recursive: true, force: true });
    rmSync(path, { recursive: true, force: true });
    expect(git(r.root, ['worktree', 'list', '--porcelain'])).toContain('report-export');

    expect(await removeWorktree(r.root, path)).toBe('removed');
    const listed = git(r.root, ['worktree', 'list', '--porcelain']);
    expect(listed).not.toContain('report-export');
    expect(listed).toContain('upload-fix');
    expect(git(r.root, ['branch', '--list', 'orch/report-export'])).toContain('orch/report-export');
    expect(await removeWorktree(r.root, path)).toBe('removed');
  });

  it('refuses a path outside .claude/worktrees, even a registered worktree', async () => {
    const r = await repo();
    const outside = join(r.root, '..', 'acme-app-side');
    git(r.root, ['worktree', 'add', '--quiet', '-b', 'side', outside, 'main']);
    const result = await removeWorktree(r.root, outside);
    expectRefused(result);
    expect((result as { refused: string }).refused).toContain('.claude/worktrees');
    expect(existsSync(outside)).toBe(true);
    expectRefused(await removeWorktree(r.root, r.root));
  });
});
