// Command hook for every spike experiment. It logs the raw hook input, then
// acts as `policy.json[label]` says. The policy is read on every call, so an
// experiment can change the behaviour while a session runs.
//
// Usage in settings (exec form): node hook.mjs --label <label>
//
// If policy.json cannot be read or parsed, the `danger` label denies the call
// (fail closed) and every other label falls back to `log`.
//
// Policy modes (policy.json: { "<label>": { "mode": ..., ... } }):
//   log (default)  exit 0, no output
//   deny           PreToolUse deny with `reason`
//   allow          PreToolUse allow
//   exit2          exit 2 with `reason` on stderr
//   exit1          exit 1, no output
//   crash          throw (node exits 1 with a stack trace)
//   sleep          wait `ms`, then exit 0 (for hook timeouts)
//   context        print additionalContext `text` for the current event
//   stop-once      Stop: exit 2 with `reason` unless stop_hook_active is set
//   danger         hold commands that contain `pattern` (see below)
//   deny-match     PreToolUse deny for shell commands matching the regex `pattern`
//                  (PR-block stand-in), log the rest
//
// danger: a Bash or PowerShell command containing `pattern` (default
// ORCH_DANGER_MARKER) is held up to `holdMs`. A matching entry in
// releases.json (same session id, exact command text, same cwd, unused)
// allows it once; a matching entry with action "deny" denies it. When the hold
// ends without a decision, the command is parked: denied with `parkReason`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendJsonl,
  parseArgs,
  paths,
  readJson,
  readJsonStrict,
  writeJsonAtomic,
} from './lib/common.mjs';

const LOG = join(paths.logs, 'command-hooks.jsonl');
const args = parseArgs(process.argv.slice(2));
const label = String(args.label ?? 'unlabelled');

const DEFAULT_PARK_REASON =
  'Paused for the user: this command needs the user to approve it in Orchtopus. ' +
  'Do not repeat it and do not work around it with another command. ' +
  'Stop now and wait for the user to reply.';

const raw = readFileSync(0, 'utf8');
let input;
try {
  input = JSON.parse(raw);
} catch {
  input = { unparsed: raw };
}
const event = input.hook_event_name;
// A missing, malformed or half-written policy.json must not open the gate:
// the `danger` label fails closed (denies), every other label only logs.
const policyFile = readJsonStrict(paths.policy);
const policy = policyFile.ok
  ? (policyFile.value?.[label] ?? { mode: 'log' })
  : label === 'danger'
    ? { mode: 'deny', reason: 'Orchtopus could not read its policy; this command is blocked.' }
    : { mode: 'log' };
if (!policyFile.ok) {
  appendJsonl(LOG, { phase: 'policy-unreadable', label, error: policyFile.error });
}
const t0 = Date.now();

appendJsonl(LOG, { phase: 'in', label, event, mode: policy.mode, pid: process.pid, input });

function finish(exitCode, { stdout, stderr, note } = {}) {
  appendJsonl(LOG, {
    phase: 'out',
    label,
    event,
    mode: policy.mode,
    exitCode,
    stdout,
    stderr,
    note,
    elapsedMs: Date.now() - t0,
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.exitCode = exitCode;
}

const preToolUse = (decision, reason) =>
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function danger() {
  const pattern = policy.pattern ?? 'ORCH_DANGER_MARKER';
  const command = input.tool_input?.command;
  const isShell = input.tool_name === 'Bash' || input.tool_name === 'PowerShell';
  if (!isShell || typeof command !== 'string' || !command.includes(pattern)) {
    return finish(0, { note: 'no match' });
  }
  const holdMs = Number(policy.holdMs ?? 60_000);
  const key = { session_id: input.session_id, command, cwd: input.cwd };
  appendJsonl(LOG, { phase: 'held', label, event, key, holdMs });
  const deadline = Date.now() + holdMs;
  while (Date.now() < deadline) {
    const releases = readJson(paths.releases, []);
    const hit = releases.find(
      (r) =>
        !r.used &&
        r.session_id === key.session_id &&
        r.command === key.command &&
        r.cwd === key.cwd &&
        (!r.expiresAt || Date.parse(r.expiresAt) > Date.now()),
    );
    if (hit) {
      hit.used = true;
      hit.usedAt = new Date().toISOString();
      writeJsonAtomic(paths.releases, releases);
      if (hit.action === 'deny') {
        return finish(0, {
          stdout: preToolUse('deny', 'The user denied this command.'),
          note: 'denied by user',
        });
      }
      return finish(0, {
        stdout: preToolUse('allow', 'Released once by the user.'),
        note: 'released',
      });
    }
    await sleep(500);
  }
  appendJsonl(LOG, { phase: 'parked', label, event, key });
  return finish(0, {
    stdout: preToolUse('deny', policy.parkReason ?? DEFAULT_PARK_REASON),
    note: 'parked',
  });
}

switch (policy.mode) {
  case 'deny':
    finish(0, { stdout: preToolUse('deny', policy.reason ?? 'Denied by the spike hook.') });
    break;
  case 'deny-match': {
    // PR-block stand-in: deny only shell commands matching the regex `pattern`.
    const command = input.tool_input?.command;
    const re = new RegExp(policy.pattern ?? 'gh(\\.exe)?\\s+pr|glab(\\.exe)?\\s+mr');
    if (typeof command === 'string' && re.test(command)) {
      finish(0, {
        stdout: preToolUse('deny', policy.reason ?? 'Denied by the spike PR-block stand-in.'),
        note: `denied: ${command}`,
      });
    } else finish(0, { note: 'no match' });
    break;
  }
  case 'allow':
    finish(0, { stdout: preToolUse('allow', 'Allowed by the spike hook.') });
    break;
  case 'exit2':
    finish(2, { stderr: policy.reason ?? 'Blocked by the spike hook (exit 2).' });
    break;
  case 'exit1':
    finish(1, { note: 'exit 1 on purpose' });
    break;
  case 'crash':
    appendJsonl(LOG, { phase: 'out', label, event, mode: 'crash', note: 'throwing now' });
    throw new Error('ORCH_SPIKE intentional hook crash');
  case 'sleep':
    await sleep(Number(policy.ms ?? 30_000));
    finish(0, { note: 'woke up' });
    break;
  case 'context':
    finish(0, {
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: event, additionalContext: policy.text ?? '' },
      }),
    });
    break;
  case 'stop-once':
    if (input.stop_hook_active) finish(0, { note: 'stop_hook_active set, letting it stop' });
    else
      finish(2, {
        stderr:
          policy.reason ?? 'Before you stop, run `git status` once more and report the branch.',
      });
    break;
  case 'danger':
    await danger();
    break;
  default:
    finish(0);
}
