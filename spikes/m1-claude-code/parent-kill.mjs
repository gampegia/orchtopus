// Q1: start a background session from a parent process, kill that parent with
// its whole process tree (as Windows does when an app is ended from Task
// Manager or crashes inside a job object), then check the session survived.
//
// Run it while `claude daemon status` says "not running", so the supervisor
// is started by the parent and is part of the tree that gets killed.
//
// Usage: node parent-kill.mjs [--wait 15] -- "<prompt>"
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import {
  HARNESS_DIR,
  appendJsonl,
  claude,
  listOwnAgents,
  parseArgs,
  paths,
  sleep,
} from './lib/common.mjs';

const a = parseArgs(process.argv.slice(2));
const LOG = join(paths.logs, 'parent-kill.jsonl');
const prompt = (
  a['--'] ?? ['Run git status, then count slowly from 1 to 20, one number per line.']
).join(' ');

appendJsonl(LOG, { step: 'daemon-before', out: claude(['daemon', 'status']).stdout });

// The parent runs bg.mjs and then stays alive, like an app would.
const parentCode = `
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, [${JSON.stringify(join(HARNESS_DIR, 'bg.mjs'))}, '--', ${JSON.stringify(prompt)}], { encoding: 'utf8' });
  process.stdout.write(r.stdout);
  setInterval(() => {}, 1000);
`;
const parent = spawn(process.execPath, ['-e', parentCode], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
let out = '';
parent.stdout.on('data', (d) => (out += d));
while (!/"id":/.test(out)) await sleep(200);
const id = JSON.parse(out.trim().split('\n').at(-1)).id;
appendJsonl(LOG, { step: 'started', id, parentPid: parent.pid });
console.log('started', id, 'parent pid', parent.pid);

await sleep(3000);
const kill = execFileSync('taskkill', ['/PID', String(parent.pid), '/T', '/F'], {
  encoding: 'utf8',
});
appendJsonl(LOG, { step: 'killed-tree', kill });
console.log(kill.trim());

const until = Date.now() + Number(a.wait ?? 15) * 1000;
while (Date.now() < until) {
  const mine = (listOwnAgents() ?? []).find?.((s) => s.id === id);
  appendJsonl(LOG, { step: 'after-kill', session: mine });
  console.log(
    new Date().toISOString(),
    JSON.stringify(mine && { state: mine.state, status: mine.status, pid: mine.pid }),
  );
  await sleep(2000);
}
appendJsonl(LOG, { step: 'daemon-after', out: claude(['daemon', 'status']).stdout });
console.log(
  `next: node pty-run.mjs --name q01-attach --every 1000 --steps '[{"sleep":8000},{"snap":"attached"},{"key":"ctrl-z"}]' -- attach ${id}`,
);
