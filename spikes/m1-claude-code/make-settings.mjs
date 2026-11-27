// Writes a settings file for `claude --settings` into the scratch config folder.
//
// Usage: node make-settings.mjs [--name full] [--compat] [--allow-env-read] [--deny-env-bash]
//          [--no-bg-isolation] [--perm-timeout 600] [--danger-timeout 120]
//          [--fail-timeout 10] [--refresh 0]
//
// --compat leaves out `onFailure` (unknown before Claude Code 2.1.295; an
// invalid settings file is ignored silently in -p mode).
//
// Every hook logs its input. What a labelled hook does beyond logging is set
// at run time in policy.json (see hook.mjs and receiver.mjs).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HARNESS_DIR, RECEIVER_PORT, fwd, parseArgs, paths, writeJson } from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));
const name = String(args.name ?? 'full');
const compat = Boolean(args.compat);
const token = readFileSync(paths.token, 'utf8').trim();
const hookScript = fwd(join(HARNESS_DIR, 'hook.mjs'));
const statusScript = fwd(join(HARNESS_DIR, 'statusline.mjs'));

const cmd = (label, extra = {}) => {
  const h = { type: 'command', command: process.execPath, args: [hookScript, '--label', label] };
  const { onFailure, ...rest } = extra;
  if (onFailure && !compat) Object.assign(h, { onFailure });
  return Object.assign(h, rest);
};

const http = (extra = {}) => ({
  type: 'http',
  url: `http://127.0.0.1:${RECEIVER_PORT}/hook`,
  headers: { Authorization: `Bearer ${token}`, 'X-Orch-Env-Token': '$ORCH_SPIKE_TOKEN' },
  allowedEnvVars: ['ORCH_SPIKE_TOKEN'],
  ...extra,
});

const settings = {
  permissions: {
    deny: [
      'Read(./.env)',
      'Read(./.env.*)',
      'Read(./secrets/**)',
      ...(args['deny-env-bash'] ? ['Bash(cat .env)'] : []),
    ],
    ...(args['allow-env-read'] ? { allow: ['Read(./.env)', 'Bash(cat .env)'] } : {}),
  },
  autoMode: {
    environment: [
      '$defaults',
      `Source control: the only git remote of acme-app is the local bare repository ${fwd(paths.remote)}; pushing feature branches there is routine.`,
    ],
  },
  statusLine: {
    type: 'command',
    command: `"${fwd(process.execPath)}" "${statusScript}"`,
    ...(Number(args.refresh) > 0 ? { refreshInterval: Number(args.refresh) } : {}),
  },
  ...(args['no-bg-isolation'] ? { worktree: { bgIsolation: 'none' } } : {}),
  hooks: {
    SessionStart: [{ hooks: [cmd('session-start')] }],
    UserPromptSubmit: [{ hooks: [cmd('prompt-submit'), http({ timeout: 10 })] }],
    UserPromptExpansion: [{ hooks: [cmd('prompt-expansion')] }],
    PreToolUse: [
      { hooks: [cmd('pre-tool')] },
      {
        matcher: 'Bash|PowerShell',
        hooks: [
          cmd('danger', { timeout: Number(args['danger-timeout'] ?? 120), onFailure: 'block' }),
          cmd('fail', { timeout: Number(args['fail-timeout'] ?? 10) }),
          cmd('failblock', { timeout: Number(args['fail-timeout'] ?? 10), onFailure: 'block' }),
        ],
      },
    ],
    PostToolUse: [{ hooks: [cmd('post-tool'), http({ timeout: 10 })] }],
    PermissionRequest: [
      {
        hooks: [http({ timeout: Number(args['perm-timeout'] ?? 600) }), cmd('perm-request')],
      },
    ],
    PermissionDenied: [{ hooks: [cmd('perm-denied')] }],
    Notification: [{ hooks: [cmd('notification')] }],
    Stop: [{ hooks: [cmd('stop')] }],
    PreCompact: [{ hooks: [cmd('pre-compact')] }],
    SessionEnd: [{ hooks: [cmd('session-end')] }],
  },
};

const file = join(paths.settings, `${name}.json`);
writeJson(file, settings);
console.log(file);
