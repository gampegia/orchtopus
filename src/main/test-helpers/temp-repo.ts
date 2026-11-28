// Test helper: a throwaway Git repository with one commit, an ignored `.env`
// and a tracked `.env.example`, optionally with a bare `origin` remote.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export interface TempRepo {
  root: string;
  remote: string | null;
  cleanup(): Promise<void>;
}

/** Runs git synchronously for fixtures; throws on a non-zero exit. */
export function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

/**
 * Environment that hides the user's global and system Git config, so a
 * global excludes file or signing setting cannot change test results.
 * Pass each entry to `vi.stubEnv` in a `beforeAll`.
 */
export function isolatedGitEnv(): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'orchtopus-gitcfg-'));
  const file = join(dir, 'gitconfig');
  writeFileSync(file, '[user]\n\tname = Demo\n\temail = demo@example.test\n');
  return { GIT_CONFIG_GLOBAL: file, GIT_CONFIG_NOSYSTEM: '1' };
}

/**
 * rmSync with a longer window: on Windows a git child that has just exited can hold a
 * folder for a moment (EPERM or EBUSY), most often under parallel test load. Retries for
 * up to `ms`, then throws the last error.
 */
export async function removeDir(dir: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== 'EPERM' && code !== 'EBUSY') || Date.now() > until) throw error;
      await sleep(200);
    }
  }
}

export function createTempRepo(
  opts: { withRemote?: boolean; dirName?: string } = {},
): Promise<TempRepo> {
  // The long path: an 8.3 short temp path (RUNNER~1 on CI) would not match the paths
  // git prints, so path comparisons in the tests would fail.
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'orchtopus-git-')));
  const root = join(base, opts.dirName ?? 'acme-app');
  mkdirSync(root);
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.name', 'Demo']);
  git(root, ['config', 'user.email', 'demo@example.test']);
  writeFileSync(join(root, '.gitignore'), '.env\n');
  writeFileSync(join(root, '.env.example'), 'API_URL=\n');
  writeFileSync(join(root, '.env'), 'API_URL=http://localhost\n');
  writeFileSync(join(root, 'README.md'), '# acme-app\n');
  git(root, ['add', '.gitignore', '.env.example', 'README.md']);
  git(root, ['commit', '--quiet', '-m', 'initial commit']);

  let remote: string | null = null;
  if (opts.withRemote === true) {
    remote = join(base, 'remote.git');
    git(base, ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
    git(root, ['remote', 'add', 'origin', remote]);
    git(root, ['push', '--quiet', '-u', 'origin', 'main']);
    git(root, ['remote', 'set-head', 'origin', 'main']);
  }

  return Promise.resolve({
    root,
    remote,
    cleanup: () => removeDir(base),
  });
}
