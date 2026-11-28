import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTempDir, type TempDir } from '../store/testing';
import { ensureToken, renewToken, restrictToCurrentUser } from './token-file';

/** ACEs of each file at the moment non-empty data was written to it through fs/promises. */
const aclAtWrite = vi.hoisted(() => new Map<string, string[]>());

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      const [path, data] = args;
      if (
        process.platform === 'win32' &&
        typeof path === 'string' &&
        typeof data === 'string' &&
        data.length > 0
      ) {
        // A file that does not exist yet gets the folder's inherited ACL on creation.
        aclAtWrite.set(path, existsSync(path) ? acesOf(path) : ['(missing: inherited ACL)']);
      }
      return actual.writeFile(...args);
    },
  };
});

let temp: TempDir;

const icaclsExe = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'icacls.exe');

/** The ACEs icacls lists for a file. */
function acesOf(file: string): string[] {
  const output = execFileSync(icaclsExe, [file], { encoding: 'utf8' });
  // icacls prints "<path> <ace>" and then one indented ACE per line; the summary line
  // after a blank line has no "(".
  return output
    .replace(file, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /:\(/.test(line));
}

beforeEach(() => {
  temp = makeTempDir();
  aclAtWrite.clear();
});

afterEach(() => {
  temp.remove();
});

describe('token file', () => {
  it('creates a 64-hex token once and returns the same on the next call', async () => {
    const file = temp.file('api-token');
    const first = await ensureToken(file);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(file, 'utf8')).toBe(first);
    expect(await ensureToken(file)).toBe(first);
  });

  it('replaces a damaged token file', async () => {
    const file = temp.file('api-token');
    writeFileSync(file, 'not a token');
    const token = await ensureToken(file);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(file, 'utf8')).toBe(token);
  });

  it('renew writes a different token', async () => {
    const file = temp.file('api-token');
    const first = await ensureToken(file);
    const renewed = await renewToken(file);
    expect(renewed).toMatch(/^[0-9a-f]{64}$/);
    expect(renewed).not.toBe(first);
    expect(readFileSync(file, 'utf8')).toBe(renewed);
    expect(await ensureToken(file)).toBe(renewed);
  });

  it('renews past a temp file a crashed process left behind, and leaves it untouched', async () => {
    const file = temp.file('api-token');
    const leftover = `${file}.${String(process.pid)}.tmp`;
    writeFileSync(leftover, 'leftover');
    const token = await renewToken(file);
    expect(readFileSync(file, 'utf8')).toBe(token);
    expect(readFileSync(leftover, 'utf8')).toBe('leftover');
  });

  it.runIf(process.platform === 'win32')(
    'restricts an existing token file to the current user (copied or restored data folder)',
    async () => {
      const file = temp.file('api-token');
      const token = 'a'.repeat(64);
      writeFileSync(file, token);
      expect(acesOf(file).length).toBeGreaterThan(1);
      expect(await ensureToken(file)).toBe(token);
      const aces = acesOf(file);
      expect(aces).toHaveLength(1);
      expect(aces[0]?.toLowerCase()).toContain(userInfo().username.toLowerCase());
    },
    30_000,
  );

  it.runIf(process.platform === 'win32')(
    'restricts the temp file to the current user before the token is written',
    async () => {
      const file = temp.file('api-token');
      await renewToken(file);
      const temps = [...aclAtWrite.keys()].filter((path) => path.startsWith(`${file}.`));
      expect(temps).toHaveLength(1);
      const aces = aclAtWrite.get(temps[0] ?? '') ?? [];
      expect(aces).toHaveLength(1);
      expect(aces[0]?.toLowerCase()).toContain(userInfo().username.toLowerCase());
      expect(acesOf(file)).toHaveLength(1);
    },
    30_000,
  );

  it.runIf(process.platform === 'win32')(
    'restrictToCurrentUser leaves one ACE for the current user',
    async () => {
      const file = temp.file('probe');
      writeFileSync(file, 'x');
      await restrictToCurrentUser(file);
      const aces = acesOf(file);
      expect(aces).toHaveLength(1);
      expect(aces[0]?.toLowerCase()).toContain(userInfo().username.toLowerCase());
      expect(aces[0]).toContain('(F)');
    },
  );

  it.runIf(process.platform === 'win32')(
    'restrictToCurrentUser ignores whoami and icacls found earlier on PATH',
    async () => {
      // Fakes that fail like GNU whoami from Git for Windows: hostname.exe run with these
      // arguments prints no SID and exits with an error. It is small, so copying stays fast.
      const fakeBin = temp.file('fake-bin');
      mkdirSync(fakeBin);
      const hostnameExe = join(icaclsExe, '..', 'hostname.exe');
      copyFileSync(hostnameExe, join(fakeBin, 'whoami.exe'));
      copyFileSync(hostnameExe, join(fakeBin, 'icacls.exe'));
      const file = temp.file('probe');
      writeFileSync(file, 'x');
      const originalPath = process.env['PATH'];
      process.env['PATH'] = `${fakeBin}${delimiter}${originalPath ?? ''}`;
      try {
        await restrictToCurrentUser(file);
      } finally {
        process.env['PATH'] = originalPath;
      }
      const aces = acesOf(file);
      expect(aces).toHaveLength(1);
      expect(aces[0]?.toLowerCase()).toContain(userInfo().username.toLowerCase());
    },
    30_000,
  );
});
