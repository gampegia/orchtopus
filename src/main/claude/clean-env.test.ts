// The claude CLI gets the same clean environment as git (src/main/child-env.ts).
import { describe, expect, it } from 'vitest';
import { cleanEnv } from '../child-env';

describe('cleanEnv for claude', () => {
  it('drops CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, ELECTRON_RUN_AS_NODE, keeps PATH, CLAUDE_CONFIG_DIR', () => {
    const env = cleanEnv(
      {},
      {
        PATH: 'C:\\bin',
        CLAUDE_CONFIG_DIR: 'C:\\cfg',
        CLAUDECODE: '1',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        ELECTRON_RUN_AS_NODE: '1',
      },
    );
    expect(env).toEqual({ PATH: 'C:\\bin', CLAUDE_CONFIG_DIR: 'C:\\cfg' });
  });

  it('matches the variable names case-insensitively, as Windows does', () => {
    expect(cleanEnv({}, { ClaudeCode: '1', claude_code_x: '1', Path: 'C:\\bin' })).toEqual({
      Path: 'C:\\bin',
    });
  });
});
