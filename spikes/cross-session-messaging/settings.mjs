// Writes one settings file per `crossSessionInbound` variant into the scratch
// config folder: msg-unset, msg-accept, msg-hold, msg-refuse.
//
// Usage: node settings.mjs
//
// Hooks only log (labels start with `msg-`, so a policy.json entry written by
// another experiment never applies). SessionStart also runs env-hook.mjs.
import { join } from 'node:path';
import { HARNESS_DIR, fwd, paths, writeJson } from './lib.mjs';

const m1Hook = fwd(join(HARNESS_DIR, 'hook.mjs'));
const envHook = fwd(join(HARNESS_DIR, '..', 'cross-session-messaging', 'env-hook.mjs'));
const log = (label) => ({
  type: 'command',
  command: process.execPath,
  args: [m1Hook, '--label', `msg-${label}`],
});

const base = {
  worktree: { bgIsolation: 'none' },
  hooks: {
    SessionStart: [
      {
        hooks: [
          { type: 'command', command: process.execPath, args: [envHook] },
          log('session-start'),
        ],
      },
    ],
    UserPromptSubmit: [{ hooks: [log('prompt-submit')] }],
    PreToolUse: [{ hooks: [log('pre-tool')] }],
    PostToolUse: [{ hooks: [log('post-tool')] }],
    Notification: [{ hooks: [log('notification')] }],
    Stop: [{ hooks: [log('stop')] }],
  },
};

for (const value of ['unset', 'accept', 'hold', 'refuse']) {
  const settings = value === 'unset' ? base : { ...base, crossSessionInbound: value };
  const file = join(paths.settings, `msg-${value}.json`);
  writeJson(file, settings);
  console.log(file);
}
