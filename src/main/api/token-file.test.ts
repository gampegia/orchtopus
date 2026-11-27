import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, type TempDir } from '../store/testing';
import { ensureToken, renewToken, restrictToCurrentUser } from './token-file';

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
      // Fakes that fail like GNU whoami from Git for Windows: node.exe run with these arguments
      // exits with an error.
      const fakeBin = temp.file('fake-bin');
      mkdirSync(fakeBin);
      copyFileSync(process.execPath, join(fakeBin, 'whoami.exe'));
      copyFileSync(process.execPath, join(fakeBin, 'icacls.exe'));
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
