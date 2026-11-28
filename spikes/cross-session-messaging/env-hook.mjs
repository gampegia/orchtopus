// SessionStart command hook: records the messaging variables Claude Code
// exports to hooks. The token itself goes into a scratch file named after the
// session id (send.mjs reads it); the log only holds its fingerprint.
//
// Usage in settings (exec form): node env-hook.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendJsonl, ensureDir, fingerprint, msgPaths } from './lib.mjs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  // keep the empty object
}
const socket = process.env.CLAUDE_CODE_MESSAGING_SOCKET;
const token = process.env.CLAUDE_CODE_MESSAGING_TOKEN;
if (token && input.session_id) {
  ensureDir(msgPaths.tokens);
  writeFileSync(join(msgPaths.tokens, `${input.session_id}.txt`), token);
}
appendJsonl(msgPaths.env, {
  event: input.hook_event_name,
  source: input.source,
  session_id: input.session_id,
  permission_mode: input.permission_mode,
  socket,
  tokenLength: token?.length ?? 0,
  tokenFp: fingerprint(token),
  ppid: process.ppid,
  otherMessagingVars: Object.keys(process.env).filter(
    (k) =>
      /MESSAG|PEER|CROSS_SESSION/i.test(k) && !/^CLAUDE_CODE_MESSAGING_(SOCKET|TOKEN)$/.test(k),
  ),
});
