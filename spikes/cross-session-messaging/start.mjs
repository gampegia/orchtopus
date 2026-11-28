// Starts a background session in the test repo and records it in
// msg-started.jsonl (own file, so stop.mjs only touches sessions of this spike).
//
// Usage: node start.mjs --inbound unset|accept|hold|refuse [--mode manual|auto|bypassPermissions]
//          [--name acme-worker] -- "<first prompt>"
import { appendJsonl, claude, listOwnAgents, msgPaths, parseArgs, scrub, sleep } from './lib.mjs';
import { sessionFlags } from '../m1-claude-code/lib/flags.mjs';

const a = parseArgs(process.argv.slice(2));
const inbound = String(a.inbound ?? 'unset');
const flags = [
  '--bg',
  ...sessionFlags({
    settings: `msg-${inbound}`,
    model: 'haiku',
    effort: 'low',
    mode: a.mode,
    name: a.name,
  }),
];
const prompt = (a['--'] ?? []).join(' ');
if (prompt) flags.push(prompt);

const res = claude(flags);
const out = res.stdout + res.stderr;
const id = /backgrounded\s*·\s*([0-9a-f]{6,})/i.exec(out)?.[1];
let entry;
for (let i = 0; i < 20 && id && !entry?.sessionId; i++) {
  await sleep(1000);
  const list = listOwnAgents();
  entry = Array.isArray(list) ? list.find((s) => s.id === id) : undefined;
}
appendJsonl(msgPaths.started, {
  id,
  sessionId: entry?.sessionId,
  pid: entry?.pid,
  inbound,
  mode: a.mode ?? '(default)',
  argv: ['claude', ...flags].map(scrub),
  status: res.status,
  stdout: scrub(res.stdout),
  stderr: scrub(res.stderr),
});
console.log(scrub(out.trim()));
console.log(JSON.stringify({ id, sessionId: entry?.sessionId, pid: entry?.pid, inbound }));
