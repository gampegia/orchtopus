// Stops and removes every background session this harness started, and only
// those: the id must be in started.jsonl and the session's cwd under the
// scratch folder. Prints the final `claude agents --json --all` for the test
// repo.
//
// Usage: node cleanup.mjs [--dry-run]
import { claude, listOwnAgents, parseArgs, paths, startedIds } from './lib/common.mjs';

const a = parseArgs(process.argv.slice(2));
const ours = new Set(startedIds().filter(Boolean));
const list = listOwnAgents();
if (!Array.isArray(list)) throw new Error(`agents --json failed: ${list.error}`);

const norm = (p) =>
  String(p ?? '')
    .toLowerCase()
    .replaceAll('/', '\\');
const root = norm(paths.root);
for (const s of list) {
  if (!s.id || !ours.has(s.id) || !norm(s.cwd).startsWith(root)) {
    console.log(`skip ${s.id ?? '(no id)'}: not started by this harness`);
    continue;
  }
  if (a['dry-run']) {
    console.log(`would stop and remove ${s.id} (${s.state})`);
    continue;
  }
  const stop = claude(['stop', s.id]);
  const rm = claude(['rm', s.id]);
  console.log(`${s.id}: stop=${stop.status} rm=${rm.status} ${(rm.stdout + rm.stderr).trim()}`);
}
console.log(JSON.stringify(listOwnAgents(), null, 2));
