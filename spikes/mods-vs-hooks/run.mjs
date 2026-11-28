// One `claude -p` run in the test project with a settings variant and test mods loaded for this
// session only (--plugin-dir). Prints the tool calls, their results, the final text and what
// the stand-in hooks logged for this session. Refuses to run unless the test project has only local
// remotes; gh and glab variables are dropped from the child environment.
// Usage: node run.mjs --name <run> [--settings orch] [--mods a,b] [--flags safe-mode,bare]
//        [--mode default] [--skills-dir-mod <mod>] -- "<prompt>"
// --skills-dir-mod copies a test mod to <repo>/.claude/skills/<mod>/ for this run only (id <mod>@skills-dir).
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertLocalRemotes, childEnv, claudeExe, ensureDir, parseArgs, paths } from './lib.mjs';

const dash = process.argv.indexOf('--');
const args = parseArgs(process.argv.slice(2, dash === -1 ? undefined : dash));
const prompt = dash === -1 ? 'Say hi.' : process.argv.slice(dash + 1).join(' ');
const name = String(args.name ?? 'run');
ensureDir(paths.logs);
assertLocalRemotes();

const argv = [
  '-p',
  '--model',
  'haiku',
  '--effort',
  'low',
  '--output-format',
  'stream-json',
  '--verbose',
];
argv.push('--permission-mode', String(args.mode ?? 'default'));
argv.push('--debug-file', join(paths.logs, `${name}.debug.log`));
if (args.settings !== false && args.settings !== 'none') {
  argv.push('--settings', join(paths.settings, `${String(args.settings ?? 'orch')}.json`));
}
for (const mod of String(args.mods ?? '')
  .split(',')
  .filter(Boolean)) {
  argv.push('--plugin-dir', join(paths.plugins, mod));
}
// --flags safe-mode,bare → --safe-mode --bare (a value that starts with "--" would be read as a flag)
if (typeof args.flags === 'string') {
  argv.push(
    ...args.flags
      .split(',')
      .filter(Boolean)
      .map((f) => `--${f}`),
  );
}
argv.push(prompt);

const skillsMod = typeof args['skills-dir-mod'] === 'string' ? args['skills-dir-mod'] : null;
const skillsDir = skillsMod === null ? null : join(paths.repo, '.claude', 'skills', skillsMod);
if (skillsDir !== null)
  cpSync(join(paths.plugins, String(skillsMod)), skillsDir, { recursive: true });

const started = Date.now();
let res;
try {
  res = spawnSync(claudeExe(), argv, {
    cwd: paths.repo,
    env: childEnv(),
    encoding: 'utf8',
    timeout: 240_000,
    windowsHide: true,
  });
} finally {
  if (skillsDir !== null) rmSync(skillsDir, { recursive: true, force: true });
}
writeFileSync(join(paths.logs, `${name}.stream.jsonl`), res.stdout ?? '');
writeFileSync(join(paths.logs, `${name}.stderr.txt`), res.stderr ?? '');
writeFileSync(join(paths.logs, `${name}.argv.json`), JSON.stringify(argv, null, 2));

let session;
const lines = [];
for (const line of (res.stdout ?? '').split('\n')) {
  if (!line.trim()) continue;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    continue;
  }
  if (msg.type === 'system' && msg.subtype === 'init') {
    session = msg.session_id;
    lines.push(
      `init: plugins=${JSON.stringify(msg.plugins ?? null)} hooks?=${JSON.stringify(Object.keys(msg).filter((k) => /hook|plugin|mod/i.test(k)))}`,
    );
  }
  for (const part of msg.message?.content ?? []) {
    if (part.type === 'tool_use') lines.push(`tool_use: ${JSON.stringify(part.input)}`);
    if (part.type === 'tool_result') {
      const text = typeof part.content === 'string' ? part.content : JSON.stringify(part.content);
      lines.push(`tool_result${part.is_error ? ' (error)' : ''}: ${text.slice(0, 400)}`);
    }
  }
  if (msg.type === 'result') lines.push(`result: ${String(msg.result ?? '').slice(0, 400)}`);
}
console.log(
  `run ${name}: exit ${String(res.status)} in ${String(Date.now() - started)} ms, session ${String(session)}`,
);
for (const l of lines) console.log(`  ${l}`);
if (res.stderr?.trim()) console.log(`  stderr: ${res.stderr.trim().slice(0, 600)}`);
try {
  const hooks = readFileSync(paths.hookLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((h) => h.session === session);
  console.log(
    `  hooks: ${hooks.map((h) => `${h.label}/${h.event}${h.decision ? `=${h.decision}` : ''}`).join(', ') || 'none'}`,
  );
} catch {
  console.log('  hooks: none (no hook log)');
}
try {
  const status = readFileSync(paths.statusLog, 'utf8')
    .split('\n')
    .filter((l) => l.includes(String(session)));
  console.log(`  statusline runs: ${String(status.length)}`);
} catch {
  console.log('  statusline runs: 0');
}
