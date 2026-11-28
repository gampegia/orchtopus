// Command hook (exec form) standing in for the Orchtopus session hooks.
//   --label state     logs the input, answers nothing (like the async state hook)
//   --label pr-block  logs the input; denies a Bash/PowerShell call that matches PR_BLOCK_PROBE
//                     with the same output shape as the M1 PR block
import { appendJsonl, parseArgs, paths, PR_BLOCK_PROBE } from './lib.mjs';

const { label = 'state' } = parseArgs(process.argv.slice(2));

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw);
} catch {
  input = { unparsed: raw };
}

const command = String(input.tool_input?.command ?? '');
const deny = label === 'pr-block' && PR_BLOCK_PROBE.test(command);
appendJsonl(paths.hookLog, {
  at: new Date().toISOString(),
  label,
  event: input.hook_event_name,
  session: input.session_id,
  command: command || undefined,
  decision: deny ? 'deny' : undefined,
  // SessionStart: keep the whole input, to see whether it names plugins or mods.
  input: input.hook_event_name === 'SessionStart' ? input : undefined,
  pluginEnv: Object.keys(process.env).filter((k) => /PLUGIN|MOD/i.test(k)),
});

if (deny) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'ORCH_PR_BLOCK: Orchtopus does not let sessions create or merge pull requests. Do not retry.',
      },
    }),
  );
}
