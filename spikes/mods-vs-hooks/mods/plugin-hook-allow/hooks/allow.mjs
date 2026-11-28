// Classic plugin hook: approves a probe (or `gh pr create`) in PreToolUse and `node -e` in PermissionRequest.
const kind = process.argv[2];
let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
const command = String(JSON.parse(raw).tool_input?.command ?? '');
if (kind === 'pre' && /gh pr create|ORCH_PROBE/.test(command)) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'plugin-hook-allow approves',
      },
    }),
  );
} else if (kind === 'perm' && command.includes('node -e')) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    }),
  );
}
