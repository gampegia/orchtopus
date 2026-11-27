// Attaches to a background session, sends one prompt, snapshots the screen at
// the given offsets, optionally presses keys, then detaches.
//
// Usage: node experiments/ask.mjs <short id> <run name> "<prompt>"
//          [--snaps 5,15,30] [--keys '[{"at":20,"key":"esc"}]'] [--end 40]
import { parseArgs } from '../lib/common.mjs';
import { runPty } from '../pty-run.mjs';

const a = parseArgs(process.argv.slice(2));
const [id, name, prompt] = a._;
const snaps = String(a.snaps ?? '10,25')
  .split(',')
  .map(Number);
const keys = JSON.parse(a.keys ?? '[]');
const end = Number(a.end ?? Math.max(...snaps) + 2);

const events = [
  ...snaps.map((s) => ({ at: s, step: { snap: `t${s}` } })),
  ...keys.map((k) => ({ at: k.at, step: k.send ? { send: k.send } : { key: k.key } })),
].sort((x, y) => x.at - y.at);

const steps = [{ sleep: 7000 }, { send: prompt }, { sleep: 800 }, { key: 'enter' }];
let t = 0;
for (const e of events) {
  steps.push({ sleep: Math.max(0, (e.at - t) * 1000) }, e.step);
  t = e.at;
}
steps.push({ sleep: Math.max(0, (end - t) * 1000) }, { key: 'ctrl-z' }, { sleep: 1500 });

const res = await runPty({ name, args: ['attach', id], every: 1000, steps });
console.log(JSON.stringify({ exit: res.exit, snaps: res.snaps.map((s) => s.label) }));
