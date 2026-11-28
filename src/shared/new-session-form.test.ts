import { describe, expect, it } from 'vitest';
import { newSessionFormState } from './new-session-form';

describe('newSessionFormState', () => {
  it('derives the branch from the task until the branch is edited', () => {
    const state = newSessionFormState({
      task: 'upload-fix',
      branchEdited: false,
      branch: 'orch/upload',
      prefix: 'orch/',
    });
    expect(state).toEqual({ branch: 'orch/upload-fix', taskError: null, canSubmit: true });
  });

  it('keeps an edited branch', () => {
    const state = newSessionFormState({
      task: 'upload-fix',
      branchEdited: true,
      branch: 'fix/uploads',
      prefix: 'orch/',
    });
    expect(state.branch).toBe('fix/uploads');
    expect(state.canSubmit).toBe(true);
  });

  it('blocks submit for an invalid task and names the problem', () => {
    const state = newSessionFormState({
      task: 'Upload Fix',
      branchEdited: false,
      branch: '',
      prefix: 'orch/',
    });
    expect(state.taskError).toEqual(expect.any(String));
    expect(state.canSubmit).toBe(false);
  });

  it('blocks submit for an empty task', () => {
    const state = newSessionFormState({
      task: '',
      branchEdited: false,
      branch: '',
      prefix: 'orch/',
    });
    expect(state.taskError).toEqual(expect.any(String));
    expect(state.canSubmit).toBe(false);
  });

  it('blocks submit for an edited branch left blank', () => {
    const state = newSessionFormState({
      task: 'upload-fix',
      branchEdited: true,
      branch: '  ',
      prefix: 'orch/',
    });
    expect(state.taskError).toBeNull();
    expect(state.canSubmit).toBe(false);
  });
});
