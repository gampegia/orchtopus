// Test helpers for the adapter: the fake claude CLI (tooling/fake-claude) with a temp
// CLAUDE_CONFIG_DIR, trusted temp folders and a wrapper that records every argv.
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runClaude, type ClaudeCommand } from '../claude/cli';
import { nodePtySpawn, type PtySpawn } from './attach-terminal';

const FAKE_CLI = fileURLToPath(new URL('../../../tooling/fake-claude/cli.mjs', import.meta.url));

export interface FakeClaude {
  root: string;
  cmd: ClaudeCommand;
  /** A folder under the temp root, trusted in the fake's .claude.json unless `trusted` is false. */
  folder: (name: string, trusted?: boolean) => string;
  /** Every argv the fake was called with, in call order. */
  argv: () => string[][];
  /** Stops every fake worker, restores the environment and removes the temp root. */
  cleanup: () => Promise<void>;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export async function waitFor<T>(
  fn: () => Promise<T | undefined | false> | T | undefined | false,
  ms = 10_000,
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > until) throw new Error('timed out waiting');
    await sleep(50);
  }
}

export function isAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * rmSync with a longer window: on Windows a child that has just exited can hold its cwd
 * for a moment (EPERM or EBUSY). Retries for up to `ms`, then throws the last error.
 */
export async function removeDir(dir: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== 'EPERM' && code !== 'EBUSY') || Date.now() > until) throw error;
      await sleep(200);
    }
  }
}

/** Points CLAUDE_CONFIG_DIR (read by the fake through the clean env) at a temp folder. */
export function setupFakeClaude(scenario = 'basic'): FakeClaude {
  const root = mkdtempSync(join(tmpdir(), 'orch-adapter-'));
  const cfg = join(root, 'cfg');
  mkdirSync(cfg, { recursive: true });
  const argvLog = join(root, 'argv.jsonl');
  const recorder = join(root, 'record-argv.mjs');
  writeFileSync(
    recorder,
    [
      "import { appendFileSync } from 'node:fs';",
      `appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
      `await import(${JSON.stringify(pathToFileURL(FAKE_CLI).href)});`,
    ].join('\n'),
  );
  appendFileSync(argvLog, '');
  const saved = {
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    ORCH_FAKE_SCENARIO: process.env.ORCH_FAKE_SCENARIO,
  };
  process.env.CLAUDE_CONFIG_DIR = cfg;
  process.env.ORCH_FAKE_SCENARIO = scenario;
  const cmd: ClaudeCommand = { command: process.execPath, prefixArgs: [recorder] };
  const trusted: Record<string, { hasTrustDialogAccepted: boolean }> = {};

  return {
    root,
    cmd,
    folder: (name, isTrusted = true) => {
      const dir = join(root, name);
      mkdirSync(dir, { recursive: true });
      if (isTrusted) {
        trusted[dir.replace(/\\/g, '/')] = { hasTrustDialogAccepted: true };
        writeFileSync(join(cfg, '.claude.json'), JSON.stringify({ projects: trusted }));
      }
      return dir;
    },
    argv: () =>
      readFileSync(argvLog, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as string[]),
    cleanup: async () => {
      await runClaude({ command: process.execPath, prefixArgs: [FAKE_CLI] }, ['--fake-cleanup'], {
        // Not the temp root: on Windows a process's cwd keeps the folder from being removed.
        cwd: tmpdir(),
        timeoutMs: 15_000,
      });
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = value;
      }
      await removeDir(root);
    },
  };
}

export interface TrackedPtySpawn {
  spawn: PtySpawn;
  /** Process ids of every PTY child spawned so far. */
  pids: () => number[];
  /** Resolves once every PTY spawned so far has exited (capped at `ms`). */
  allExited: (ms?: number) => Promise<void>;
}

/**
 * The real node-pty spawn, recording each child. On Windows a ConPTY child keeps its cwd
 * (a temp folder) locked until it has exited, so tests wait for it before removing the folder.
 */
export function trackedPtySpawn(): TrackedPtySpawn {
  const children: { pid: number; exited: Promise<void> }[] = [];
  return {
    spawn: (file, args, opts) => {
      const pty = nodePtySpawn(file, args, opts);
      // nodePtySpawn returns node-pty's IPty, which carries the child's pid.
      const pid = (pty as { pid?: number }).pid ?? 0;
      const exited = new Promise<void>((resolve) => {
        pty.onExit(() => {
          resolve();
        });
      });
      children.push({ pid, exited });
      return pty;
    },
    pids: () => children.map((c) => c.pid),
    allExited: async (ms = 10_000) => {
      const cap = sleep(ms);
      await Promise.race([Promise.all(children.map((c) => c.exited)), cap]);
      await waitFor(() => children.every((c) => !isAlive(c.pid)), ms).catch(() => undefined);
    },
  };
}
