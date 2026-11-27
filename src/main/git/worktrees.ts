// Worktrees under `<repo>/.claude/worktrees/<task>`: name checks, the local
// exclude line, base resolution, create, copy of ignored files, clean check
// and remove. Outside the worktree folder this changes nothing in the
// repository except `.git/info/exclude` and the metadata `git worktree add`
// writes.
import { existsSync, realpathSync } from 'node:fs';
import { appendFile, cp, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { validateTaskName } from '../../shared/task-name';
import { gitOut, runGit } from './git';
import { redactUrls } from './remote-url';
import { samePath } from './repo-info';

export const WORKTREES_DIR = '.claude/worktrees';
const EXCLUDE_LINE = '/.claude/worktrees/';
export const FETCH_TIMEOUT_MS = 60_000;

export function worktreePath(root: string, task: string): string {
  return join(root, '.claude', 'worktrees', task);
}

/** Returns an error text when the task or branch cannot be used, else null. */
export async function checkNewWorktree(
  root: string,
  task: string,
  branch: string,
): Promise<string | null> {
  const nameError = validateTaskName(task);
  if (nameError !== null) return nameError;
  if (existsSync(worktreePath(root, task))) {
    return `A worktree named ${task} already exists. Pick another task name.`;
  }
  const format = await runGit(['check-ref-format', '--branch', branch], { cwd: root });
  if (format.code !== 0) return `${branch} is not a valid branch name.`;
  const local = await runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd: root,
  });
  if (local.code === 0) return `The branch ${branch} already exists. Pick another task name.`;
  const remoteRefs =
    (await gitOut(['for-each-ref', '--format=%(refname)', 'refs/remotes'], root)) ?? '';
  const onRemote = remoteRefs
    .split(/\r?\n/)
    .some(
      (ref) =>
        /^refs\/remotes\/[^/]+\//.test(ref) &&
        ref.replace(/^refs\/remotes\/[^/]+\//, '') === branch,
    );
  if (onRemote) {
    return `A remote already has a branch ${branch}. Pick another task name.`;
  }
  return null;
}

export async function ensureWorktreesExcluded(
  root: string,
): Promise<'already-ignored' | 'added' | { refused: string }> {
  const tracked = await runGit(['ls-files', '--', WORKTREES_DIR], { cwd: root });
  if (tracked.code !== 0) return { refused: 'Git could not list the tracked files.' };
  if (tracked.stdout.trim() !== '') {
    return {
      refused:
        'Files under .claude/worktrees are tracked in this repository. Remove them from Git before starting a session.',
    };
  }
  const ignored = await runGit(['check-ignore', '-q', `${WORKTREES_DIR}/probe`], { cwd: root });
  if (ignored.code === 0) return 'already-ignored';

  const rel = await gitOut(['rev-parse', '--git-path', 'info/exclude'], root);
  if (rel === null || rel === '') return { refused: 'Git could not locate .git/info/exclude.' };
  const file = resolve(root, rel);
  await mkdir(dirname(file), { recursive: true });
  const current = existsSync(file) ? await readFile(file, 'utf8') : '';
  if (current.split(/\r?\n/).includes(EXCLUDE_LINE)) return 'already-ignored';
  const prefix = current === '' || current.endsWith('\n') ? '' : '\n';
  await appendFile(file, `${prefix}${EXCLUDE_LINE}\n`, 'utf8');
  return 'added';
}

/**
 * Fetches the default branch and returns `<remote>/<branch>` as base. When
 * the fetch fails it returns `fetchFailed: true` with an empty base; the
 * caller asks the user and calls again with `useLocal: true`.
 */
export async function resolveBase(
  root: string,
  remote: string | null,
  defaultBranch: string,
  useLocal: boolean,
): Promise<{ base: string; fetchFailed: boolean; message?: string }> {
  if (useLocal || remote === null) return { base: defaultBranch, fetchFailed: false };
  const fetched = await runGit(['fetch', '--no-tags', remote, defaultBranch], {
    cwd: root,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (fetched.code !== 0) {
    const detail = redactUrls(fetched.stderr.trim());
    return {
      base: '',
      fetchFailed: true,
      message: `Fetching ${defaultBranch} from ${remote} failed.${detail === '' ? '' : ` ${detail}`}`,
    };
  }
  const tracking = `${remote}/${defaultBranch}`;
  const verified = await runGit(
    ['rev-parse', '--verify', '--quiet', `refs/remotes/${tracking}^{commit}`],
    {
      cwd: root,
    },
  );
  if (verified.code === 0) return { base: tracking, fetchFailed: false };
  const head = await gitOut(['rev-parse', '--verify', '--quiet', 'FETCH_HEAD^{commit}'], root);
  if (head === null) {
    return {
      base: '',
      fetchFailed: true,
      message: `Git fetched ${defaultBranch} but found no commit.`,
    };
  }
  return { base: head, fetchFailed: false };
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
}

async function listWorktrees(root: string): Promise<WorktreeEntry[]> {
  const out = (await gitOut(['worktree', 'list', '--porcelain'], root)) ?? '';
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), branch: null };
      entries.push(current);
    } else if (line.startsWith('branch ') && current !== null) {
      current.branch = line.slice('branch '.length);
    }
  }
  return entries;
}

/** Creates the worktree on a new branch without upstream; idempotent. */
export async function createWorktree(input: {
  root: string;
  task: string;
  branch: string;
  base: string;
}): Promise<{ path: string }> {
  const nameError = validateTaskName(input.task);
  if (nameError !== null) throw new Error(nameError);
  const path = worktreePath(input.root, input.task);

  const existing = (await listWorktrees(input.root)).find((w) => samePath(w.path, path));
  if (existing !== undefined) {
    if (existing.branch === `refs/heads/${input.branch}`) return { path };
    throw new Error(`The worktree ${input.task} exists on another branch.`);
  }

  const res = await runGit(
    ['worktree', 'add', '--quiet', '--no-track', '-b', input.branch, path, input.base],
    { cwd: input.root },
  );
  if (res.code !== 0) {
    throw new Error(`git worktree add failed: ${redactUrls(res.stderr.trim())}`);
  }
  return { path };
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function unsafeEntry(entry: string): boolean {
  if (entry.trim() === '') return true;
  if (isAbsolute(entry) || win32.isAbsolute(entry) || /^[a-z]:/i.test(entry)) return true;
  return entry.split(/[\\/]/).some((segment) => segment === '..');
}

/** Copies the project's list of ignored files from the main folder into a worktree. */
export async function copyIntoWorktree(
  root: string,
  worktree: string,
  list: readonly string[],
): Promise<{ copied: string[]; missing: string[]; refused: string[] }> {
  const copied: string[] = [];
  const missing: string[] = [];
  const refused: string[] = [];
  const realRoot = realpathSync.native(root);
  for (const entry of list) {
    const source = resolve(root, entry);
    if (unsafeEntry(entry) || !isInside(resolve(root), source)) {
      refused.push(entry);
      continue;
    }
    try {
      await stat(source);
    } catch {
      missing.push(entry);
      continue;
    }
    if (!isInside(realRoot, realpathSync.native(source))) {
      refused.push(entry);
      continue;
    }
    const target = resolve(worktree, entry);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, force: true, dereference: false });
    copied.push(entry);
  }
  return { copied, missing, refused };
}

export async function worktreeIsClean(path: string): Promise<boolean> {
  const res = await runGit(['status', '--porcelain', '--untracked-files=normal'], { cwd: path });
  return res.code === 0 && res.stdout.trim() === '';
}

const BUSY =
  /permission denied|ebusy|resource busy|being used by another process|invalid argument|directory not empty/i;

/** Removes a clean worktree; never forces and never deletes the branch. Idempotent. */
export async function removeWorktree(
  root: string,
  path: string,
): Promise<'removed' | { refused: string }> {
  const registered = (await listWorktrees(root)).some((w) => samePath(w.path, path));
  if (!registered) {
    if (!existsSync(path)) return 'removed';
    return { refused: 'This folder is not a worktree of the repository.' };
  }
  if (!existsSync(path)) {
    // Partial remove (crash, or the folder was deleted by hand): drop only this entry's
    // metadata. Never `git worktree prune`, which would drop every stale worktree of the user.
    const res = await runGit(['worktree', 'remove', path], { cwd: root });
    if (res.code === 0) return 'removed';
    return { refused: `git worktree remove failed: ${redactUrls(res.stderr.trim())}` };
  }
  if (!(await worktreeIsClean(path))) {
    return {
      refused:
        'The worktree has uncommitted changes or untracked files. Commit or remove them first.',
    };
  }
  const res = await runGit(['worktree', 'remove', path], { cwd: root });
  if (res.code === 0) return 'removed';
  const detail = redactUrls(res.stderr.trim());
  if (BUSY.test(detail)) {
    return {
      refused:
        'Windows could not delete the worktree folder. Close programs that have it open (an editor, a terminal or Explorer) and try again.',
    };
  }
  return { refused: `git worktree remove failed: ${detail}` };
}
