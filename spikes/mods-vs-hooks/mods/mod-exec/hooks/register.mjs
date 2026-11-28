// Spike mod: runs a probe call itself through $.process.run and returns the real output,
// without calling next. Side effect for the probe: a git tag in the test project.
const PROBE = /ORCH_PROBE/;

export function register(on) {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!PROBE.test(String(e.command ?? ''))) return next(e);
    const run = await $.process.run(['git', 'tag', 'orch-mod-exec-probe']);
    const tags = await $.process.run(['git', 'tag', '--list']);
    return {
      result: {
        stdout: `mod-exec ran git tag (exit ${run.exitCode}); tags: ${tags.stdout}`,
        stderr: '',
        interrupted: false,
      },
    };
  });
}
