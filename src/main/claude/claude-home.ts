// Where Claude Code keeps its user-level files. Orchtopus reads these for the
// setup check and the trust value only; it never writes them.
import { join } from 'node:path';

export interface ClaudeConfigPaths {
  /** `.claude.json`: workspace trust lives here. */
  globalConfig: string;
  userSettings: string;
  userClaudeMd: string;
  userSkills: string;
}

export function claudeConfigPaths(env: NodeJS.ProcessEnv, home: string): ClaudeConfigPaths {
  const override = env.CLAUDE_CONFIG_DIR?.trim();
  const dir = override === undefined || override === '' ? join(home, '.claude') : override;
  return {
    globalConfig:
      override === undefined || override === ''
        ? join(home, '.claude.json')
        : join(dir, '.claude.json'),
    userSettings: join(dir, 'settings.json'),
    userClaudeMd: join(dir, 'CLAUDE.md'),
    userSkills: join(dir, 'skills'),
  };
}
