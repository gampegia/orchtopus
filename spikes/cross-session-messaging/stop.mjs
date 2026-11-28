// Stops and removes every session listed in msg-started.jsonl, and only those,
// then deletes the captured tokens in config\msg-tokens\.
// Usage: node stop.mjs [--dry-run]
import { rmSync } from 'node:fs';
import { claude, listOwnAgents, msgPaths, parseArgs, readJsonl } from './lib.mjs';

const a = parseArgs(process.argv.slice(2));
const ours = new Set(
  readJsonl(msgPaths.started)
    .map((r) => r.id)
    .filter(Boolean),
);
const list = listOwnAgents();
if (!Array.isArray(list)) throw new Error(`agents --json failed: ${list.error}`);
for (const s of list) {
  if (!ours.has(s.id)) continue;
  if (a['dry-run']) {
    console.log(`would stop ${s.id} (${s.state})`);
    continue;
  }
  const stop = claude(['stop', s.id]);
  const rm = claude(['rm', s.id]);
  console.log(`${s.id}: stop=${stop.status} rm=${rm.status}`);
}
const left = listOwnAgents();
console.log(JSON.stringify(Array.isArray(left) ? left.filter((s) => ours.has(s.id)) : left));
// Captured tokens are secrets of sessions that no longer run: remove them.
if (!a['dry-run']) {
  rmSync(msgPaths.tokens, { recursive: true, force: true });
  console.log(`removed ${msgPaths.tokens}`);
}
