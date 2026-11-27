// Task and branch name rules. The task name becomes the worktree folder
// under `.claude/worktrees/` and, with a prefix, the branch name.

export const DEFAULT_BRANCH_PREFIX = 'orch/';

export const TASK_NAME_MAX_LENGTH = 48;

const TASK_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Returns an error text for an invalid task name, or null when it is valid. */
export function validateTaskName(name: string): string | null {
  if (name.length === 0) return 'Enter a task name.';
  if (name.length > TASK_NAME_MAX_LENGTH) {
    return `Use at most ${String(TASK_NAME_MAX_LENGTH)} characters.`;
  }
  if (!TASK_NAME_PATTERN.test(name)) {
    return 'Use lower-case letters, digits and single dashes between them, for example upload-fix.';
  }
  return null;
}

export function deriveBranch(prefix: string, task: string): string {
  return `${prefix}${task}`;
}
