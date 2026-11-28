// The background-session adapter (spec section 4, spike result): `claude --bg` in the worktree,
// the session id from `agents --json`, one app-owned `claude attach` PTY per session. Plain
// spawn, no detached launch (T4 passed). Never `--bare`, `--session-id` or bypassPermissions.
import { homedir } from 'node:os';
import { filterByCwd, listAgents, type AgentEntry } from '../claude/agents';
import { runClaude, type ClaudeCommand, type ClaudeResult } from '../claude/cli';
import {
  AdapterError,
  StartError,
  type AgentAdapter,
  type SessionRef,
  type StartInput,
  type StartedSession,
  type TerminalHandle,
  type TerminalSize,
} from './agent-adapter';
import { openPtyTerminal, type PtySpawn } from './attach-terminal';

export const START_TIMEOUT_MS = 60_000;
export const STOP_TIMEOUT_MS = 30_000;
export const ID_POLL_MS = 500;
export const ID_WAIT_MS = 15_000;

const MODES = new Set(['auto', 'manual']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,127}$/;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;

function checkId(value: string, what: string): string {
  if (!SESSION_ID.test(value)) throw new AdapterError(`Invalid ${what}.`);
  return value;
}

/** A value that must not be read as a flag by the CLI's argument parser. */
function notFlag(value: string, what: string): string {
  if (value === '' || value.startsWith('-')) throw new StartError(`Invalid ${what}.`);
  return value;
}

/** The `--bg` argv in the pinned order; unset optional values are left out. */
export function buildStartArgs(input: StartInput): string[] {
  if (!MODES.has(input.mode)) throw new StartError('Invalid permission mode.');
  if (input.model !== null && !MODEL.test(input.model)) throw new StartError('Invalid model.');
  if (input.effort !== null && !EFFORTS.has(input.effort)) throw new StartError('Invalid effort.');
  const args = [
    '--bg',
    '--settings',
    notFlag(input.settingsFile, 'settings file'),
    '--append-system-prompt-file',
    notFlag(input.systemPromptFile, 'system prompt file'),
  ];
  if (input.agentsJson !== null) args.push('--agents', notFlag(input.agentsJson, 'agents'));
  for (const dir of input.pluginDirs) args.push('--plugin-dir', notFlag(dir, 'plugin folder'));
  if (input.model !== null) args.push('--model', input.model);
  if (input.effort !== null) args.push('--effort', input.effort);
  args.push('--permission-mode', input.mode, '--name', notFlag(input.name, 'name'));
  if (input.prompt !== null && input.prompt.trim() !== '') {
    // A leading space keeps a prompt such as "--help" from being parsed as a flag.
    args.push(input.prompt.startsWith('-') ? ` ${input.prompt}` : input.prompt);
  }
  return args;
}

function firstLine(res: ClaudeResult): string {
  const line = [res.stderr, res.stdout]
    .flatMap((text) => text.split(/\r?\n/))
    .map((l) => l.trim())
    .find((l) => l !== '');
  return line ?? `Claude Code exited with code ${String(res.code)}.`;
}

/** The short id from `backgrounded · <id> · <name>`, or null. */
function printedId(stdout: string): string | null {
  return /backgrounded\s+·\s+(\S+)\s+·/.exec(stdout)?.[1] ?? null;
}

export function createBackgroundAdapter(deps: {
  cmd: ClaudeCommand;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Replaces node-pty in tests. */
  spawnPty?: PtySpawn;
}): AgentAdapter {
  const { cmd, now, sleep } = deps;

  const list = (): Promise<AgentEntry[]> => listAgents(cmd);

  /** The session's folder: given by the caller, else from agents --json, else the home folder. */
  const cwdOf = async (ref: SessionRef): Promise<string> => {
    if (ref.cwd !== undefined && ref.cwd !== '') return ref.cwd;
    try {
      const entry = (await list()).find(
        (e) => e.sessionId === ref.sessionId || e.id === ref.shortId,
      );
      if (entry !== undefined) return entry.cwd;
    } catch {
      // Fall back below; attach and resume find the session by id.
    }
    return homedir();
  };

  const findStarted = async (
    cwd: string,
    since: number,
    shortId: string | null,
  ): Promise<StartedSession | null> => {
    const deadline = now() + ID_WAIT_MS;
    for (;;) {
      let entries: AgentEntry[] = [];
      try {
        entries = filterByCwd(await list(), cwd).filter(
          (e) =>
            e.kind === 'background' &&
            e.sessionId !== null &&
            e.startedAt !== null &&
            e.startedAt >= since,
        );
      } catch {
        // A failed poll is retried until the deadline.
      }
      const match =
        entries.find((e) => e.id === shortId) ??
        [...entries].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
      if (match?.sessionId != null) return { sessionId: match.sessionId, shortId: match.id };
      if (now() >= deadline) return null;
      await sleep(ID_POLL_MS);
    }
  };

  const openTerminal = (args: string[], cwd: string, size: TerminalSize): TerminalHandle =>
    openPtyTerminal({
      file: cmd.command,
      args: [...cmd.prefixArgs, ...args],
      cwd,
      size,
      ...(deps.spawnPty === undefined ? {} : { spawn: deps.spawnPty }),
    });

  return {
    start: async (input) => {
      const args = buildStartArgs(input);
      const since = now();
      let res: ClaudeResult;
      try {
        res = await runClaude(cmd, args, { cwd: input.cwd, timeoutMs: START_TIMEOUT_MS });
      } catch {
        throw new StartError('Claude Code could not be started.');
      }
      if (res.code === null) throw new StartError('Claude Code did not answer in time.');
      if (res.code !== 0) throw new StartError(firstLine(res));
      const started = await findStarted(input.cwd, since, printedId(res.stdout));
      if (started === null) throw new StartError('session id not found');
      return started;
    },

    list,

    resume: async (ref) => {
      const sessionId = checkId(ref.sessionId, 'session id');
      const cwd = await cwdOf(ref);
      let res: ClaudeResult;
      try {
        res = await runClaude(cmd, ['--bg', '--resume', sessionId], {
          cwd,
          timeoutMs: START_TIMEOUT_MS,
        });
      } catch {
        throw new AdapterError('Claude Code could not be started.');
      }
      if (res.code !== 0) throw new AdapterError(firstLine(res));
    },

    stop: async (ref) => {
      const shortId = checkId(ref.shortId, 'short id');
      let res: ClaudeResult;
      try {
        res = await runClaude(cmd, ['stop', shortId], {
          cwd: homedir(),
          timeoutMs: STOP_TIMEOUT_MS,
        });
      } catch {
        throw new AdapterError('Claude Code could not be started.');
      }
      if (res.code !== 0) throw new AdapterError(firstLine(res));
    },

    attach: async (ref, size) => {
      const shortId = checkId(ref.shortId, 'short id');
      return openTerminal(['attach', shortId], await cwdOf(ref), size);
    },

    openPlain: (cwd, size) => Promise.resolve(openTerminal([], cwd, size)),
  };
}
