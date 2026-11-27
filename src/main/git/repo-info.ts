// Project detection: is a folder the top level of a normal Git repository,
// what is its default branch, which remotes does it have (credentials
// stripped) and which provider hosts `origin`.
import { existsSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { GitMissingError, gitOut, runGit } from './git';
import { stripCredentials } from './remote-url';

export interface RemoteInfo {
  name: string;
  /** Already stripped of credentials. */
  url: string;
}

export type GitProvider = 'github' | 'gitlab';

export type RepoInspection =
  | {
      ok: true;
      root: string;
      defaultBranch: string;
      currentBranch: string | null;
      remotes: RemoteInfo[];
      provider: GitProvider | null;
    }
  | {
      ok: false;
      reason: 'not-a-repo' | 'not-top-level' | 'is-worktree' | 'is-bare' | 'git-missing';
      message: string;
    };

/** Used when neither origin/HEAD nor a current branch exists (detached HEAD). */
const FALLBACK_DEFAULT_BRANCH = 'main';

export async function inspectRepo(path: string): Promise<RepoInspection> {
  if (!isDirectory(path)) {
    return { ok: false, reason: 'not-a-repo', message: 'The folder does not exist.' };
  }
  try {
    return await inspect(path);
  } catch (err) {
    if (err instanceof GitMissingError) {
      return { ok: false, reason: 'git-missing', message: err.message };
    }
    throw err;
  }
}

async function inspect(path: string): Promise<RepoInspection> {
  const bare = await gitOut(['rev-parse', '--is-bare-repository'], path);
  if (bare === null) {
    return {
      ok: false,
      reason: 'not-a-repo',
      message: 'This folder is not a Git repository. Pick the top folder of a repository.',
    };
  }
  if (bare === 'true') {
    return {
      ok: false,
      reason: 'is-bare',
      message: 'This is a bare repository. Pick a repository with a working folder.',
    };
  }

  const dirs = await gitOut(
    ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'],
    path,
  );
  const [gitDir, commonDir] = (dirs ?? '').split(/\r?\n/);
  if (gitDir === undefined || commonDir === undefined) {
    return { ok: false, reason: 'not-a-repo', message: 'Git could not read this repository.' };
  }
  if (!samePath(gitDir, commonDir)) {
    return {
      ok: false,
      reason: 'is-worktree',
      message: 'This folder is a linked worktree. Pick the main folder of the repository.',
    };
  }

  const top = await gitOut(['rev-parse', '--show-toplevel'], path);
  if (top === null || top === '') {
    return {
      ok: false,
      reason: 'not-top-level',
      message: 'This folder is inside a repository but has no working folder.',
    };
  }
  if (!samePath(top, path)) {
    return {
      ok: false,
      reason: 'not-top-level',
      message: 'This folder is inside a repository. Pick the top folder of the repository.',
    };
  }

  const root = resolve(top);
  const currentBranch = await gitOut(['symbolic-ref', '--quiet', '--short', 'HEAD'], root);
  const originHead = await gitOut(
    ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    root,
  );
  const defaultBranch =
    originHead !== null && originHead.startsWith('origin/')
      ? originHead.slice('origin/'.length)
      : (currentBranch ?? FALLBACK_DEFAULT_BRANCH);

  const remotes = await listRemotes(root);
  const origin = remotes.find((r) => r.name === 'origin');
  return {
    ok: true,
    root,
    defaultBranch,
    currentBranch: currentBranch === '' ? null : currentBranch,
    remotes,
    provider: origin === undefined ? null : providerFromUrl(origin.url),
  };
}

async function listRemotes(root: string): Promise<RemoteInfo[]> {
  const names = (await gitOut(['remote'], root)) ?? '';
  const remotes: RemoteInfo[] = [];
  for (const name of names.split(/\r?\n/).filter((n) => n !== '')) {
    const res = await runGit(['remote', 'get-url', name], { cwd: root });
    if (res.code === 0) remotes.push({ name, url: stripCredentials(res.stdout.trim()) });
  }
  return remotes.sort((a, b) => a.name.localeCompare(b.name));
}

export function providerFromUrl(url: string): GitProvider | null {
  const host = hostOf(url)?.toLowerCase();
  if (host === undefined) return null;
  if (host === 'github.com') return 'github';
  if (host === 'gitlab.com' || host.includes('gitlab')) return 'gitlab';
  return null;
}

function hostOf(url: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    try {
      return new URL(url).hostname;
    } catch {
      return undefined;
    }
  }
  // scp form: [user@]host:path, but not a Windows drive path such as C:\x.
  const scp = /^(?:[^@/\\]+@)?([^:/\\]+):(?!\\)/.exec(url);
  if (scp?.[1] !== undefined && scp[1].length > 1) return scp[1];
  return undefined;
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function canonical(path: string): string {
  let p = resolve(path);
  try {
    p = realpathSync.native(p);
  } catch {
    // Keep the resolved path when it cannot be canonicalised.
  }
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

export function samePath(a: string, b: string): boolean {
  return canonical(a) === canonical(b);
}
