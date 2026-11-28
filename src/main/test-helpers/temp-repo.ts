// Test helper: a throwaway Git repository with one commit, an ignored `.env`
// and a tracked `.env.example`, optionally with a bare `origin` remote.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

export function createTempRepo(
  opts: { withRemote?: boolean; dirName?: string } = {},
): Promise<TempRepo> {
  const base = mkdtempSync(join(tmpdir(), 'orchtopus-git-'));
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
    cleanup: () => {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      return Promise.resolve();
    },
  });
}
