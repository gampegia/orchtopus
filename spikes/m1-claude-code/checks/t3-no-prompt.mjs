// T3: does `claude --bg` start without a first prompt and wait for one?
// Starts `claude --bg --settings <full> --name t3-probe` with no positional
// prompt in a worktree, watches `agents --json` for 20 s, then attaches in a
// ConPTY, waits for the prompt box and asks for T3OK.
//
// Usage: node checks/t3-no-prompt.mjs [--worktree t2-probe]
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from '../lib/common.mjs';
import { runPty } from '../pty-run.mjs';
import {
  agentById,
  hookInputs,
  makeWorktree,
  paths,
  scrub,
  sleep,
  startBg,
  waitTurnEnd,
  worktreePath,
  writeEvidence,
} from './_shared.mjs';

const a = parseArgs(process.argv.slice(2));
const task = String(a.worktree ?? 't3-probe');
const wt = existsSync(worktreePath(task)) ? worktreePath(task) : makeWorktree(task);

const start = startBg({
  cwd: wt,
  settings: join(paths.settings, 'full.json'),
  mode: null,
  extra: ['--name', 't3-probe'],
  label: 't3',
});
console.log(
  `exit=${start.status} stdout=${JSON.stringify(scrub(start.stdout))} stderr=${JSON.stringify(scrub(start.stderr))}`,
);

const watch = [];
if (start.id) {
  let last = '';
  for (let t = 0; t < 20; t += 2) {
    const e = agentById(start.id);
    const key = JSON.stringify([e?.state, e?.status, e?.waitingFor]);
    if (key !== last)
      watch.push({ atS: t, state: e?.state, status: e?.status, waitingFor: e?.waitingFor });
    last = key;
    await sleep(2000);
  }
}
console.log('agents over 20 s:', JSON.stringify(watch));

let pty;
let wait;
if (start.id) {
  pty = await runPty({
    name: 't3-attach',
    args: ['attach', start.id],
    every: 1000,
    steps: [
      { wait: '❯', timeout: 30 },
      { sleep: 6000 },
      { snap: 'ready' },
      { send: 'Reply with the single word T3OK.' },
      { sleep: 800 },
      { key: 'enter' },
      { wait: '●\\s*T3OK', timeout: 60 },
      { snap: 'answered' },
      { key: 'ctrl-z' },
      { sleep: 1500 },
    ],
  });
  wait = await waitTurnEnd(start.id, { timeoutMs: 60_000 });
}
const sessionId = wait?.entry?.sessionId;
const hooks = sessionId ? hookInputs(sessionId) : [];
const ev = {
  start: {
    status: start.status,
    stdout: start.stdout.trim(),
    stderr: start.stderr.trim(),
    id: start.id,
  },
  agentsFirst20s: watch,
  ptySteps: pty?.steps,
  ptyExit: pty?.exit,
  answered: pty?.steps?.find((s) => s.step.wait?.includes('T3OK'))?.ok ?? false,
  hookEvents: hooks.map((h) => `${h.label}:${h.event}`),
  prompts: hooks.filter((h) => h.event === 'UserPromptSubmit').map((h) => h.input.prompt),
  stopMessage: hooks.findLast((h) => h.event === 'Stop')?.input.last_assistant_message,
  finalAgent: wait?.entry && { state: wait.entry.state, status: wait.entry.status },
};
console.log(JSON.stringify(ev, null, 2));
console.log('evidence:', writeEvidence('t3', ev));
