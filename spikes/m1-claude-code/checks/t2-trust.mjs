// T2: is workspace trust for acme-app inherited by a fresh worktree under
// .claude/worktrees/? Starts `claude --bg` from a script (no TTY) in the new
// worktree and checks that it starts and that hooks fire there. Reads only the
// key names under the scratch path in ~/.claude.json (never writes it).
//
// Usage: node checks/t2-trust.mjs
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  fwd,
  hookInputs,
  logsText,
  makeWorktree,
  paths,
  scrub,
  startBg,
  waitTurnEnd,
  writeEvidence,
} from './_shared.mjs';

const configFile = process.env.CLAUDE_CONFIG_DIR
  ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json')
  : join(homedir(), '.claude.json');

/** Key names under the scratch folder and their trust flag only. */
function scratchTrustKeys() {
  const projects = JSON.parse(readFileSync(configFile, 'utf8')).projects ?? {};
  const root = fwd(paths.root).toLowerCase();
  return Object.keys(projects)
    .filter((k) => fwd(k).toLowerCase().startsWith(root))
    .map((k) => ({ key: scrub(k), hasTrustDialogAccepted: projects[k]?.hasTrustDialogAccepted }));
}

const before = scratchTrustKeys();
const wt = makeWorktree('t2-probe');
const start = startBg({
  cwd: wt,
  settings: join(paths.settings, 'full.json'),
  prompt: 'Reply with the single word T2OK.',
  extra: ['--name', 't2-probe'],
  label: 't2',
});
console.log(`started ${start.id} status=${start.status}: ${(start.stdout + start.stderr).trim()}`);
const wait = start.id ? await waitTurnEnd(start.id, { timeoutMs: 120_000 }) : null;
const sessionId = wait?.entry?.sessionId;
const hooks = sessionId ? hookInputs(sessionId) : [];
const after = scratchTrustKeys();
const ev = {
  start: { status: start.status, out: scrub((start.stdout + start.stderr).trim()) },
  notTrustedMessage: /not trusted/i.test(start.stdout + start.stderr),
  wait,
  hookEvents: hooks.map((h) => `${h.label}:${h.event}`),
  sessionStartCwd: hooks.find((h) => h.event === 'SessionStart')?.input.cwd,
  stopMessage: hooks.findLast((h) => h.event === 'Stop')?.input.last_assistant_message,
  trustKeysBefore: before,
  trustKeysAfter: after,
  screen: start.id ? logsText(start.id, 20) : [],
};
console.log(JSON.stringify({ ...ev, screen: undefined, wait: wait?.entry?.state }, null, 2));
console.log('evidence:', writeEvidence('t2', ev));
