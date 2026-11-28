// Writes the session settings variants to <scratch>\mods-vs-hooks\settings\ and copies the test
// mods to <scratch>\mods-vs-hooks\plugins\ (so nothing Claude Code writes next to a mod lands in
// the repo). Usage: node make-settings.mjs
import { cpSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, fwd, HERE, paths } from './lib.mjs';

const MODS = [
  'mod-result',
  'mod-check-allow',
  'mod-deny',
  'mod-next',
  'mod-exec',
  'plugin-hook-allow',
];

const hook = (label, extra = {}) => ({
  type: 'command',
  command: process.execPath,
  args: [join(HERE, 'hook.mjs'), '--label', label],
  timeout: 10,
  ...extra,
});

/** Close to what the M1 app writes: state hooks, PR block, status line, deny rules. */
function orchSettings() {
  // Synchronous here, so the log shows the order; M1 sets `async: true` on its state hooks.
  const state = () => ({ hooks: [hook('state')] });
  return {
    permissions: { deny: ['Read(./.env)', 'Bash(echo ORCH_DENYRULE*)'] },
    statusLine: {
      type: 'command',
      command: `"${fwd(process.execPath)}" "${fwd(join(HERE, 'statusline.mjs'))}"`,
    },
    hooks: {
      SessionStart: [state()],
      UserPromptSubmit: [state()],
      PreToolUse: [
        state(),
        { matcher: 'Bash|PowerShell', hooks: [hook('pr-block', { onFailure: 'block' })] },
      ],
      PostToolUse: [state()],
      Stop: [state()],
    },
  };
}

const variants = {
  /** Only a deny rule, no hooks: isolates rule against mod. */
  'deny-only': { permissions: { deny: ['Bash(echo ORCH_DENYRULE*)'] } },
  orch: orchSettings(),
  'orch-disable-hooks': { ...orchSettings(), disableAllHooks: true },
  /** The skills-dir copy of mod-check-allow switched off (run.mjs --skills-dir-mod). */
  'orch-disable-skills-dir': {
    ...orchSettings(),
    enabledPlugins: { 'mod-check-allow@skills-dir': false },
  },
  'orch-disable-mods': {
    ...orchSettings(),
    enabledPlugins: Object.fromEntries(MODS.map((m) => [`${m}@inline`, false])),
  },
};

ensureDir(paths.settings);
ensureDir(paths.logs);
for (const [name, value] of Object.entries(variants)) {
  writeFileSync(join(paths.settings, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}
rmSync(paths.plugins, { recursive: true, force: true });
for (const mod of MODS)
  cpSync(join(HERE, 'mods', mod), join(paths.plugins, mod), { recursive: true });
console.log(`settings: ${Object.keys(variants).join(', ')} in ${paths.settings}`);
console.log(`mods: ${MODS.join(', ')} in ${paths.plugins}`);
