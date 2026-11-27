// The per-installation API token: 32 random bytes as hex in <data>\api-token, readable only by
// the current user (Windows ACL). Created once, replaced only by renewToken or when damaged.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

async function readToken(file: string): Promise<string | null> {
  try {
    const text = (await readFile(file, 'utf8')).trim();
    return TOKEN_PATTERN.test(text) ? text : null;
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Writes a new token through a temp file that is restricted before the rename, so the token is
 * never readable by others, not even for a moment.
 */
async function writeToken(file: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${String(process.pid)}.tmp`;
  try {
    await writeFile(temp, token, { encoding: 'utf8', mode: 0o600 });
    await restrictToCurrentUser(temp);
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
  return token;
}

/** Returns the stored token, creating it on first use (or when the file is damaged). */
export async function ensureToken(file: string): Promise<string> {
  return (await readToken(file)) ?? writeToken(file);
}

/** Replaces the token with a new one. */
export function renewToken(file: string): Promise<string> {
  return writeToken(file);
}

/** The current user's SID from `whoami /user /fo csv /nh` (`"host\user","S-1-5-..."`). */
async function currentUserSid(): Promise<string> {
  const { stdout } = await run('whoami', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true });
  const sid = /"(S-1-[0-9-]+)"/.exec(stdout)?.[1];
  if (sid === undefined) throw new Error('could not read the current user SID');
  return sid;
}

/**
 * Removes inherited permissions and grants full control to the current user only.
 * No-op outside Windows, where the file is created with mode 0600.
 */
export async function restrictToCurrentUser(file: string): Promise<void> {
  if (process.platform !== 'win32') return;
  const sid = await currentUserSid();
  await run('icacls', [file, '/inheritance:r', '/grant:r', `*${sid}:F`], { windowsHide: true });
}
