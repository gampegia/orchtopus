// Shared helpers for the cross-session messaging spike. Builds on the M1
// harness (scratch paths, clean child environment, `claude` wrapper).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../m1-claude-code/lib/common.mjs';

export * from '../m1-claude-code/lib/common.mjs';

export const msgPaths = {
  started: join(paths.logs, 'msg-started.jsonl'),
  sends: join(paths.logs, 'msg-send.jsonl'),
  env: join(paths.logs, 'msg-env.jsonl'),
  tokens: join(paths.config, 'msg-tokens'),
};

/** Claude Code's session registry: one `<pid>.json` per running session. */
export const registryDir = () => join(homedir(), '.claude', 'sessions');

/** Short, non-reversible fingerprint, so logs can compare tokens without holding them. */
export const fingerprint = (s) =>
  s ? createHash('sha256').update(String(s)).digest('hex').slice(0, 12) : null;

/** Registry entry for a pid, or null. Read-only. */
export function registryEntry(pid) {
  const file = join(registryDir(), `${pid}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** `peerToken` from the `<pid>.<hash>.key` file next to the registry entry, or null. */
export function registryPeerToken(pid) {
  if (!existsSync(registryDir())) return null;
  const key = readdirSync(registryDir()).find((f) => f.startsWith(`${pid}.`) && f.endsWith('.key'));
  if (!key) return null;
  try {
    return JSON.parse(readFileSync(join(registryDir(), key), 'utf8')).peerToken ?? null;
  } catch {
    return null;
  }
}

/** Registry entry whose sessionId matches, or null. Read-only. */
export function registryBySession(sessionId) {
  if (!existsSync(registryDir())) return null;
  for (const f of readdirSync(registryDir())) {
    if (!/^\d+\.json$/.test(f)) continue;
    const entry = registryEntry(f.slice(0, -5));
    if (entry?.sessionId === sessionId) return entry;
  }
  return null;
}

/** Token that the SessionStart hook captured from CLAUDE_CODE_MESSAGING_TOKEN. */
export function capturedToken(sessionId) {
  const file = join(msgPaths.tokens, `${sessionId}.txt`);
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
}
