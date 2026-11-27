import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeConfigPaths } from './claude-home';

const home = join('C:', 'Users', 'demo user é');

describe('claudeConfigPaths', () => {
  it('uses the default paths under home', () => {
    expect(claudeConfigPaths({}, home)).toEqual({
      globalConfig: join(home, '.claude.json'),
      userSettings: join(home, '.claude', 'settings.json'),
      userClaudeMd: join(home, '.claude', 'CLAUDE.md'),
      userSkills: join(home, '.claude', 'skills'),
    });
  });

  it('uses CLAUDE_CONFIG_DIR for every path when set', () => {
    const dir = join('D:', 'claude-config');
    expect(claudeConfigPaths({ CLAUDE_CONFIG_DIR: dir }, home)).toEqual({
      globalConfig: join(dir, '.claude.json'),
      userSettings: join(dir, 'settings.json'),
      userClaudeMd: join(dir, 'CLAUDE.md'),
      userSkills: join(dir, 'skills'),
    });
  });

  it('ignores an empty CLAUDE_CONFIG_DIR', () => {
    expect(claudeConfigPaths({ CLAUDE_CONFIG_DIR: '  ' }, home).globalConfig).toBe(
      join(home, '.claude.json'),
    );
  });
});
