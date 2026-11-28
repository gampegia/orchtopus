// Spike mod: observes every Bash call and passes it on unchanged.
export function register(on) {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    $.ui.log(`mod-next saw: ${String(e.command ?? '')}`, { to: 'debug' });
    return next(e);
  });
}
