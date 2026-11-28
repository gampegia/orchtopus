#!/usr/bin/env node
// Fake `claude` CLI for tests and CI (no Claude Code login there). It answers
// the commands Orchtopus uses with scripted background sessions:
//   --version | --bg [flags] [prompt] | --bg --resume <uuid> | agents --json
//   [--all] [--cwd p] | attach <id> | stop <id> | rm <id> | (no args: trust
//   prompt) | --fake-cleanup | --fake-release <name> <gate>
// Run it as `node tooling/fake-claude/cli.mjs <args>`. State lives in
// $ORCH_FAKE_CLAUDE_HOME (default $CLAUDE_CONFIG_DIR/fake); the scenario
// comes from $ORCH_FAKE_SCENARIOS (a JSON object from session name to
// scenario), else $ORCH_FAKE_SCENARIO, else basic. A scenario step
// {"gate":"<gate>"} waits until `--fake-release <name> <gate>` is run.
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FAKE_VERSION,
  FakeError,
  PROMPT_BOX,
  TAKEOVER_TEXT,
  configDir,
  fakeHome,
  findSession,
  gateFile,
  isAlive,
  isTrusted,
  listSessions,
  logFile,
  normalizeDir,
  pipeName,
  ranFile,
  readLines,
  sessionFile,
  sessionsDir,
  writeSession,
  writeTrust,
} from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, 'worker.mjs');
const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 3_000;
const PROMPT_BOX_DELAY_MS = 300;

const BG_FLAGS = {
  '--settings': 'settings',
  '--append-system-prompt-file': 'appendSystemPromptFile',
  '--permission-mode': 'permissionMode',
  '--name': 'name',
  '--model': 'model',
  '--effort': 'effort',
  '--resume': 'resume',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function out(text) {
  return new Promise((resolve) => process.stdout.write(text, () => resolve()));
}

function parseBgArgs(args) {
  const flags = {};
  const prompt = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--bg') continue;
    if (arg.startsWith('--')) {
      const key = BG_FLAGS[arg];
      if (key === undefined) throw new FakeError(`error: unknown option '${arg}'`);
      const value = args[i + 1];
      if (value === undefined) throw new FakeError(`error: option '${arg}' needs a value`);
      flags[key] = value;
      i += 1;
    } else {
      prompt.push(arg);
    }
  }
  return { flags, prompt: prompt.join(' ') };
}

function scenarioName(sessionName) {
  const map = process.env.ORCH_FAKE_SCENARIOS?.trim();
  if (map) {
    let parsed;
    try {
      parsed = JSON.parse(map);
    } catch {
      throw new FakeError('fake claude: ORCH_FAKE_SCENARIOS is not JSON', 2);
    }
    const byName = parsed?.[sessionName];
    if (typeof byName === 'string') return byName;
  }
  return process.env.ORCH_FAKE_SCENARIO?.trim() || 'basic';
}

function loadScenario(sessionName) {
  const name = scenarioName(sessionName);
  if (!/^[a-z0-9-]+$/.test(name)) throw new FakeError(`fake claude: bad scenario '${name}'`, 2);
  try {
    return JSON.parse(fs.readFileSync(path.join(HERE, 'scenarios', `${name}.json`), 'utf8'));
  } catch {
    throw new FakeError(`fake claude: unknown scenario '${name}'`, 2);
  }
}

async function startWorker(home, init) {
  fs.mkdirSync(path.dirname(sessionFile(home, init.id)), { recursive: true });
  const encoded = Buffer.from(JSON.stringify(init), 'utf8').toString('base64');
  const child = spawn(process.execPath, [WORKER, home, encoded], {
    cwd: init.cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  let exited = false;
  child.on('exit', () => (exited = true));
  child.unref();
  const until = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < until && !exited) {
    if (findSession(home, init.id)?.pid === child.pid) return;
    await sleep(25);
  }
  throw new FakeError('fake claude: the background worker did not start.');
}

async function bg(args) {
  const home = fakeHome();
  const cfg = configDir();
  const { flags, prompt } = parseBgArgs(args);
  let init;
  if (flags.resume !== undefined) {
    const saved = findSession(home, flags.resume);
    if (saved === null) {
      throw new FakeError(`No conversation found with session ID: ${flags.resume}`);
    }
    if (isAlive(saved.pid)) {
      throw new FakeError(`Session ${saved.id} is already running in the background.`);
    }
    const given = { ...flags };
    delete given.resume;
    const options = { ...saved.options, ...given };
    init = {
      id: saved.id,
      sessionId: saved.sessionId,
      cwd: saved.cwd,
      name: options.name ?? saved.name,
      options,
      prompt,
      source: 'resume',
      scenario: { steps: [] },
      scenarioPlayed: true,
    };
  } else {
    const sessionId = randomUUID();
    const cwd = process.cwd();
    const name = flags.name ?? path.basename(cwd);
    init = {
      id: sessionId.slice(0, 8),
      sessionId,
      cwd,
      name,
      options: flags,
      prompt,
      source: 'startup',
      scenario: loadScenario(name),
      scenarioPlayed: false,
    };
  }
  if (!isTrusted(cfg, init.cwd)) {
    throw new FakeError(
      'Workspace not trusted. Run claude in this folder once and accept the trust dialog.',
    );
  }
  await startWorker(home, init);
  const idle = prompt === '' ? ' (idle — send a prompt to start)' : '';
  await out(`backgrounded · ${init.id} · ${init.name}${idle}\n`);
}

function agents(args) {
  const home = fakeHome();
  if (!args.includes('--json')) throw new FakeError('fake claude: only agents --json exists.', 2);
  const all = args.includes('--all');
  const cwdIndex = args.indexOf('--cwd');
  const base = cwdIndex === -1 ? null : normalizeDir(path.resolve(args[cwdIndex + 1] ?? ''));
  const entries = [];
  for (const r of listSessions(home)) {
    const alive = isAlive(r.pid);
    const state = !alive && r.state === 'working' ? 'failed' : r.state;
    if (!all && (state === 'done' || state === 'stopped')) continue;
    if (base !== null) {
      const cwd = normalizeDir(r.cwd).toLowerCase();
      const b = base.toLowerCase();
      if (cwd !== b && !cwd.startsWith(`${b}/`)) continue;
    }
    entries.push({
      pid: r.pid,
      id: r.id,
      cwd: r.cwd,
      kind: r.kind,
      startedAt: r.startedAt,
      sessionId: r.sessionId,
      name: r.name,
      ...(alive && r.status ? { status: r.status } : {}),
      state,
      ...(r.waitingFor ? { waitingFor: r.waitingFor } : {}),
    });
  }
  return out(`${JSON.stringify(entries, null, 2)}\n`);
}

function requireSession(home, id) {
  const record = id === undefined ? null : findSession(home, id);
  if (record === null) throw new FakeError(`No session found with ID: ${id ?? ''}`);
  return record;
}

function attach(id) {
  const home = fakeHome();
  const record = requireSession(home, id);
  if (!isAlive(record.pid)) throw new FakeError(`Session ${record.id} is not running.`);
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipeName(home, record.id));
    let takenOver = false;
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ t: 'attach' })}\n`);
      setTimeout(() => process.stdout.write(`${PROMPT_BOX}\r\n`), PROMPT_BOX_DELAY_MS);
      readLines(
        (line) => socket.write(`${JSON.stringify({ t: 'in', line })}\n`),
        () => {
          socket.destroy();
          resolve();
        },
      );
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const message = JSON.parse(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        if (message.t === 'out') process.stdout.write(message.d);
        if (message.t === 'takeover') takenOver = true;
      }
    });
    socket.on('error', (error) => reject(new FakeError(`fake claude: attach failed: ${error}`)));
    socket.on('close', () => {
      if (takenOver) {
        void out(`\r\n${TAKEOVER_TEXT}\r\n`).then(resolve);
      } else {
        void out('\r\nSession ended.\r\n').then(resolve);
      }
    });
  });
}

/** Asks the worker to end (SessionEnd hooks run), then kills it if it is still there. */
async function endWorker(home, record) {
  if (!isAlive(record.pid)) return;
  await new Promise((resolve) => {
    const socket = net.connect(pipeName(home, record.id));
    const timer = setTimeout(() => socket.destroy(), STOP_TIMEOUT_MS);
    socket.on('connect', () => socket.write(`${JSON.stringify({ t: 'stop' })}\n`));
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  const until = Date.now() + STOP_TIMEOUT_MS;
  while (isAlive(record.pid) && Date.now() < until) await sleep(25);
  if (isAlive(record.pid)) {
    try {
      process.kill(record.pid);
    } catch {
      // Already gone.
    }
    const killUntil = Date.now() + STOP_TIMEOUT_MS;
    while (isAlive(record.pid) && Date.now() < killUntil) await sleep(25);
    if (isAlive(record.pid)) {
      throw new FakeError(`fake claude: session ${record.id} (pid ${record.pid}) did not end.`);
    }
  }
}

async function stop(id) {
  const home = fakeHome();
  const record = requireSession(home, id);
  await endWorker(home, record);
  const latest = findSession(home, record.id) ?? record;
  const done = { ...latest, state: 'done', waitingFor: null };
  delete done.status;
  writeSession(home, done);
  await out(`stopped · ${record.id}\n`);
}

async function rm(id) {
  const home = fakeHome();
  const record = requireSession(home, id);
  await endWorker(home, record);
  fs.rmSync(sessionFile(home, record.id), { force: true });
  fs.rmSync(logFile(home, record.id), { force: true });
  fs.rmSync(ranFile(home, record.id), { force: true });
  await out(`removed · ${record.id}\n`);
}

/** Kills every live worker, then removes the fake's session and gate folders. */
async function cleanup() {
  const home = fakeHome();
  for (const record of listSessions(home)) {
    if (!isAlive(record.pid)) continue;
    try {
      process.kill(record.pid);
    } catch {
      // Already gone.
    }
    const until = Date.now() + STOP_TIMEOUT_MS;
    while (isAlive(record.pid) && Date.now() < until) await sleep(25);
  }
  // Only the fake's own folders: $ORCH_FAKE_CLAUDE_HOME may point anywhere.
  for (const dir of [sessionsDir(home), path.join(home, 'gates')]) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  try {
    fs.rmdirSync(home);
  } catch {
    // Missing, or holds other files: leave it.
  }
}

/** Plain `claude` in a folder: the trust dialog, then a prompt box until `/exit`. */
function interactive() {
  const cfg = configDir();
  const cwd = process.cwd();
  let trusted = isTrusted(cfg, cwd);
  const select = loadScenario(path.basename(cwd)).trustDialog === 'select';
  if (trusted) {
    process.stdout.write(`${PROMPT_BOX}\r\n`);
  } else {
    process.stdout.write('Do you trust the files in this folder? 1. Yes 2. No\r\n');
  }
  return new Promise((resolve, reject) => {
    readLines(
      (raw) => {
        const line = raw.trim();
        if (!trusted) {
          // In a select list (like the real CLI) typed text is ignored and Enter confirms
          // the focused 'Yes, proceed'; otherwise only '1' accepts.
          if (line === '1' || (select && line !== '2')) {
            writeTrust(cfg, cwd);
            trusted = true;
            process.stdout.write(`${PROMPT_BOX}\r\n`);
          } else if (line === '2') {
            reject(new FakeError('Trust not accepted.'));
          }
          return;
        }
        if (line === '/exit') {
          resolve();
        } else if (line !== '') {
          process.stdout.write(`> ${line}\r\nfake reply: ${line}\r\n`);
        }
      },
      () => resolve(),
    );
  });
}

function release(name, gate) {
  const file = gateFile(fakeHome(), name, gate);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
}

async function main(args) {
  const [first, second, third] = args;
  if (args.includes('--version') || args.includes('-v')) {
    await out(`${FAKE_VERSION} (Claude Code)\n`);
  } else if (first === '--fake-cleanup') {
    await cleanup();
  } else if (first === '--fake-release') {
    release(second, third);
  } else if (first === 'agents') {
    await agents(args.slice(1));
  } else if (first === 'attach') {
    await attach(second);
  } else if (first === 'stop') {
    await stop(second);
  } else if (first === 'rm') {
    await rm(second);
  } else if (args.includes('--bg')) {
    await bg(args);
  } else if (args.length === 0) {
    await interactive();
  } else {
    throw new FakeError(`fake claude: unsupported arguments: ${args.join(' ')}`, 2);
  }
}

main(process.argv.slice(2)).then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`${error instanceof FakeError ? error.message : error?.stack}\n`);
    process.exit(error instanceof FakeError ? error.exitCode : 1);
  },
);
