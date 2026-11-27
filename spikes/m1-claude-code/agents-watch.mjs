// Polls `claude agents --json --all --cwd <test repo>` and logs every change
// of a session's state fields with a timestamp.
//
// Usage: node agents-watch.mjs [--interval 500] [--seconds 120] [--once]
import { join } from 'node:path';
import { appendJsonl, listOwnAgents, parseArgs, paths, sleep } from './lib/common.mjs';

const a = parseArgs(process.argv.slice(2));
const LOG = join(paths.logs, 'agents.jsonl');

if (a.once) {
  const list = listOwnAgents();
  appendJsonl(LOG, { snapshot: list });
  console.log(JSON.stringify(list, null, 2));
  process.exit(0);
}

const interval = Number(a.interval ?? 500);
const until = Date.now() + Number(a.seconds ?? 120) * 1000;
const prev = new Map();
const pick = (s) =>
  JSON.stringify({
    state: s.state,
    status: s.status,
    waitingFor: s.waitingFor,
    pid: s.pid,
    kind: s.kind,
  });

while (Date.now() < until) {
  const t = Date.now();
  const list = listOwnAgents();
  const pollMs = Date.now() - t;
  if (Array.isArray(list)) {
    for (const s of list) {
      const key = s.id ?? s.sessionId ?? s.pid;
      const now = pick(s);
      if (prev.get(key) !== now) {
        prev.set(key, now);
        appendJsonl(LOG, { change: s, pollMs });
        console.log(new Date().toISOString(), key, now);
      }
    }
  } else appendJsonl(LOG, { error: list.error, pollMs });
  await sleep(Math.max(0, interval - pollMs));
}
