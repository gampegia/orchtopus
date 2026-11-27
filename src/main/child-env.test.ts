import { describe, expect, it } from 'vitest';
import { cleanEnv } from './child-env';

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
});
