// Starts a background session in the test repo with the product's flags and
// records its id, so cleanup.mjs removes only sessions this harness started.
//
// Usage: node bg.mjs [--settings full] [--model haiku] [--effort low]
//          [--mode manual|auto|plan] [--session-id <uuid> | --new-id]
//          [--base] [--name report-export] [--resume <session uuid>]
//          [--fork] -- "<prompt>"
import { randomUUID } from 'node:crypto';
import { appendJsonl, claude, parseArgs, paths, scrub } from './lib/common.mjs';
import { sessionFlags, tokenEnv } from './lib/flags.mjs';

const a = parseArgs(process.argv.slice(2));
const sessionId = a['new-id'] ? randomUUID() : a['session-id'];
const flags = [
  '--bg',
  ...sessionFlags({
    settings: a.settings ?? 'full',
    model: a.model ?? 'haiku',
    effort: a.effort ?? 'low',
    mode: a.mode,
    sessionId: typeof sessionId === 'string' ? sessionId : undefined,
    base: Boolean(a.base),
    name: a.name,
  }),
];
if (a.resume) flags.push('--resume', a.resume);
if (a.fork) flags.push('--fork-session');
const prompt = (a['--'] ?? []).join(' ');
if (prompt) flags.push(prompt);

const res = claude(flags, { env: tokenEnv() });
const out = res.stdout + res.stderr;
const id = /backgrounded\s*·\s*([0-9a-f]{6,})/i.exec(out)?.[1];
appendJsonl(paths.started, { id, sessionId, flags, status: res.status, ms: res.ms });
console.log(scrub(out.trim()));
console.log(JSON.stringify({ id, sessionId, status: res.status, ms: res.ms }));
