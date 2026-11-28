import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeConfigPaths, type ClaudeConfigPaths } from '../claude/claude-home';
import { createTempRepo, git, isolatedGitEnv, type TempRepo } from '../test-helpers/temp-repo';
import { runSetupCheck, SETUP_ITEM_IDS, type SetupCheckInput, type SetupItem } from './setup-check';

let repo: TempRepo;
let claudeDir: string;
let claudePaths: ClaudeConfigPaths;

let initial: string;

// One repository for the file: git spawns are slow on Windows, so each test resets it instead.
beforeAll(async () => {
  for (const [key, value] of Object.entries(isolatedGitEnv())) vi.stubEnv(key, value);
  repo = await createTempRepo();
  initial = git(repo.root, ['rev-parse', 'HEAD']);
});
afterAll(async () => {
  await repo.cleanup();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  git(repo.root, ['reset', '--quiet', '--hard', initial]);
  rmSync(join(repo.root, '.claude'), { recursive: true, force: true });
  rmSync(join(repo.root, 'CLAUDE.md'), { recursive: true, force: true });
  claudeDir = mkdtempSync(join(tmpdir(), 'orchtopus-claude-home-'));
  claudePaths = claudeConfigPaths({ CLAUDE_CONFIG_DIR: claudeDir }, claudeDir);
  trust(true);
});
afterEach(() => {
  rmSync(claudeDir, { recursive: true, force: true });
});

function trust(value: boolean | null): void {
  const entry = value === null ? {} : { hasTrustDialogAccepted: value };
  writeFileSync(
    claudePaths.globalConfig,
    JSON.stringify({ projects: { [repo.root.replace(/\\/g, '/')]: entry } }),
  );
}

function userSettings(value: unknown): void {
  writeFileSync(claudePaths.userSettings, JSON.stringify(value));
}

function repoFile(rel: string, content: string): void {
  const file = join(repo.root, rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
}

const lines = (n: number, text = 'Use the npm scripts.'): string =>
  Array.from({ length: n }, () => text).join('\n') + '\n';

const GOOD_USER = {
  permissions: { deny: ['Read(./.env)', 'Read(./.env.*)', 'Read(./secrets/**)'] },
  enabledPlugins: { 'superpowers@claude-plugins-official': true },
};

function input(overrides: Partial<SetupCheckInput> = {}): SetupCheckInput {
  return {
    root: repo.root,
    checkCommands: { test: 'npm test', lint: null, typecheck: null },
    cli: { found: true, version: '2.1.332', supported: true },
    claudePaths,
    env: {},
    ...overrides,
  };
}

async function item(id: SetupItem['id'], overrides?: Partial<SetupCheckInput>): Promise<SetupItem> {
  const items = await runSetupCheck(input(overrides));
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`missing item ${id}`);
  return found;
}

describe('runSetupCheck', () => {
  it('returns the items in the fixed order', async () => {
    userSettings(GOOD_USER);
    const items = await runSetupCheck(input());
    expect(items.map((i) => i.id)).toEqual([
      'claude-version',
      'trust',
      'check-command',
      'claude-md-length',
      'claude-md-emphasis',
      'secret-deny',
      'superpowers',
      'auto-memory',
      'default-mode',
      'skill-length',
      'committed-personal-settings',
      'prompt-audit',
    ]);
    expect(SETUP_ITEM_IDS).toEqual(items.map((i) => i.id));
    // A clean setup: everything ok except the pointer.
    for (const i of items) expect(i.status, i.id).toBe(i.id === 'prompt-audit' ? 'info' : 'ok');
  });

  describe('claude-version', () => {
    it('ok when supported', async () => {
      expect((await item('claude-version')).status).toBe('ok');
    });
    it('problem with claude update when too old', async () => {
      const i = await item('claude-version', {
        cli: { found: true, version: '2.1.200', supported: false },
      });
      expect(i).toMatchObject({ status: 'problem', fix: 'claude update' });
      expect(i.detail).toContain('2.1.200');
      expect(i.detail).toContain('2.1.302');
    });
    it('problem when the CLI is missing', async () => {
      const i = await item('claude-version', {
        cli: { found: false, version: null, supported: false },
      });
      expect(i).toMatchObject({ status: 'problem', fix: 'claude update' });
    });
  });

  describe('trust', () => {
    it('ok when trusted', async () => {
      expect((await item('trust')).status).toBe('ok');
    });
    it('problem when not trusted', async () => {
      trust(false);
      const i = await item('trust');
      expect(i.status).toBe('problem');
      expect(i.detail).toContain('Trust in Claude Code');
    });
    it('problem when unknown', async () => {
      trust(null);
      expect((await item('trust')).status).toBe('problem');
      rmSync(claudePaths.globalConfig);
      expect((await item('trust')).status).toBe('problem');
    });
  });

  describe('check-command', () => {
    it('ok with one command', async () => {
      expect((await item('check-command')).status).toBe('ok');
    });
    it('hint without any', async () => {
      const i = await item('check-command', {
        checkCommands: { test: null, lint: null, typecheck: null },
      });
      expect(i.status).toBe('hint');
    });
  });

  describe('claude-md-length', () => {
    it('ok under 200 lines', async () => {
      repoFile('CLAUDE.md', lines(199));
      writeFileSync(claudePaths.userClaudeMd, lines(10));
      expect((await item('claude-md-length')).status).toBe('ok');
    });
    it('hint naming each file with 200 lines or more', async () => {
      repoFile('CLAUDE.md', lines(200));
      repoFile('.claude/CLAUDE.md', lines(250));
      writeFileSync(claudePaths.userClaudeMd, lines(300));
      const i = await item('claude-md-length');
      expect(i.status).toBe('hint');
      expect(i.detail).toContain('CLAUDE.md (200 lines)');
      expect(i.detail).toContain('.claude/CLAUDE.md (250 lines)');
      expect(i.detail).toContain(`${claudePaths.userClaudeMd} (300 lines)`);
    });
  });

  describe('claude-md-emphasis', () => {
    it('ok with emphasis words in lower case only', async () => {
      repoFile('CLAUDE.md', 'It is important to run the tests. You must not skip them.\n');
      expect((await item('claude-md-emphasis')).status).toBe('ok');
    });
    it('hint for each capital emphasis word', async () => {
      for (const word of ['IMPORTANT', 'YOU MUST', 'MUST', 'NEVER', 'ALWAYS', 'CRITICAL']) {
        repoFile('CLAUDE.md', `${word}: run npm test before a commit.\n`);
        const i = await item('claude-md-emphasis');
        expect(i.status, word).toBe('hint');
        expect(i.detail).toContain('CLAUDE.md');
      }
    });
    it('checks the user CLAUDE.md too', async () => {
      writeFileSync(claudePaths.userClaudeMd, 'NEVER push to main.\n');
      const i = await item('claude-md-emphasis');
      expect(i.status).toBe('hint');
      expect(i.detail).toContain(claudePaths.userClaudeMd);
    });
  });

  describe('secret-deny', () => {
    it('ok when user settings cover all three', async () => {
      userSettings(GOOD_USER);
      expect((await item('secret-deny')).status).toBe('ok');
    });
    it('ok when project and local settings share the rules', async () => {
      userSettings({ enabledPlugins: GOOD_USER.enabledPlugins });
      repoFile('.claude/settings.json', JSON.stringify({ permissions: { deny: ['Read(.env*)'] } }));
      repoFile(
        '.claude/settings.local.json',
        JSON.stringify({ permissions: { deny: ['Read(**/secrets/**)'] } }),
      );
      expect((await item('secret-deny')).status).toBe('ok');
    });
    it('hint naming the missing patterns', async () => {
      userSettings({ permissions: { deny: ['Read(./.env)'] } });
      const i = await item('secret-deny');
      expect(i.status).toBe('hint');
      expect(i.detail).toContain('.env.*');
      expect(i.detail).toContain('secrets/**');
      expect(i.detail).toContain('Orchtopus sessions get these rules anyway');
      expect(i.fix).toContain('Read(./secrets/**)');
    });
  });

  describe('superpowers', () => {
    it('ok when enabled in user settings', async () => {
      userSettings(GOOD_USER);
      expect((await item('superpowers')).status).toBe('ok');
    });
    it('hint with the install command when missing or disabled', async () => {
      const fix = 'claude plugin install superpowers@claude-plugins-official';
      expect(await item('superpowers')).toMatchObject({ status: 'hint', fix });
      userSettings({ enabledPlugins: { 'superpowers@claude-plugins-official': false } });
      expect(await item('superpowers')).toMatchObject({ status: 'hint', fix });
    });
  });

  describe('auto-memory', () => {
    it('ok by default', async () => {
      expect((await item('auto-memory')).status).toBe('ok');
    });
    it('hint when switched off in user settings', async () => {
      userSettings({ autoMemoryEnabled: false });
      expect((await item('auto-memory')).status).toBe('hint');
    });
    it('hint when switched off in project settings', async () => {
      repoFile('.claude/settings.json', JSON.stringify({ autoMemoryEnabled: false }));
      const i = await item('auto-memory');
      expect(i.status).toBe('hint');
      expect(i.detail).toContain('.claude/settings.json');
    });
    it('hint when CLAUDE_CODE_DISABLE_AUTO_MEMORY is set', async () => {
      const i = await item('auto-memory', { env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } });
      expect(i.status).toBe('hint');
      expect(i.detail).toContain('CLAUDE_CODE_DISABLE_AUTO_MEMORY');
    });
  });

  describe('default-mode', () => {
    it('ok for another default mode', async () => {
      userSettings({ permissions: { defaultMode: 'acceptEdits' } });
      expect((await item('default-mode')).status).toBe('ok');
    });
    it('problem for bypassPermissions in user settings', async () => {
      userSettings({ permissions: { defaultMode: 'bypassPermissions' } });
      expect((await item('default-mode')).status).toBe('problem');
    });
  });

  describe('skill-length', () => {
    it('ok under 500 lines or without skills', async () => {
      expect((await item('skill-length')).status).toBe('ok');
      repoFile('.claude/skills/report-export/SKILL.md', lines(499));
      expect((await item('skill-length')).status).toBe('ok');
    });
    it('hint naming each skill with 500 lines or more', async () => {
      repoFile('.claude/skills/report-export/SKILL.md', lines(500));
      repoFile('.claude/skills/image-resize/SKILL.md', lines(20));
      const i = await item('skill-length');
      expect(i.status).toBe('hint');
      expect(i.detail).toContain('.claude/skills/report-export/SKILL.md (500 lines)');
      expect(i.detail).not.toContain('image-resize');
    });
  });

  describe('committed-personal-settings', () => {
    it('ok when the project settings are untracked or hold no personal keys', async () => {
      repoFile('.claude/settings.json', JSON.stringify({ model: 'opus' }));
      expect((await item('committed-personal-settings')).status).toBe('ok');
      repoFile('.claude/settings.json', JSON.stringify({ permissions: { deny: [] } }));
      git(repo.root, ['add', '.claude/settings.json']);
      git(repo.root, ['commit', '--quiet', '-m', 'project settings']);
      expect((await item('committed-personal-settings')).status).toBe('ok');
    });
    it('hint naming the personal keys in a tracked file', async () => {
      repoFile(
        '.claude/settings.json',
        JSON.stringify({
          model: 'opus',
          effortLevel: 'high',
          permissions: { defaultMode: 'auto' },
        }),
      );
      git(repo.root, ['add', '.claude/settings.json']);
      git(repo.root, ['commit', '--quiet', '-m', 'project settings']);
      const i = await item('committed-personal-settings');
      expect(i.status).toBe('hint');
      expect(i.detail).toContain('permissions.defaultMode');
      expect(i.detail).toContain('model');
      expect(i.detail).toContain('effortLevel');
    });
  });

  it('prompt-audit is always information', async () => {
    const i = await item('prompt-audit');
    expect(i.status).toBe('info');
    expect(i.detail).toContain('/doctor prompt-audit');
  });

  it('an unreadable user settings file gives hints, not a throw', async () => {
    writeFileSync(claudePaths.userSettings, '{ not json');
    const items = await runSetupCheck(input());
    for (const id of ['secret-deny', 'superpowers', 'auto-memory', 'default-mode'] as const) {
      const i = items.find((x) => x.id === id);
      expect(i?.status, id).toBe('hint');
      expect(i?.detail, id).toContain('could not be read');
    }
  });

  it('an unreadable CLAUDE.md or skills folder gives hints, not a throw', async () => {
    // A folder where a file is expected cannot be read as text.
    mkdirSync(join(repo.root, 'CLAUDE.md'));
    repoFile('.claude/skills', 'not a folder');
    const items = await runSetupCheck(input());
    expect(items.find((x) => x.id === 'claude-md-length')?.status).toBe('hint');
    expect(items.find((x) => x.id === 'claude-md-emphasis')?.status).toBe('hint');
    expect(items.find((x) => x.id === 'skill-length')?.status).toBe('hint');
  });
});
