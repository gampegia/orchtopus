// HTTP hook receiver on 127.0.0.1. Logs every request body as a JSON line and
// answers as `policy.json["http:<Event>"]` says (read on every request).
//
// Usage: node receiver.mjs [--port 47613]
//
// Policy modes: empty (default, 200 with empty body), allow, deny (`message`),
// status500, garbage (200 with plain text). `delayMs` waits before answering;
// a client that gives up first is logged as "client-closed".
// GET /install.sh serves a script that only echoes a marker.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RECEIVER_PORT, appendJsonl, parseArgs, paths, readJson } from './lib/common.mjs';

const LOG = join(paths.logs, 'http-hooks.jsonl');
const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? RECEIVER_PORT);
const token = readFileSync(paths.token, 'utf8').trim();

function decisionBody(event, behavior, message) {
  if (event === 'PermissionRequest') {
    const decision = behavior === 'deny' ? { behavior, message } : { behavior };
    return { hookSpecificOutput: { hookEventName: event, decision } };
  }
  if (event === 'PreToolUse') {
    return {
      hookSpecificOutput: {
        hookEventName: event,
        permissionDecision: behavior,
        permissionDecisionReason: message ?? `${behavior} by the spike receiver`,
      },
    };
  }
  return {};
}

let seq = 0;
const server = createServer((req, res) => {
  // Harmless "download and run" stand-in for the auto mode classifier test.
  if (req.method === 'GET' && req.url === '/install.sh') {
    appendJsonl(LOG, { phase: 'get', path: req.url });
    res.writeHead(200, { 'content-type': 'text/plain' }).end('echo ORCH_INSTALL_STANDIN\n');
    return;
  }
  const id = ++seq;
  const t0 = Date.now();
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let input;
    try {
      input = JSON.parse(body);
    } catch {
      input = { unparsed: body };
    }
    const event = input.hook_event_name ?? 'unknown';
    const authOk = req.headers.authorization === `Bearer ${token}`;
    // Second header comes from an env variable through allowedEnvVars; it shows
    // whether that variable reached the session's environment.
    const envHeader = req.headers['x-orch-env-token'];
    const envTokenOk = envHeader === token;
    appendJsonl(LOG, {
      phase: 'in',
      id,
      path: req.url,
      event,
      authOk,
      envTokenOk,
      envHeaderPresent: envHeader !== undefined && envHeader !== '',
      input,
    });
    if (!authOk) {
      res.writeHead(401).end();
      appendJsonl(LOG, { phase: 'out', id, event, status: 401 });
      return;
    }
    const policy = readJson(paths.policy, {})[`http:${event}`] ?? { mode: 'empty' };
    let closed = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        closed = true;
        appendJsonl(LOG, { phase: 'client-closed', id, event, elapsedMs: Date.now() - t0 });
      }
    });
    setTimeout(
      () => {
        if (closed) return;
        let status = 200;
        let out = '';
        if (policy.mode === 'allow' || policy.mode === 'deny') {
          out = JSON.stringify(decisionBody(event, policy.mode, policy.message));
        } else if (policy.mode === 'status500') status = 500;
        else if (policy.mode === 'garbage') out = 'not json';
        res.writeHead(status, { 'content-type': 'application/json' }).end(out);
        appendJsonl(LOG, {
          phase: 'out',
          id,
          event,
          mode: policy.mode,
          status,
          body: out,
          elapsedMs: Date.now() - t0,
        });
      },
      Number(policy.delayMs ?? 0),
    );
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`receiver listening on http://127.0.0.1:${port}`);
});
