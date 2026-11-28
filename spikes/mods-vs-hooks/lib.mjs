// Shared paths for the mods-vs-hooks spike. Everything a run writes lives in
// <scratch>\mods-vs-hooks\ (<scratch> = %TEMP%\orchtopus-spike); sessions run in the M1 test
// project <scratch>\acme-app, which Claude Code already trusts.
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanEnv, paths as m1Paths } from '../m1-claude-code/lib/common.mjs';

export {
  appendJsonl,
  cleanEnv,
  claudeExe,
  ensureDir,
  fwd,
  parseArgs,
} from '../m1-claude-code/lib/common.mjs';

export const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = join(m1Paths.root, 'mods-vs-hooks');

export const paths = {
  repo: m1Paths.repo,
  root: ROOT,
  settings: join(ROOT, 'settings'),
  plugins: join(ROOT, 'plugins'),
  logs: join(ROOT, 'logs'),
  hookLog: join(ROOT, 'logs', 'hooks.jsonl'),
  statusLog: join(ROOT, 'logs', 'statusline.jsonl'),
};

/** Commands the stand-in PR block refuses. Runs use the harmless probe word; `gh pr create` stays
 * in the pattern so the block also holds if a real one is sent. */
export const PR_BLOCK_PROBE = /gh pr create|ORCH_PROBE/;

/** The child environment: the M1 clean env, without gh and glab overrides. */
export function childEnv() {
  return Object.fromEntries(
    Object.entries(cleanEnv()).filter(([key]) => !/^(GH_|GITHUB_|GLAB_|GITLAB_)/i.test(key)),
  );
}

/** Refuses to run unless every remote of the test project is a local path (the bare remote). */
export function assertLocalRemotes() {
  const res = spawnSync('git', ['-C', paths.repo, 'remote', '-v'], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git remote -v failed in ${paths.repo}`);
  const urls = res.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[1] ?? '');
  const remote = urls.find((url) => /:\/\/|^[^/\]+@|^[A-Za-z0-9.-]{2,}:/.test(url));
  if (remote !== undefined) {
    throw new Error(`the test project has a non-local remote (${remote}); refusing to run`);
  }
}
