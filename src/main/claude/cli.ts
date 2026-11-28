// Finds and runs the claude CLI. Always an argument array (never a shell) and
// the clean child environment. Orchtopus never updates Claude Code; an old or
// missing CLI only blocks session starts with a message.
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { compareVersions, MIN_CLAUDE_VERSION } from '../../shared/claude-version';
import { cleanEnv } from '../child-env';

export { compareVersions, MIN_CLAUDE_VERSION };

export interface ClaudeCommand {
  command: string;
  prefixArgs: readonly string[];
}

export interface ClaudeResult {
  /** Exit code, or null when the process was killed (timeout). */
  code: number | null;
  stdout: string;
  stderr: string;
}

export const CLAUDE_COMMAND_ENV = 'ORCHTOPUS_CLAUDE_COMMAND';
const VERSION_TIMEOUT_MS = 10_000;

export class ClaudeSpawnError extends Error {
  constructor(readonly command: string) {
    super('Claude Code could not be started.');
    this.name = 'ClaudeSpawnError';
  }
}

function parseOverride(raw: string): ClaudeCommand {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = null;
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((v): v is string => typeof v === 'string') ||
    value[0] === ''
  ) {
    throw new Error(`${CLAUDE_COMMAND_ENV} must be a JSON array [command, ...args].`);
  }
  const [command = '', ...prefixArgs] = value;
  return { command, prefixArgs };
}

/** Lines printed by `where claude`; empty when nothing is found. */
export function whereClaude(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'where',
      ['claude'],
      { env: cleanEnv(), windowsHide: true, timeout: VERSION_TIMEOUT_MS, encoding: 'utf8' },
      (error, stdout) => {
        resolve(error === null ? stdout.split(/\r?\n/) : []);
      },
    );
  });
}

export async function resolveClaudeCommand(input: {
  env: NodeJS.ProcessEnv;
  packaged: boolean;
  where: () => Promise<string[]>;
}): Promise<ClaudeCommand | null> {
  const override = input.env[CLAUDE_COMMAND_ENV];
  if (!input.packaged && override !== undefined && override !== '') {
    return parseOverride(override);
  }
  const exe = (await input.where())
    .map((line) => line.trim())
    .find((line) => line.toLowerCase().endsWith('.exe'));
  return exe === undefined ? null : { command: exe, prefixArgs: [] };
}

export function runClaude(
  cmd: ClaudeCommand,
  args: readonly string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd.command,
      [...cmd.prefixArgs, ...args],
      {
        cwd: opts.cwd,
        env: cleanEnv(),
        timeout: opts.timeoutMs,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
        } else if (typeof error.code === 'number') {
          resolve({ code: error.code, stdout, stderr });
        } else if (typeof error.code !== 'string' && (error.killed || error.signal != null)) {
          resolve({ code: null, stdout, stderr });
        } else {
          reject(new ClaudeSpawnError(cmd.command));
        }
      },
    );
  });
}

/** The leading `x.y.z` of `claude --version` output, or null. */
export function parseClaudeVersion(stdout: string): string | null {
  return /^(\d+\.\d+\.\d+)/.exec(stdout.trim())?.[1] ?? null;
}

export async function readClaudeVersion(
  cmd: ClaudeCommand,
): Promise<{ version: string | null; supported: boolean }> {
  let version: string | null = null;
  try {
    const res = await runClaude(cmd, ['--version'], {
      cwd: homedir(),
      timeoutMs: VERSION_TIMEOUT_MS,
    });
    if (res.code === 0) version = parseClaudeVersion(res.stdout);
  } catch {
    version = null;
  }
  return {
    version,
    supported: version !== null && compareVersions(version, MIN_CLAUDE_VERSION) >= 0,
  };
}
