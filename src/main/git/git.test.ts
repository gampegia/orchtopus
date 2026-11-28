import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findGitOnPath, runGit } from './git';

const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orchtopus-git-'));
  dirs.push(dir);
  return dir;
}

describe('findGitOnPath', () => {
  const present = new Set(['C:\\Tools\\Git\\cmd\\git.exe', 'D:\\other\\git.exe']);
  const exists = (file: string): boolean => present.has(file);

  it('returns the first git.exe in an absolute PATH entry', () => {
    expect(findGitOnPath('C:\\Windows;C:\\Tools\\Git\\cmd;D:\\other', exists)).toBe(
      'C:\\Tools\\Git\\cmd\\git.exe',
    );
  });

  it('skips empty, "." and relative entries', () => {
    const relative = new Set(['.\\git.exe', 'bin\\git.exe', 'git.exe', 'D:\\other\\git.exe']);
    expect(findGitOnPath(';.;bin;D:\\other', (file) => relative.has(file))).toBe(
      'D:\\other\\git.exe',
    );
  });

  it('accepts quoted entries', () => {
    expect(findGitOnPath('"C:\\Tools\\Git\\cmd"', exists)).toBe('C:\\Tools\\Git\\cmd\\git.exe');
  });

  it('returns null when no entry has git.exe', () => {
    expect(findGitOnPath('C:\\Windows;.', exists)).toBeNull();
  });
});

describe.runIf(process.platform === 'win32')('runGit on Windows', () => {
  // libuv searches the child's cwd before PATH unless this variable is set in the parent.
  it('runs the git from PATH, not a git.exe planted in the working folder', async () => {
    vi.stubEnv('NoDefaultCurrentDirectoryInExePath', undefined);
    const repo = tempDir();
    const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
    copyFileSync(join(systemRoot, 'System32', 'hostname.exe'), join(repo, 'git.exe'));
    const result = await runGit(['--version'], { cwd: repo });
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^git version /);
  });
});
