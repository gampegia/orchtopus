// Q3 and Q4: two PTY clients attached to one background session. Client A
// starts a turn; client B types a second message while the turn runs.
//
// Usage: node experiments/q03-two-clients.mjs <short id>
import { runPty } from '../pty-run.mjs';

const id = process.argv[2];
if (!id) throw new Error('usage: q03-two-clients.mjs <short id>');

const first =
  'Run this command and then report the number it prints: node -e "setTimeout(()=>console.log(6*7),12000)"';
const second = 'After that, reply with the word BANANA.';

const a = runPty({
  name: 'q03-a',
  args: ['attach', id],
  every: 1000,
  steps: [
    { sleep: 7000 },
    { snap: 'ready' },
    { send: first },
    { sleep: 800 },
    { key: 'enter' },
    { sleep: 6000 },
    { snap: 'midturn' },
    { sleep: 30000 },
    { snap: 'end' },
    { key: 'ctrl-z' },
    { sleep: 1500 },
  ],
});
const b = runPty({
  name: 'q03-b',
  args: ['attach', id],
  every: 1000,
  steps: [
    { sleep: 10000 },
    { snap: 'ready' },
    { send: second },
    { sleep: 800 },
    { key: 'enter' },
    { sleep: 3000 },
    { snap: 'queued' },
    { sleep: 30000 },
    { snap: 'end' },
    { key: 'ctrl-z' },
    { sleep: 1500 },
  ],
});
const [ra, rb] = await Promise.all([a, b]);
console.log(JSON.stringify({ a: ra.exit, b: rb.exit, snapsA: ra.snaps, snapsB: rb.snaps }));
