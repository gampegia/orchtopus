// Creates a one-time release (or a deny) for a held "dangerous" command,
// bound to session id, exact command text and cwd, as the product would.
//
// Usage: node release.mjs --last [--deny] [--minutes 5]
//        node release.mjs --session <id> --command "<text>" --cwd <dir> [--deny]
//
// --last takes the key of the most recent held or parked command from the
// command hook log.
import { join } from 'node:path';
import { parseArgs, paths, readJson, readJsonl, writeJsonAtomic } from './lib/common.mjs';

const a = parseArgs(process.argv.slice(2));
let key;
if (a.last) {
  const held = readJsonl(join(paths.logs, 'command-hooks.jsonl')).filter(
    (r) => r.phase === 'held' || r.phase === 'parked',
  );
  key = held.at(-1)?.key;
  if (!key) throw new Error('no held or parked command in the log');
} else {
  key = { session_id: a.session, command: a.command, cwd: a.cwd };
}
const releases = readJson(paths.releases, []);
const entry = {
  ...key,
  action: a.deny ? 'deny' : 'allow',
  used: false,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + Number(a.minutes ?? 5) * 60_000).toISOString(),
};
releases.push(entry);
writeJsonAtomic(paths.releases, releases);
console.log(JSON.stringify(entry));
