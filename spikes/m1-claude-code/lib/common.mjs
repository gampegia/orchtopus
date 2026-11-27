// Shared helpers for the M1 spike harness: scratch paths, a clean child
// environment, JSON-lines logging and a thin wrapper around the `claude` CLI.
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HARNESS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ROOT = process.env.ORCH_SPIKE_ROOT ?? join(tmpdir(), 'orchtopus-spike');

export const paths = {
  root: ROOT,
  repo: join(ROOT, 'acme-app'),
  remote: join(ROOT, 'remote.git'),
  config: join(ROOT, 'config'),
  settings: join(ROOT, 'config', 'settings'),
  plugin: join(ROOT, 'config', 'plugin', 'orch-spike'),
  policy: join(ROOT, 'config', 'policy.json'),
  releases: join(ROOT, 'config', 'releases.json'),
  token: join(ROOT, 'config', 'token.txt'),
  systemPrompt: join(ROOT, 'config', 'system-prompt.md'),
  agents: join(ROOT, 'config', 'agents.json'),
  logs: join(ROOT, 'logs'),
  screens: join(ROOT, 'logs', 'pty'),
  started: join(ROOT, 'logs', 'started.jsonl'),
};

export const RECEIVER_PORT = Number(process.env.ORCH_SPIKE_PORT ?? 47613);

/** Forward slashes, so paths survive Git Bash and JSON alike. */
export const fwd = (p) => p.replaceAll('\\', '/');

export function ensureDir(p) {
  mkdirSync(p, { recursive: true });
  return p;
}

export function appendJsonl(file, record) {
  ensureDir(dirname(file));
  appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n');
}

export function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Like readJson, but tells the caller whether the file was read and parsed. */
export function readJsonStrict(file) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, 'utf8')) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function writeJson(file, value) {
  ensureDir(dirname(file));
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

/**
 * Writes JSON to a temp file next to `file`, then renames it over `file`, so
 * a reader never sees a half-written file. On Windows the rename fails with
 * EPERM or EBUSY while another process has the target open; retry briefly.
 */
export function writeJsonAtomic(file, value) {
  ensureDir(dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (err) {
      if (attempt >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
        rmSync(tmp, { force: true });
        throw err;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

/**
 * The environment for child `claude` processes. The spike may run inside a
 * Claude Code session, whose variables would change how the child behaves.
 */
export function cleanEnv(extra = {}) {
  const drop = (key) =>
    key === 'CLAUDECODE' ||
    key === 'CLAUDE_PID' ||
    key === 'ELECTRON_RUN_AS_NODE' ||
    key === 'ANTHROPIC_BASE_URL' ||
    key.startsWith('CLAUDE_CODE_') ||
    key.startsWith('CLAUDE_AGENT_SDK_') ||
    key.startsWith('CLAUDE_PREVIEW_');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !drop(k)));
  return { ...env, ...extra };
}

let claudePath;
/** Absolute path of the installed `claude` executable (node-pty needs one). */
export function claudeExe() {
  if (claudePath) return claudePath;
  const probe = spawnSync('where', ['claude'], { encoding: 'utf8', shell: false });
  const first = probe.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.toLowerCase().endsWith('.exe'));
  claudePath = first ?? 'claude';
  return claudePath;
}

/** Runs `claude <args>` to completion with the clean environment. */
export function claude(args, { cwd = paths.repo, input, timeoutMs = 120_000, env = {} } = {}) {
  const started = Date.now();
  const res = spawnSync(claudeExe(), args, {
    cwd,
    env: cleanEnv(env),
    encoding: 'utf8',
    input,
    timeout: timeoutMs,
    windowsHide: true,
  });
  return {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    error: res.error?.message,
    ms: Date.now() - started,
  };
}

/** `claude agents --json --all`, scoped to the scratch test repo. */
export function listOwnAgents() {
  const res = claude(['agents', '--json', '--all', '--cwd', paths.repo]);
  try {
    return JSON.parse(res.stdout);
  } catch {
    return { error: res.stderr || res.error || res.stdout };
  }
}

/** Ids of background sessions this harness started (see bg.mjs). */
export function startedIds() {
  return [...new Set(readJsonl(paths.started).map((r) => r.id))];
}

/** Replaces private parts of strings before they go into findings. */
export function scrub(text) {
  return String(text)
    .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/"\s]+/gi, '%USERPROFILE%')
    .replace(/\/c\/Users\/[^/"\s]+/gi, '%USERPROFILE%');
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      out['--'] = argv.slice(i + 1);
      break;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
