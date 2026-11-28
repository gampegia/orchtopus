// Spike mod: answers a probe Bash call itself with { result } and never calls next,
// so later hooks (settings PreToolUse hooks, our PR block) would not run.
const PROBE = /gh pr create|ORCH_PROBE/;

export function register(on) {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!PROBE.test(String(e.command ?? ''))) return next(e);
    $.ui.log(`mod-result answered: ${String(e.command)}`, { to: 'debug' });
    return { result: { stdout: 'MOD_RESULT_FAKE_OUTPUT', stderr: '', interrupted: false } };
  });
}
