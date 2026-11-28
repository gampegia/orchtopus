// Runs git with an argument array (never a shell), the clean child
// environment and no terminal prompts. A non-zero exit is a result, not an
// error; only a missing git or a missing working folder rejects.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import { cleanEnv } from '../child-env';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const DEFAULT_GIT_TIMEOUT_MS = 30_000;

export class GitMissingError extends Error {
  constructor() {
    super('Git was not found. Install Git for Windows and make sure `git` is on the PATH.');
    this.name = 'GitMissingError';
  }
}

export class FolderMissingError extends Error {
  constructor(readonly folder: string) {
    super('The folder does not exist.');
    this.name = 'FolderMissingError';
  }
}

/**
 * The first git.exe in an absolute PATH entry. Empty, "." and relative entries are skipped: a
 * bare `git` would let libuv run a git.exe from the repository's own folder (it searches the
 * child's cwd before PATH), and a relative entry would do the same.
 */
export function findGitOnPath(
  pathValue: string,
  exists: (file: string) => boolean = existsSync,
): string | null {
  for (const raw of pathValue.split(win32.delimiter)) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1');
    if (dir === '' || !win32.isAbsolute(dir)) continue;
    const file = win32.join(dir, 'git.exe');
    if (exists(file)) return file;
  }
  return null;
}

let resolvedGit: string | null = null;

/** The absolute git path, looked up once; null (and looked up again next time) when missing. */
function gitExecutable(): string | null {
  if (process.platform !== 'win32') return 'git';
  resolvedGit ??= findGitOnPath(process.env['PATH'] ?? '');
  return resolvedGit;
}

export function runGit(
  args: readonly string[],
  opts: { cwd: string; timeoutMs?: number },
): Promise<GitResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  const file = gitExecutable();
  if (file === null) return Promise.reject(new GitMissingError());
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        cwd: opts.cwd,
        env: cleanEnv({ GIT_TERMINAL_PROMPT: '0' }),
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        if (error.code === 'ENOENT') {
          reject(existsSync(opts.cwd) ? new GitMissingError() : new FolderMissingError(opts.cwd));
          return;
        }
        if (typeof error.code === 'number') {
          resolve({ code: error.code, stdout, stderr });
          return;
        }
        if (error.killed) {
          const seconds = String(Math.round(timeoutMs / 1000));
          resolve({
            code: -1,
            stdout,
            stderr: `${stderr}\ngit timed out after ${seconds} s`.trim(),
          });
          return;
        }
        reject(error instanceof Error ? error : new Error('git could not be started.'));
      },
    );
  });
}

/** Runs git and returns trimmed stdout, or null on a non-zero exit. */
export async function gitOut(args: readonly string[], cwd: string): Promise<string | null> {
  const res = await runGit(args, { cwd });
  return res.code === 0 ? res.stdout.trim() : null;
}
