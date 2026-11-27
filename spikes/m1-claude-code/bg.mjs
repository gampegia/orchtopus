// Starts a background session in the test repo with the product's flags and
// records its id, so cleanup.mjs removes only sessions this harness started.
//
// Usage: node bg.mjs [--settings full] [--model haiku] [--effort low]
//          [--mode manual|auto|plan] [--session-id <uuid> | --new-id]
//          [--base] [--name report-export] [--resume <session uuid>]
//          [--fork] -- "<prompt>"
//
// A new session gets the defaults --settings full --model haiku --effort low.
// With --resume no session flag is added unless it is given explicitly, so
// `bg.mjs --resume <uuid>` runs exactly `claude --bg --resume <uuid>` and shows
// which saved options Claude Code restores on its own.
//
// started.jsonl records the real argv and the command's stdout and stderr.
import { randomUUID } from 'node:crypto';
import { appendJsonl, claude, parseArgs, paths, scrub } from './lib/common.mjs';
import { sessionFlags, tokenEnv } from './lib/flags.mjs';

const a = parseArgs(process.argv.slice(2));
const resuming = typeof a.resume === 'string';
const sessionId = a['new-id'] ? randomUUID() : a['session-id'];
const pick = (key, fallback) => a[key] ?? (resuming ? undefined : fallback);
const flags = [
  '--bg',
  ...sessionFlags({
    settings: pick('settings', 'full'),
    model: pick('model', 'haiku'),
    effort: pick('effort', 'low'),
    mode: a.mode,
    sessionId: typeof sessionId === 'string' ? sessionId : undefined,
    base: Boolean(a.base),
    name: a.name,
  }),
];
if (resuming) flags.push('--resume', a.resume);
if (a.fork) flags.push('--fork-session');
const prompt = (a['--'] ?? []).join(' ');
if (prompt) flags.push(prompt);

const res = claude(flags, { env: tokenEnv() });
const out = res.stdout + res.stderr;
const id = /backgrounded\s*·\s*([0-9a-f]{6,})/i.exec(out)?.[1];
appendJsonl(paths.started, {
  id,
  sessionId,
  argv: ['claude', ...flags].map(scrub),
  status: res.status,
  ms: res.ms,
  stdout: scrub(res.stdout),
  stderr: scrub(res.stderr),
});
console.log(scrub(out.trim()));
console.log(JSON.stringify({ id, sessionId, status: res.status, ms: res.ms }));
