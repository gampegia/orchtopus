// The hook helper: one small command behind every Orchtopus hook and the status line (spec
// section 5). Bundled to out/main/hook-helper.js and copied to <data>\bin\ by the app; the
// launcher there runs it with the Orchtopus executable in Node mode.
//
//   hook-helper.js state        state hooks (SessionStart, Stop, …): always exit 0, no output
//   hook-helper.js statusline   prints `ctx <n> %` or `ctx unknown`, then sends the envelope
//   hook-helper.js pr-block     PreToolUse on shell tools: denies PR and MR create or merge
//
// It reads the port and the token at each call, posts the envelope with a 500 ms timeout and
// appends it to the spool when that fails. It imports only Node built-ins, the envelope module
// and the PR block matcher, so it starts fast and never needs the app to be running.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import {
  envelopeValue,
  HOOK_FIELDS,
  HOOK_PATTERN,
  isRecord,
  isShortString,
  MAX_CWD_LENGTH,
  MAX_HOOK_LENGTH,
  MAX_SESSION_ID_LENGTH,
  type EnvelopeMode,
  type EnvelopeValue,
  type HookEnvelope,
} from '../shared/hook-envelope';
import { detectPrCommand, PR_BLOCK_REASON } from '../shared/pr-block';
import { appendToSpool } from './spool-append';

export const POST_TIMEOUT_MS = 500;
export const HOOK_EVENTS_PATH = '/v1/hooks/events';

/** File names inside the data folder; a test keeps them equal to src/main/data-folder.ts. */
export const HELPER_FILES = {
  apiFile: 'api.json',
  tokenFile: 'api-token',
  spoolFile: join('spool', 'events.jsonl'),
} as const;

export type PostFn = (
  url: string,
  token: string,
  body: string,
  timeoutMs: number,
) => Promise<number>;

export interface HelperIo {
  argv: string[];
  stdin: string;
  dataDir: string;
  now: () => Date;
  post: PostFn;
  /**
   * Prints the status text at once, before the POST. When given, the result's stdout is
   * empty, so a hanging API never holds the status line back.
   */
  write?: (text: string) => void;
}

export interface HelperResult {
  exitCode: number;
  stdout: string;
  /** Only the PR block sets it, when it blocks a command it cannot read. */
  stderr?: string;
}

const MODES: Readonly<Record<string, EnvelopeMode>> = { state: 'hook', statusline: 'statusline' };

function parseInput(stdin: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(stdin);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function child(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function shortString(value: unknown, max: number): string | null {
  return isShortString(value, max) ? value : null;
}

function put(fields: Record<string, EnvelopeValue>, key: string, raw: unknown): void {
  if (raw === undefined) return;
  const value = envelopeValue(raw);
  if (value !== undefined) fields[key] = value;
}

function hookFields(input: Record<string, unknown>): Record<string, EnvelopeValue> {
  const fields: Record<string, EnvelopeValue> = {};
  for (const key of HOOK_FIELDS) put(fields, key, input[key]);
  return fields;
}

function statuslineFields(input: Record<string, unknown>): Record<string, EnvelopeValue> {
  const fields: Record<string, EnvelopeValue> = {};
  const limits = input['rate_limits'];
  put(fields, 'contextPct', child(input['context_window'], 'used_percentage'));
  put(fields, 'fiveHourPct', child(child(limits, 'five_hour'), 'used_percentage'));
  put(fields, 'fiveHourResetsAt', child(child(limits, 'five_hour'), 'resets_at'));
  put(fields, 'sevenDayPct', child(child(limits, 'seven_day'), 'used_percentage'));
  put(fields, 'sevenDayResetsAt', child(child(limits, 'seven_day'), 'resets_at'));
  put(fields, 'model', child(input['model'], 'id'));
  return fields;
}

function statusText(input: Record<string, unknown> | null): string {
  const pct = child(input?.['context_window'], 'used_percentage');
  return typeof pct === 'number' && Number.isFinite(pct)
    ? `ctx ${String(Math.round(pct))} %`
    : 'ctx unknown';
}

function buildEnvelope(
  mode: EnvelopeMode,
  input: Record<string, unknown>,
  at: Date,
): HookEnvelope | null {
  const hook = mode === 'statusline' ? 'statusline' : input['hook_event_name'];
  if (!isShortString(hook, MAX_HOOK_LENGTH) || !HOOK_PATTERN.test(hook)) return null;
  return {
    v: 1,
    id: randomUUID(),
    at: at.toISOString(),
    mode,
    hook,
    sessionId: shortString(input['session_id'], MAX_SESSION_ID_LENGTH),
    cwd: shortString(input['cwd'], MAX_CWD_LENGTH),
    fields: mode === 'statusline' ? statuslineFields(input) : hookFields(input),
  };
}

/** True when a process with this pid runs. EPERM means it runs under another user. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: unknown }).code === 'EPERM';
  }
}

/**
 * The port and token of the running app, or null when either file is missing or damaged, or
 * when the app that wrote api.json is gone (a crash leaves the file behind, and another
 * program may listen on its port now, so the token is not sent).
 */
function readConnection(dataDir: string): { port: number; token: string } | null {
  try {
    const portFile: unknown = JSON.parse(readFileSync(join(dataDir, HELPER_FILES.apiFile), 'utf8'));
    const port = child(portFile, 'port');
    const pid = child(portFile, 'pid');
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid < 1 || !isProcessAlive(pid)) {
      return null;
    }
    const token = readFileSync(join(dataDir, HELPER_FILES.tokenFile), 'utf8').trim();
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }
    return /^[0-9a-f]{64}$/.test(token) ? { port, token } : null;
  } catch {
    return null;
  }
}

/** Posts the body; true only for a 2xx answer within the timeout. */
async function deliver(io: HelperIo, body: string): Promise<boolean> {
  const connection = readConnection(io.dataDir);
  if (connection === null) return false;
  const url = `http://127.0.0.1:${String(connection.port)}${HOOK_EVENTS_PATH}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<number>((resolve) => {
    timer = setTimeout(() => {
      resolve(0);
    }, POST_TIMEOUT_MS);
  });
  try {
    const status = await Promise.race([
      io.post(url, connection.token, body, POST_TIMEOUT_MS),
      timeout,
    ]);
    return status >= 200 && status < 300;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Exit 2 blocks a PreToolUse call in Claude Code even without `onFailure: "block"`. */
export const PR_BLOCK_FAIL_EXIT = 2;

function denyOutput(): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: PR_BLOCK_REASON,
    },
  });
}

/**
 * The PR block decides locally and never contacts the app. A command it cannot read is
 * blocked (non-zero exit, `onFailure: "block"`), because it cannot rule a PR command out.
 * A match is also spooled with `fields.blocked`, without the command text.
 */
function runPrBlock(io: HelperIo): HelperResult {
  const input = parseInput(io.stdin);
  const command = child(input?.['tool_input'], 'command');
  if (input === null || typeof command !== 'string') {
    return {
      exitCode: PR_BLOCK_FAIL_EXIT,
      stdout: '',
      stderr: 'Orchtopus PR block could not read the shell command, so it blocked it.',
    };
  }
  const match = detectPrCommand(command);
  if (match === null) return { exitCode: 0, stdout: '' };
  try {
    const envelope = buildEnvelope('hook', input, io.now());
    if (envelope !== null) {
      envelope.fields['blocked'] = match.kind;
      appendToSpool(join(io.dataDir, HELPER_FILES.spoolFile), JSON.stringify(envelope));
    }
  } catch {
    // The record is a convenience; the deny below is what matters.
  }
  return { exitCode: 0, stdout: denyOutput() };
}

export async function runHelper(io: HelperIo): Promise<HelperResult> {
  if (io.argv[0] === 'pr-block') {
    try {
      return runPrBlock(io);
    } catch {
      return { exitCode: PR_BLOCK_FAIL_EXIT, stdout: '', stderr: 'Orchtopus PR block failed.' };
    }
  }
  const mode = MODES[io.argv[0] ?? ''];
  if (mode === undefined) return { exitCode: 0, stdout: '' };
  let stdout = '';
  try {
    const input = parseInput(io.stdin);
    if (mode === 'statusline') {
      const text = statusText(input);
      if (io.write === undefined) stdout = text;
      else io.write(text);
    }
    if (input === null) return { exitCode: 0, stdout };
    const envelope = buildEnvelope(mode, input, io.now());
    if (envelope === null) return { exitCode: 0, stdout };
    const body = JSON.stringify(envelope);
    if (!(await deliver(io, body))) {
      appendToSpool(join(io.dataDir, HELPER_FILES.spoolFile), body);
    }
  } catch {
    // A hook of Orchtopus never fails the user's work.
  }
  return { exitCode: 0, stdout };
}

/** The real POST: node:http to 127.0.0.1, destroyed after the timeout. */
export const httpPost: PostFn = (url, token, body, timeoutMs) =>
  new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
        },
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
    req.end(body);
  });

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main(): void {
  runHelper({
    argv: process.argv.slice(2),
    stdin: readStdin(),
    // The helper lives in <data>\bin\, so the data folder is the parent of its own folder.
    dataDir: dirname(__dirname),
    now: () => new Date(),
    post: httpPost,
    write: (text) => {
      process.stdout.write(text);
    },
  })
    .catch(() => ({ exitCode: 0, stdout: '' }))
    .then((result: HelperResult) => {
      if (result.stderr !== undefined) process.stderr.write(result.stderr);
      process.stdout.write(result.stdout, () => {
        process.exit(result.exitCode);
      });
    })
    .catch(() => {
      process.exit(0);
    });
}

// Run only as the bundled entry, never when a test imports this module.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main();
}
