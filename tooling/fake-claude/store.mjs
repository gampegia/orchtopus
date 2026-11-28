// Shared state of the fake claude CLI: where it lives, session files, trust
// and liveness. Plain ESM, Node built-ins only.
import fs from 'node:fs';
import path from 'node:path';

export const FAKE_VERSION = '2.1.332';
export const PROMPT_BOX = '╭─ fake prompt ─╮';
export const TAKEOVER_TEXT = 'Session opened in another window';

export class FakeError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

/** `$CLAUDE_CONFIG_DIR`. Required, so the fake never touches the user's real files. */
export function configDir(env = process.env) {
  const dir = env.CLAUDE_CONFIG_DIR?.trim();
  if (!dir) throw new FakeError('fake claude needs CLAUDE_CONFIG_DIR to be set.', 2);
  return dir;
}

/** `$ORCH_FAKE_CLAUDE_HOME`, default `$CLAUDE_CONFIG_DIR/fake`. */
export function fakeHome(env = process.env) {
  const home = env.ORCH_FAKE_CLAUDE_HOME?.trim();
  return home || path.join(configDir(env), 'fake');
}

export function sessionsDir(home) {
  return path.join(home, 'sessions');
}

export function sessionFile(home, id) {
  return path.join(sessionsDir(home), `${id}.json`);
}

export function logFile(home, id) {
  return path.join(sessionsDir(home), `${id}.log`);
}

/** JSON lines of the tool calls a session ran (a call denied by a PreToolUse hook is not run). */
export function ranFile(home, id) {
  return path.join(sessionsDir(home), `${id}.ran.jsonl`);
}

/** The file that releases a `gate` step of the session with this name (`--fake-release`). */
export function gateFile(home, name, gate) {
  for (const part of [name, gate]) {
    if (typeof part !== 'string' || !/^[A-Za-z0-9._-]+$/.test(part) || part.includes('..')) {
      throw new FakeError(`fake claude: bad gate name '${String(part)}'`, 2);
    }
  }
  return path.join(home, 'gates', `${name}.${gate}`);
}

export function pipeName(home, id) {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\orch-fake-${id}`
    : path.join(sessionsDir(home), `${id}.sock`);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Atomic replace (temp file and rename), retried while Windows holds the target. */
export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (error) {
      if (attempt >= 20) throw error;
      sleepSync(25);
    }
  }
}

function readJson(file) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT' || attempt >= 5) throw error;
      sleepSync(20);
    }
  }
}

export function writeSession(home, record) {
  writeJsonAtomic(sessionFile(home, record.id), record);
}

export function listSessions(home) {
  let names;
  try {
    names = fs.readdirSync(sessionsDir(home));
  } catch {
    return [];
  }
  const records = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    try {
      records.push(readJson(path.join(sessionsDir(home), name)));
    } catch {
      // A file removed between readdir and read.
    }
  }
  return records;
}

/** The session with this short id or full session id, or null. */
export function findSession(home, idOrUuid) {
  return listSessions(home).find((r) => r.id === idOrUuid || r.sessionId === idOrUuid) ?? null;
}

export function isAlive(pid) {
  if (typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function normalizeDir(dir) {
  return dir.replace(/\\/g, '/').replace(/\/+$/, '');
}

function readConfig(dir) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(dir, '.claude.json'), 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function projectEntry(projects, dir) {
  const key = normalizeDir(dir);
  if (Object.hasOwn(projects, key)) return projects[key];
  const lower = key.toLowerCase();
  const match = Object.keys(projects).find((k) => normalizeDir(k).toLowerCase() === lower);
  return match === undefined ? undefined : projects[match];
}

/** Trusted when the folder or one of its parents has `hasTrustDialogAccepted: true`. */
export function isTrusted(cfgDir, cwd) {
  const projects = readConfig(cfgDir).projects;
  if (typeof projects !== 'object' || projects === null) return false;
  let dir = path.resolve(cwd);
  for (;;) {
    if (projectEntry(projects, dir)?.hasTrustDialogAccepted === true) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** Accepts the trust dialog for `cwd`, keeping every other key of the file. */
export function writeTrust(cfgDir, cwd) {
  const config = readConfig(cfgDir);
  const projects =
    typeof config.projects === 'object' && config.projects !== null ? config.projects : {};
  const key = normalizeDir(path.resolve(cwd));
  projects[key] = { ...(projects[key] ?? {}), hasTrustDialogAccepted: true };
  config.projects = projects;
  writeJsonAtomic(path.join(cfgDir, '.claude.json'), config);
}

/**
 * Calls `onLine` for every line typed on stdin. In a TTY (an attach PTY) it
 * reads raw keys and echoes them like a TUI; Ctrl+C calls `onInterrupt`.
 */
export function readLines(onLine, onInterrupt) {
  const stdin = process.stdin;
  stdin.setEncoding('utf8');
  if (stdin.isTTY) {
    stdin.setRawMode(true);
    let buffer = '';
    stdin.on('data', (chunk) => {
      for (const ch of chunk) {
        if (ch === '\u0003') {
          onInterrupt();
        } else if (ch === '\r' || ch === '\n') {
          process.stdout.write('\r\n');
          const line = buffer;
          buffer = '';
          onLine(line);
        } else if (ch === '\u007f' || ch === '\b') {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (ch >= ' ') {
          buffer += ch;
          process.stdout.write(ch);
        }
      }
    });
  } else {
    let buffer = '';
    stdin.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.search(/\r?\n/)) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(buffer[index] === '\r' ? index + 2 : index + 1);
        onLine(line);
      }
    });
  }
}
