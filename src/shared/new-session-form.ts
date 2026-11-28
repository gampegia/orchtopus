// State of the new-session dialog that follows from its fields: the branch is derived from the
// task until the user edits it, and the task name is checked live.
import { deriveBranch, validateTaskName } from './task-name';

export interface NewSessionFormInput {
  task: string;
  /** True once the user typed into the branch field. */
  branchEdited: boolean;
  /** The branch field's text; used only when edited. */
  branch: string;
  /** The project's branch prefix, for example `orch/`. */
  prefix: string;
}

export interface NewSessionFormState {
  branch: string;
  taskError: string | null;
  canSubmit: boolean;
}

export function newSessionFormState(input: NewSessionFormInput): NewSessionFormState {
  const branch = input.branchEdited ? input.branch : deriveBranch(input.prefix, input.task);
  const taskError = validateTaskName(input.task);
  return { branch, taskError, canSubmit: taskError === null && branch.trim() !== '' };
}
