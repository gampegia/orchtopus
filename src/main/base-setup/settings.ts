// The per-session settings file and system prompt file (spec section 5). Both live in
// <data>\sessions\<id>\, keep that path for the session's whole life and are rewritten on every
// app start, so an app update changes their contents but never their place.
//
// Hooks run in exec form through cmd.exe, because Claude Code cannot spawn a .cmd without a
// shell (check T6). cmd.exe is named by its full System32 path: a bare name would be looked up in
// the session's working folder first, which is the user's repository.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sessionFiles, type DataPaths } from '../data-folder';
import type { RemoteInfo } from '../git/repo-info';
import { stripCredentials } from '../git/remote-url';
import { renameWithRetry } from '../hooks/install';
import { renderTemplate, type BuildingBlock } from './building-blocks';

export type HookMode = 'state' | 'statusline' | 'pr-block';

export interface HookInvocation {
  command: string;
  args: (mode: HookMode) => string[];
  /** The statusLine command line; Claude Code runs it through a shell. */
  statusLine: string;
}

export interface CommandHook {
  type: 'command';
  command: string;
  args: string[];
  timeout: number;
  async?: true;
  onFailure?: 'block';
}

export interface HookGroup {
  matcher?: string;
  hooks: CommandHook[];
}

export interface ClaudeSettings {
  permissions: { deny: string[] };
  autoMode: { environment: string[] };
  worktree: { bgIsolation: 'none' };
  statusLine: { type: 'command'; command: string };
  hooks: Record<string, HookGroup[]>;
}

export interface SessionSettingsInput {
  launcher: HookInvocation;
  remotes: readonly RemoteInfo[];
  projectName: string;
  /** The deny rule for the user's SSH key folder (check T5). */
  denyHomeSsh: string;
}

export interface SessionFilesInput extends SessionSettingsInput {
  instruction: BuildingBlock;
  branch: string;
  defaultBranch: string;
}

/** Check T5: the home-relative form denies both the Read tool and `cat` through a shell. */
export const DEFAULT_SSH_DENY = 'Read(~/.ssh/**)';

export const STATE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SessionEnd',
  'Notification',
] as const;

const STATE_HOOK_TIMEOUT_S = 5;
const PR_BLOCK_TIMEOUT_S = 10;
const PR_BLOCK_MATCHER = 'Bash|PowerShell';

function systemExe(systemRoot: string, name: string): string {
  return join(systemRoot, 'System32', name);
}

/** How every hook and the status line call the launcher at <data>\bin\ (check T6). */
export function hookInvocation(
  paths: DataPaths,
  systemRoot: string = process.env['SystemRoot'] ?? 'C:\\Windows',
): HookInvocation {
  if (/["\r\n\0]/.test(paths.launcher)) {
    throw new Error('the launcher path cannot be written into a command line');
  }
  return {
    command: systemExe(systemRoot, 'cmd.exe'),
    args: (mode) => ['/d', '/c', paths.launcher, mode],
    statusLine: `"${paths.launcher.replaceAll('\\', '/')}" statusline`,
  };
}

function environmentLine(projectName: string, remotes: readonly RemoteInfo[]): string {
  if (remotes.length === 0) return `Source control: ${projectName} has no git remote.`;
  const urls = remotes.map((remote) => stripCredentials(remote.url)).join(', ');
  return `Source control: the git remotes of ${projectName} are ${urls}; pushing this session's own feature branch there is routine.`;
}

export function buildSessionSettings(input: SessionSettingsInput): ClaudeSettings {
  const { launcher } = input;
  const stateHook = (): CommandHook => ({
    type: 'command',
    command: launcher.command,
    args: launcher.args('state'),
    async: true,
    timeout: STATE_HOOK_TIMEOUT_S,
  });
  const hooks: Record<string, HookGroup[]> = {};
  for (const event of STATE_HOOK_EVENTS) hooks[event] = [{ hooks: [stateHook()] }];
  hooks['PreToolUse']?.push({
    matcher: PR_BLOCK_MATCHER,
    hooks: [
      {
        type: 'command',
        command: launcher.command,
        args: launcher.args('pr-block'),
        timeout: PR_BLOCK_TIMEOUT_S,
        onFailure: 'block',
      },
    ],
  });
  return {
    permissions: {
      deny: ['Read(./.env)', 'Read(./.env.*)', 'Read(./secrets/**)', input.denyHomeSsh],
    },
    autoMode: { environment: ['$defaults', environmentLine(input.projectName, input.remotes)] },
    worktree: { bgIsolation: 'none' },
    statusLine: { type: 'command', command: launcher.statusLine },
    hooks,
  };
}

/** Temp file and rename, so a session that reads the file sees the old or the new one. */
async function replaceText(file: string, text: string): Promise<void> {
  const temp = `${file}.${String(process.pid)}.tmp`;
  try {
    await writeFile(temp, text, 'utf8');
    await renameWithRetry(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

export async function writeSessionFiles(
  paths: DataPaths,
  sessionId: string,
  input: SessionFilesInput,
): Promise<{ settings: string; systemPrompt: string }> {
  const files = sessionFiles(paths, sessionId);
  const settings = buildSessionSettings(input);
  const prompt = renderTemplate(input.instruction.body, {
    branch: input.branch,
    defaultBranch: input.defaultBranch,
  });
  await mkdir(files.dir, { recursive: true });
  await replaceText(files.settings, `${JSON.stringify(settings, null, 2)}\n`);
  await replaceText(files.systemPrompt, prompt);
  return { settings: files.settings, systemPrompt: files.systemPrompt };
}
