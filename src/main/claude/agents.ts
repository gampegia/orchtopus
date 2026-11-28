// `claude agents --json --all`: polled once for every project and filtered in
// the app. Any failure (non-JSON, timeout, spawn error, non-zero exit) is an
// AgentsListError, so the caller can keep the last known state.
import { homedir } from 'node:os';
import { runClaude, type ClaudeCommand } from './cli';

export interface AgentEntry {
  id: string;
  sessionId: string | null;
  cwd: string;
  kind: string;
  state: string | null;
  status: string | null;
  waitingFor: string | null;
  name: string | null;
  startedAt: number | null;
  pid: number | null;
}

export type AgentsFailure = 'parse' | 'timeout' | 'spawn' | 'exit';

export const AGENTS_TIMEOUT_MS = 5_000;

export class AgentsListError extends Error {
  override readonly cause: AgentsFailure;

  constructor(cause: AgentsFailure, message: string) {
    super(message);
    this.name = 'AgentsListError';
    this.cause = cause;
  }
}

export class AgentsParseError extends AgentsListError {
  constructor() {
    super('parse', 'Claude Code printed no agent list.');
    this.name = 'AgentsParseError';
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function time(value: unknown): number | null {
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return num(value);
}

function toEntry(raw: unknown): AgentEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const cwd = str(r.cwd);
  if (id === null || id === '' || cwd === null || cwd === '') return null;
  return {
    id,
    sessionId: str(r.sessionId),
    cwd,
    kind: str(r.kind) ?? '',
    state: str(r.state),
    status: str(r.status),
    waitingFor: str(r.waitingFor),
    name: str(r.name),
    startedAt: time(r.startedAt),
    pid: num(r.pid),
  };
}

export function parseAgentsJson(stdout: string): AgentEntry[] {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new AgentsParseError();
  }
  if (!Array.isArray(value)) throw new AgentsParseError();
  return value.map(toEntry).filter((e): e is AgentEntry => e !== null);
}

export async function listAgents(
  cmd: ClaudeCommand,
  opts: { timeoutMs?: number } = {},
): Promise<AgentEntry[]> {
  let res;
  try {
    res = await runClaude(cmd, ['agents', '--json', '--all'], {
      cwd: homedir(),
      timeoutMs: opts.timeoutMs ?? AGENTS_TIMEOUT_MS,
    });
  } catch {
    throw new AgentsListError('spawn', 'Claude Code could not be started.');
  }
  if (res.code === null)
    throw new AgentsListError('timeout', 'Claude Code did not answer in time.');
  if (res.code !== 0) {
    throw new AgentsListError('exit', `Claude Code exited with code ${String(res.code)}.`);
  }
  return parseAgentsJson(res.stdout);
}

function normalizeDir(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Entries whose cwd is `dir` or lies under it (slashes and case normalized). */
export function filterByCwd(entries: readonly AgentEntry[], dir: string): AgentEntry[] {
  const base = normalizeDir(dir);
  return entries.filter((e) => {
    const cwd = normalizeDir(e.cwd);
    return cwd === base || cwd.startsWith(`${base}/`);
  });
}
