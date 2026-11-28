// Stand-in for the Orchtopus hook helper (check T6). Does what the real helper
// will do: read api.json and api-token from the data folder (the parent of
// this file's folder), POST a ~1 KB JSON envelope with a bearer token and a
// 500 ms timeout, on any failure append it to spool\events.jsonl, exit 0.
//
// Usage: <runtime> stand-in-helper.cjs <state|statusline> [--label <l>] [--sleep <ms>]
// Statusline mode prints `ctx <n> %` (or `ctx unknown`) before sending.
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const t0 = Date.now();
const argv = process.argv.slice(2);
const mode = argv[0] === 'statusline' ? 'statusline' : 'state';
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const label = opt('label') ?? mode;
const sleepMs = Number(opt('sleep') ?? 0);
const dataDir = path.dirname(__dirname);
const spoolFile = path.join(dataDir, 'spool', 'events.jsonl');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function spool(line) {
  try {
    fs.mkdirSync(path.dirname(spoolFile), { recursive: true });
    fs.appendFileSync(spoolFile, line + '\n');
  } catch {
    // Never fail the hook.
  }
}

function post(port, token, body) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/hook',
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
        timeout: 500,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(false));
    req.end(body);
  });
}

async function main() {
  const raw = readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    input = {};
  }
  if (mode === 'statusline') {
    const pct = input?.context_window?.used_percentage;
    process.stdout.write(typeof pct === 'number' ? `ctx ${Math.round(pct)} %` : 'ctx unknown');
  }
  if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
  const envelope = {
    v: 1,
    id: randomUUID(),
    at: new Date().toISOString(),
    mode,
    hook_event_name: mode === 'statusline' ? 'statusline' : (input.hook_event_name ?? 'unknown'),
    label,
    sessionId: input.session_id ?? null,
    cwd: input.cwd ?? null,
    fields: { tool_name: input.tool_name ?? null, startedAt: t0, sleptMs: sleepMs },
  };
  envelope.pad = 'x'.repeat(Math.max(0, 1024 - JSON.stringify(envelope).length - 10));
  const body = JSON.stringify(envelope);
  let ok;
  try {
    const port = JSON.parse(fs.readFileSync(path.join(dataDir, 'api.json'), 'utf8')).port;
    const token = fs.readFileSync(path.join(dataDir, 'api-token'), 'utf8').trim();
    ok = await post(port, token, body);
  } catch {
    ok = false;
  }
  if (!ok) spool(body);
}

main().then(
  () => process.exit(0),
  () => process.exit(0),
);
