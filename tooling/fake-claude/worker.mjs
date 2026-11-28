// One fake background session. Started detached by `cli.mjs --bg`; it owns
// its session file, plays the scenario, runs the command hooks from the
// settings file like Claude Code does, and serves attach clients on a pipe.
//
// Pipe protocol (JSON lines): worker → client {t:'out',d} and {t:'takeover'};
// client → worker {t:'attach'} (first message of an attach client),
// {t:'in',line} and {t:'stop'} (a control connection from `cli.mjs stop`).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { gateFile, logFile, pipeName, ranFile, writeSession } from './store.mjs';

const [home, encoded] = process.argv.slice(2);
const init = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
const { options } = init;
const log = logFile(home, init.id);

const record = {
  id: init.id,
  sessionId: init.sessionId,
  cwd: init.cwd,
  kind: 'background',
  startedAt: new Date().toISOString(),
  name: init.name,
  state: init.prompt ? 'working' : 'blocked',
  status: init.prompt ? 'busy' : undefined,
  waitingFor: null,
  pid: process.pid,
  options,
};

let client = null;
let scenarioPlayed = init.scenarioPlayed;
let queue = Promise.resolve();

function save() {
  writeSession(home, record);
}

function setState(state, status, waitingFor = null) {
  record.state = state;
  record.status = status ?? undefined;
  record.waitingFor = waitingFor;
  save();
}

function emit(text) {
  fs.appendFileSync(log, text);
  client?.write(`${JSON.stringify({ t: 'out', d: text })}\n`);
}

function fail(error) {
  try {
    fs.appendFileSync(log, `\r\nfake worker error: ${error?.stack ?? error}\r\n`);
    setState('failed', undefined);
  } finally {
    process.exit(1);
  }
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

function readSettings() {
  if (!options.settings) return {};
  try {
    return JSON.parse(fs.readFileSync(options.settings, 'utf8'));
  } catch {
    return {};
  }
}

function permissionMode() {
  return !options.permissionMode || options.permissionMode === 'manual'
    ? 'default'
    : options.permissionMode;
}

const MATCH_FIELD = {
  PreToolUse: 'tool_name',
  PostToolUse: 'tool_name',
  PermissionRequest: 'tool_name',
  SessionStart: 'source',
  SessionEnd: 'reason',
  Notification: 'notification_type',
};

function matches(matcher, value) {
  if (matcher === undefined || matcher === '' || matcher === '*') return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(value ?? '');
  } catch {
    return matcher === value;
  }
}

/** Runs one command hook: exec form when `args` is given, else through a shell. */
function runCommand(hook, input) {
  return new Promise((resolve) => {
    const opts = {
      cwd: record.cwd,
      env: { ...process.env, CLAUDE_PROJECT_DIR: record.cwd },
      windowsHide: true,
    };
    let child;
    try {
      child = Array.isArray(hook.args)
        ? spawn(hook.command, hook.args, opts)
        : spawn(hook.command, { ...opts, shell: true });
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: String(error) });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), (hook.timeout ?? 60) * 1000);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.stdin.on('error', () => {});
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(error) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(JSON.stringify(input));
  });
}

/** Shows a hook's deny or block in the output; true when it stops the tool call. */
function report(event, hook, result) {
  let decision;
  try {
    decision = JSON.parse(result.stdout)?.hookSpecificOutput ?? null;
  } catch {
    decision = null;
  }
  if (decision?.permissionDecision === 'deny') {
    emit(`  ⎿  ${event} hook denied this tool: ${decision.permissionDecisionReason ?? ''}\r\n`);
    return true;
  }
  if (result.code === 2) {
    emit(`  ⎿  ${event} hook blocked: ${result.stderr.trim()}\r\n`);
    return true;
  }
  if (result.code !== 0 && hook.onFailure === 'block') {
    emit(`  ⎿  ${event} hook failed and blocked the tool\r\n`);
    return true;
  }
  return false;
}

/**
 * Runs every matching command hook; waits for sync hooks, not for async ones. True when a sync
 * hook denied or blocked.
 */
async function runHooks(event, payload = {}) {
  const groups = readSettings().hooks?.[event];
  if (!Array.isArray(groups)) return;
  const input = {
    session_id: record.sessionId,
    transcript_path: path.join(path.dirname(log), `${record.id}.jsonl`),
    cwd: record.cwd,
    permission_mode: permissionMode(),
    hook_event_name: event,
    ...payload,
  };
  const waits = [];
  for (const group of groups) {
    if (!matches(group?.matcher, payload[MATCH_FIELD[event]])) continue;
    for (const hook of group.hooks ?? []) {
      if (hook?.type !== 'command' || typeof hook.command !== 'string') continue;
      const run = runCommand(hook, input);
      if (hook.async !== true) waits.push(run.then((result) => report(event, hook, result)));
    }
  }
  return (await Promise.all(waits)).some(Boolean);
}

async function runStatusLine(contextPct) {
  const command = readSettings().statusLine?.command;
  if (typeof command !== 'string') return;
  await runCommand(
    { command, timeout: 5 },
    {
      session_id: record.sessionId,
      cwd: record.cwd,
      version: '2.1.332',
      model: { id: options.model ?? 'fake-model', display_name: options.model ?? 'Fake' },
      workspace: { current_dir: record.cwd },
      context_window: { used_percentage: contextPct ?? null },
    },
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A tool call: PreToolUse hooks decide; an allowed call is recorded as run, then PostToolUse. */
async function toolCall({ tool_name, tool_input, tool_response }) {
  if (await runHooks('PreToolUse', { tool_name, tool_input })) return;
  fs.appendFileSync(ranFile(home, record.id), `${JSON.stringify({ tool_name, tool_input })}\n`);
  await runHooks('PostToolUse', { tool_name, tool_input, tool_response: tool_response ?? {} });
}

/** Waits until `cli.mjs --fake-release <name> <gate>` creates the gate file. */
async function waitForGate(gate) {
  const file = gateFile(home, record.name, gate);
  while (!fs.existsSync(file)) await sleep(50);
}

async function playScenario() {
  scenarioPlayed = true;
  const start = Date.now();
  const steps = [...(init.scenario.steps ?? [])].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  for (const step of steps) {
    await sleep(Math.max(0, start + (step.at ?? 0) - Date.now()));
    if (step.gate !== undefined) await waitForGate(step.gate);
    if (step.state !== undefined) setState(step.state, step.status, step.waitingFor ?? null);
    if (step.output !== undefined) emit(step.output);
    if (step.hook !== undefined) await runHooks(step.hook.event, step.hook.payload ?? {});
    if (step.toolCall !== undefined) await toolCall(step.toolCall);
    if (step.statusline !== undefined) await runStatusLine(step.statusline.contextPct);
  }
}

/** One turn: the first prompt plays the scenario, later ones get an echo reply. */
async function turn(prompt, typed) {
  setState('working', 'busy');
  if (typed) emit(`> ${prompt}\r\n`);
  await runHooks('UserPromptSubmit', { prompt });
  if (typed) emit(`fake reply: ${prompt}\r\n`);
  if (!scenarioPlayed) {
    await playScenario();
    return;
  }
  await runHooks('Stop', {
    stop_hook_active: false,
    last_assistant_message: typed ? `fake reply: ${prompt}` : '',
  });
  setState('done', 'idle');
}

function enqueue(job) {
  queue = queue.then(job, job);
  return queue;
}

async function stop() {
  await runHooks('SessionEnd', { reason: 'other' });
  setState('done', undefined);
  client?.end();
  process.exit(0);
}

/** A newer attach takes the session over: the older client is told and closed. */
function attachClient(socket) {
  if (client !== null && client !== socket) {
    client.end(`${JSON.stringify({ t: 'takeover' })}\n`);
  }
  client = socket;
  let history;
  try {
    history = fs.readFileSync(log, 'utf8');
  } catch {
    history = '';
  }
  socket.write(`${JSON.stringify({ t: 'out', d: history })}\n`);
}

const server = net.createServer((socket) => {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.t === 'attach') {
        attachClient(socket);
      } else if (message.t === 'in' && typeof message.line === 'string' && client === socket) {
        void enqueue(() => turn(message.line, true));
      } else if (message.t === 'stop') {
        void enqueue(stop);
      }
    }
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    if (client === socket) client = null;
  });
});

server.listen(pipeName(home, init.id), () => {
  fs.appendFileSync(log, '');
  save();
  void enqueue(async () => {
    await runHooks('SessionStart', { source: init.source, model: options.model ?? 'fake-model' });
    if (init.prompt) {
      await turn(init.prompt, false);
    } else {
      setState('blocked', 'idle');
    }
  });
});
