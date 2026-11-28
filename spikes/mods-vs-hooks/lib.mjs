// Shared paths for the mods-vs-hooks spike. Everything a run writes lives in
// <scratch>\mods-vs-hooks\ (<scratch> = %TEMP%\orchtopus-spike); sessions run in the M1 test
// project <scratch>\acme-app, which Claude Code already trusts.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths as m1Paths } from '../m1-claude-code/lib/common.mjs';

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

/** Commands the stand-in PR block refuses: the real `gh pr create`, or a harmless probe. */
export const PR_BLOCK_PROBE = /gh pr create|ORCH_PROBE/;
