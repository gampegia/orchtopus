import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDataPaths, sessionFiles, type DataPaths } from '../data-folder';
import { makeTempDir, type TempDir } from '../store/testing';
import {
  buildSessionSettings,
  DEFAULT_SSH_DENY,
  hookInvocation,
  STATE_HOOK_EVENTS,
  writeSessionFiles,
  type ClaudeSettings,
  type CommandHook,
  type SessionSettingsInput,
} from './settings';

const SECRET = 'ghp_0123456789abcdefSECRET';

let temp: TempDir;
let paths: DataPaths;

beforeEach(() => {
  temp = makeTempDir();
  paths = resolveDataPaths({ env: { ORCHTOPUS_DATA_DIR: temp.dir }, appData: temp.dir });
});

afterEach(() => {
  temp.remove();
});

function input(overrides: Partial<SessionSettingsInput> = {}): SessionSettingsInput {
  return {
    launcher: hookInvocation(paths, 'C:\\Windows'),
    remotes: [
      { name: 'origin', url: 'https://github.com/acme/acme-app.git' },
      { name: 'upstream', url: 'git@gitlab.com:acme/acme-app.git' },
    ],
    projectName: 'acme-app',
    denyHomeSsh: DEFAULT_SSH_DENY,
    ...overrides,
  };
}

function allHooks(settings: ClaudeSettings): CommandHook[] {
  return Object.values(settings.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks));
}

describe('buildSessionSettings', () => {
  it('has the four deny rules', () => {
    expect(buildSessionSettings(input()).permissions.deny).toEqual([
      'Read(./.env)',
      'Read(./.env.*)',
      'Read(./secrets/**)',
      'Read(~/.ssh/**)',
    ]);
  });

  it('autoMode environment starts with $defaults and names stripped remotes', () => {
    const settings = buildSessionSettings(input());
    expect(settings.autoMode.environment).toEqual([
      '$defaults',
      "Source control: the git remotes of acme-app are https://github.com/acme/acme-app.git, git@gitlab.com:acme/acme-app.git; pushing this session's own feature branch there is routine.",
    ]);
  });

  it('names a project without remotes', () => {
    const settings = buildSessionSettings(input({ remotes: [] }));
    expect(settings.autoMode.environment).toEqual([
      '$defaults',
      'Source control: acme-app has no git remote.',
    ]);
  });

  it('never contains a credential', () => {
    const settings = buildSessionSettings(
      input({
        remotes: [
          { name: 'origin', url: `https://x-access-token:${SECRET}@github.com/acme/acme-app.git` },
          { name: 'mirror', url: `https://gitlab.com/acme/acme-app.git?private_token=${SECRET}` },
          { name: 'ssh', url: `ssh://git:${SECRET}@example.com/acme/acme-app.git` },
        ],
      }),
    );
    const text = JSON.stringify(settings);
    expect(text).not.toContain(SECRET);
    expect(text).toContain('https://github.com/acme/acme-app.git');
  });

  it('state hooks have no onFailure and run async', () => {
    const settings = buildSessionSettings(input());
    for (const event of STATE_HOOK_EVENTS) {
      const groups = settings.hooks[event];
      expect(groups, event).toBeDefined();
      const state = groups?.[0];
      expect(state?.matcher).toBeUndefined();
      expect(state?.hooks).toEqual([
        {
          type: 'command',
          command: 'C:\\Windows\\System32\\cmd.exe',
          args: ['/d', '/c', paths.launcher, 'state'],
          async: true,
          timeout: 5,
        },
      ]);
    }
    expect(Object.keys(settings.hooks).sort()).toEqual([...STATE_HOOK_EVENTS].sort());
  });

  it('PR block hook is PreToolUse on Bash|PowerShell with onFailure block', () => {
    const groups = buildSessionSettings(input()).hooks['PreToolUse'] ?? [];
    expect(groups).toHaveLength(2);
    expect(groups[1]).toEqual({
      matcher: 'Bash|PowerShell',
      hooks: [
        {
          type: 'command',
          command: 'C:\\Windows\\System32\\cmd.exe',
          args: ['/d', '/c', paths.launcher, 'pr-block'],
          timeout: 10,
          onFailure: 'block',
        },
      ],
    });
  });

  it('every hook calls the launcher at its fixed path', () => {
    const settings = buildSessionSettings(input());
    const hooks = allHooks(settings);
    expect(hooks).toHaveLength(8);
    for (const hook of hooks) {
      expect(hook.command).toBe(join('C:\\Windows', 'System32', 'cmd.exe'));
      expect(hook.args.slice(0, 3)).toEqual([
        '/d',
        '/c',
        join(temp.dir, 'bin', 'orchtopus-hook.cmd'),
      ]);
    }
    expect(settings.statusLine).toEqual({
      type: 'command',
      command: `"${paths.launcher.replaceAll('\\', '/')}" statusline`,
    });
  });

  it('sets worktree.bgIsolation none', () => {
    expect(buildSessionSettings(input()).worktree).toEqual({ bgIsolation: 'none' });
  });
});

describe('hookInvocation', () => {
  it('refuses a launcher path the status line shell cannot quote', () => {
    const broken = { ...paths, launcher: 'C:\\data "x"\\bin\\orchtopus-hook.cmd' };
    expect(() => hookInvocation(broken, 'C:\\Windows')).toThrow(/launcher/);
  });
});

describe('writeSessionFiles', () => {
  const block = {
    version: '1.0.0',
    body: 'Work on {{branch}}. Do not push to {{defaultBranch}}.\n',
  };

  it('writeSessionFiles writes both files into sessions\\<id>\\ and overwrites them', async () => {
    const files = sessionFiles(paths, 'sess-1');
    const first = await writeSessionFiles(paths, 'sess-1', {
      ...input(),
      instruction: block,
      branch: 'upload-fix',
      defaultBranch: 'main',
    });
    expect(first).toEqual({ settings: files.settings, systemPrompt: files.systemPrompt });
    const settings = JSON.parse(readFileSync(files.settings, 'utf8')) as ClaudeSettings;
    expect(settings).toEqual(buildSessionSettings(input()));
    expect(readFileSync(files.systemPrompt, 'utf8')).toBe(
      'Work on upload-fix. Do not push to main.\n',
    );

    await writeSessionFiles(paths, 'sess-1', {
      ...input({ projectName: 'acme-web', remotes: [] }),
      instruction: block,
      branch: 'report-export',
      defaultBranch: 'develop',
    });
    const again = JSON.parse(readFileSync(files.settings, 'utf8')) as ClaudeSettings;
    expect(again.autoMode.environment[1]).toBe('Source control: acme-web has no git remote.');
    expect(readFileSync(files.systemPrompt, 'utf8')).toBe(
      'Work on report-export. Do not push to develop.\n',
    );
  });

  it('refuses an unsafe session id', async () => {
    await expect(
      writeSessionFiles(paths, '../x', {
        ...input(),
        instruction: block,
        branch: 'upload-fix',
        defaultBranch: 'main',
      }),
    ).rejects.toThrow(/session id/);
  });
});
