import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, type TempDir } from '../store/testing';
import { ensureToken, renewToken, restrictToCurrentUser } from './token-file';

let temp: TempDir;

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
      const output = execFileSync('icacls', [file], { encoding: 'utf8' });
      // icacls prints "<path> <ace>" and then one indented ACE per line; the summary line
      // after a blank line has no "(".
      const aces = output
        .replace(file, '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /:\(/.test(line));
      expect(aces).toHaveLength(1);
      expect(aces[0]?.toLowerCase()).toContain(userInfo().username.toLowerCase());
      expect(aces[0]).toContain('(F)');
    },
  );
});
