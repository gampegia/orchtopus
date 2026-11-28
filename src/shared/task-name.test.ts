import { describe, expect, it } from 'vitest';
import { DEFAULT_BRANCH_PREFIX, deriveBranch, validateTaskName } from './task-name';

describe('validateTaskName', () => {
  it.each(['upload-fix', 'i18n-de', 'a', 'x'.repeat(48)])('accepts %s', (name) => {
    expect(validateTaskName(name)).toBeNull();
  });

  it.each(['Upload-Fix', 'upload_fix', '-x', 'x-', 'a--b', '', 'x'.repeat(49), 'a b', 'a/b'])(
    'rejects %j',
    (name) => {
      expect(validateTaskName(name)).toEqual(expect.any(String));
    },
  );
});

describe('deriveBranch', () => {
  it('prefixes the task name', () => {
    expect(DEFAULT_BRANCH_PREFIX).toBe('orch/');
    expect(deriveBranch(DEFAULT_BRANCH_PREFIX, 'upload-fix')).toBe('orch/upload-fix');
    expect(deriveBranch('', 'upload-fix')).toBe('upload-fix');
  });
});
