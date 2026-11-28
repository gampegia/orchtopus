// Writes one message into a running session's messaging pipe, the way an
// Orchtopus adapter would, and logs what the pipe does (data back, close,
// errors). Tokens are never logged, only their fingerprints.
//
// Usage: node send.mjs (--id <short id> | --session <uuid>) [--text "<message>"]
//          [--auth captured|key|wrong|none|late]  (default captured)
//          [--raw '<json line>']   replaces the message line
//          [--wait-before ms]      connect, then wait before writing anything
//          [--hold-open ms]        keep the connection open after writing (default 3000)
//
// captured: CLAUDE_CODE_MESSAGING_TOKEN as seen by the session's SessionStart hook
// key:      peerToken from the session registry's <pid>.<hash>.key file
// late:     message line first, auth line second
import { connect } from 'node:net';
import {
  appendJsonl,
  capturedToken,
  fingerprint,
  listOwnAgents,
  msgPaths,
  parseArgs,
  registryBySession,
  registryEntry,
  registryPeerToken,
  sleep,
} from './lib.mjs';

const a = parseArgs(process.argv.slice(2));
let agent;
if (typeof a.session === 'string') {
  // -p sessions have no short id in agents --json; find them in the registry.
  const reg = registryBySession(a.session);
  if (!reg) throw new Error(`no registry entry for session ${a.session}`);
  agent = {
    id: a.session.slice(0, 8),
    pid: reg.pid,
    sessionId: a.session,
    state: reg.kind,
    status: reg.status,
  };
} else {
  const list = listOwnAgents();
  agent = Array.isArray(list) ? list.find((s) => s.id === a.id) : undefined;
  if (!agent) throw new Error(`no session ${a.id} in agents --json`);
}
const reg = registryEntry(agent.pid);
const socketPath = reg?.messagingSocketPath;
if (!socketPath) throw new Error(`no messagingSocketPath for pid ${agent.pid}`);

const authMode = String(a.auth ?? 'captured');
const keyToken = authMode === 'key' ? registryPeerToken(agent.pid) : null;
const token =
  authMode === 'key'
    ? keyToken
    : authMode === 'wrong'
      ? '0'.repeat(32)
      : capturedToken(agent.sessionId);
const authLine = JSON.stringify({ type: 'auth', token });
const msgLine =
  typeof a.raw === 'string'
    ? a.raw
    : JSON.stringify({
        type: 'user',
        message: { role: 'user', content: String(a.text ?? 'ping') },
      });
const lines =
  authMode === 'none' ? [msgLine] : authMode === 'late' ? [msgLine, authLine] : [authLine, msgLine];

const record = {
  id: a.id,
  sessionId: agent.sessionId,
  state: `${agent.state}/${agent.status}`,
  socketPath,
  authMode,
  tokenFp: fingerprint(token),
  capturedFp: fingerprint(capturedToken(agent.sessionId)),
  keyFp: fingerprint(keyToken),
  // A raw line may carry anything; log only its fingerprint.
  rawFp: typeof a.raw === 'string' ? fingerprint(a.raw) : undefined,
  text: a.text,
  events: [],
};
const t0 = Date.now();
const ev = (kind, detail) => record.events.push({ ms: Date.now() - t0, kind, ...detail });

const sock = connect(socketPath);
sock.setEncoding('utf8');
sock.on('data', (d) => ev('data', { data: d }));
sock.on('error', (e) => ev('error', { code: e.code, message: e.message }));
sock.on('end', () => ev('end'));
await new Promise((res) => {
  sock.once('connect', () => {
    ev('connect');
    res();
  });
  sock.once('error', res);
});
if (!sock.destroyed) {
  await sleep(Number(a['wait-before'] ?? 0));
  for (const line of lines) {
    if (sock.destroyed) break;
    sock.write(line + '\n');
    ev('wrote', { line: line === authLine ? '{auth}' : 'message' });
    await sleep(200);
  }
  await sleep(Number(a['hold-open'] ?? 3000));
}
const closed = sock.destroyed;
sock.end();
await sleep(300);
ev('done', { closedByPeer: closed });
appendJsonl(msgPaths.sends, record);
console.log(JSON.stringify(record, null, 2));
process.exit(0);
