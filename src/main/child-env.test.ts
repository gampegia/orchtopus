import { describe, expect, it } from 'vitest';
import { claudeEnv, cleanEnv } from './child-env';

describe('cleanEnv', () => {
  it('drops Claude Code, Electron and API redirect variables and keeps the rest', () => {
    const env = cleanEnv(
      { GIT_TERMINAL_PROMPT: '0' },
      {
        PATH: 'C:\\bin',
        CLAUDECODE: '1',
        CLAUDE_PID: '42',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        CLAUDE_AGENT_SDK_VERSION: '1',
        CLAUDE_PREVIEW_URL: 'x',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
        ELECTRON_RUN_AS_NODE: '1',
        CLAUDE_CONFIG_DIR: 'C:\\cfg',
      },
    );
    expect(env).toEqual({
      PATH: 'C:\\bin',
      CLAUDE_CONFIG_DIR: 'C:\\cfg',
      GIT_TERMINAL_PROMPT: '0',
    });
  });

  it('drops variables that point git at another repository', () => {
    const env = cleanEnv(
      {},
      {
        PATH: 'C:\\bin',
        GIT_DIR: 'C:\\other\\.git',
        GIT_WORK_TREE: 'C:\\other',
        GIT_INDEX_FILE: 'C:\\other\\.git\\index',
        GIT_COMMON_DIR: 'C:\\other\\.git',
        GIT_TERMINAL_PROMPT: '0',
      },
    );
    expect(env).toEqual({ PATH: 'C:\\bin', GIT_TERMINAL_PROMPT: '0' });
  });

  it('matches the variable names case-insensitively, as Windows does', () => {
    expect(
      cleanEnv({}, { ClaudeCode: '1', claude_code_x: '1', Git_Dir: 'C:\\x', Path: 'C:\\bin' }),
    ).toEqual({ Path: 'C:\\bin' });
  });
});

describe('claudeEnv', () => {
  it('leaves out NoDefaultCurrentDirectoryInExePath that git and where keep', () => {
    const base = { PATH: 'C:\bin', NoDefaultCurrentDirectoryInExePath: '1', CLAUDECODE: '1' };
    expect(cleanEnv({}, base)).toEqual({ PATH: 'C:\bin', NoDefaultCurrentDirectoryInExePath: '1' });
    expect(claudeEnv(base)).toEqual({ PATH: 'C:\bin' });
  });

  it('matches the name case-insensitively', () => {
    expect(claudeEnv({ Path: 'C:\bin', nodefaultcurrentdirectoryinexepath: '1' })).toEqual({
      Path: 'C:\bin',
    });
  });

  it('reads the parent process environment by default', () => {
    const key = 'NoDefaultCurrentDirectoryInExePath';
    const has = (env: Record<string, string>): boolean =>
      Object.keys(env).some((k) => k.toLowerCase() === key.toLowerCase());
    const before = process.env[key];
    process.env[key] = '1';
    try {
      expect(has(cleanEnv())).toBe(true);
      expect(has(claudeEnv())).toBe(false);
    } finally {
      if (before === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = before;
    }
  });
});
