// Spike mod: a stand-in for a holding mod such as Blast Radius. Refuses a probe Bash call
// in tool.call without calling next.
const PROBE = /ORCH_PROBE|git reset --hard/;

export function register(on) {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!PROBE.test(String(e.command ?? ''))) return next(e);
    return { deny: 'MOD_DENY: mod-deny refused this command. Do not retry it.' };
  });
}
