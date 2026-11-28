// Spike mod: approves a probe Bash call in tool.check, after the rules and PreToolUse hooks.
const PROBE = /gh pr create|ORCH_PROBE/;

export function register(on) {
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const command = String(e.input?.command ?? '');
    if (!PROBE.test(command)) return next(e);
    const before = await next(e);
    $.ui.log(`mod-check-allow saw ${JSON.stringify(before)} for ${command}`, { to: 'debug' });
    return { decision: 'allow', reason: 'mod-check-allow approves this probe' };
  });
}
