// Runs one `claude -p` session in the test repo and waits for it to end.
// Used for receivers that `claude --bg` cannot start without a disclaimer
// (bypassPermissions). The session's id comes from msg-env.jsonl
// (SessionStart hook); stdout and stderr go to logs\msg-print-<label>.txt.
//
// Usage: node print-run.mjs --label <l> --inbound unset|accept|hold|refuse
//          [--mode bypassPermissions] -- "<prompt>"
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { appendJsonl, claudeExe, cleanEnv, msgPaths, parseArgs, paths } from './lib.mjs';
import { sessionFlags } from '../m1-claude-code/lib/flags.mjs';

const a = parseArgs(process.argv.slice(2));
const label = String(a.label ?? 'print');
const flags = [
  '-p',
  ...sessionFlags({
    settings: `msg-${String(a.inbound ?? 'unset')}`,
    model: 'haiku',
    effort: 'low',
    mode: a.mode,
  }),
  (a['--'] ?? []).join(' '),
];
const out = createWriteStream(join(paths.logs, `msg-print-${label}.txt`));
const t0 = Date.now();
const child = spawn(claudeExe(), flags, {
  cwd: paths.repo,
  env: cleanEnv(),
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.pipe(out);
child.stderr.pipe(out);
appendJsonl(msgPaths.started, {
  label,
  kind: 'print',
  pid: child.pid,
  inbound: a.inbound,
  mode: a.mode,
});
const code = await new Promise((res) => child.on('exit', res));
console.log(JSON.stringify({ label, exit: code, ms: Date.now() - t0 }));
