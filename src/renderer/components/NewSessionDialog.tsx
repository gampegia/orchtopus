// Start a session: task, branch (derived until edited), base, an optional first prompt, model,
// effort and mode. Model, effort and mode start from the project's last start.
import { useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import type { ProjectView, SessionMode, SessionView } from '../../shared/api-types';
import { newSessionFormState } from '../../shared/new-session-form';
import { ApiRequestError } from '../api/client';
import { apiClient, useAppStore } from '../state/store';

const MODELS = ['opus', 'sonnet', 'haiku'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

type Base = 'remote' | 'local';

interface Failure {
  field: 'task' | 'branch' | 'base' | null;
  message: string;
}

/** The remote the start fetches from: origin when there is one, else the first. */
function baseRemote(project: ProjectView): string | null {
  return (project.remotes.find((r) => r.name === 'origin') ?? project.remotes[0])?.name ?? null;
}

function failureOf(reason: unknown): Failure {
  if (!(reason instanceof ApiRequestError)) {
    return { field: null, message: 'Could not reach Orchtopus. Try again.' };
  }
  const field = reason.field;
  return {
    field: field === 'task' || field === 'branch' || field === 'base' ? field : null,
    message: reason.message,
  };
}

export function NewSessionDialog({
  project,
  onClose,
}: {
  project: ProjectView;
  onClose: () => void;
}): React.JSX.Element {
  const select = useAppStore((store) => store.select);
  const remote = baseRemote(project);
  const [task, setTask] = useState('');
  const [taskTouched, setTaskTouched] = useState(false);
  const [branchEdited, setBranchEdited] = useState(false);
  const [branchText, setBranchText] = useState('');
  const [base, setBase] = useState<Base>(remote === null ? 'local' : 'remote');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(project.lastStart.model ?? '');
  const [effort, setEffort] = useState(project.lastStart.effort ?? '');
  const [mode, setMode] = useState<SessionMode>(project.lastStart.mode);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Reused only when a request got no answer; an answered one is settled under its id. A field
  // change drops it too: the server replays the params stored under an id, not the new ones.
  const requestId = useRef<string | null>(null);
  const changed = (): void => {
    requestId.current = null;
  };

  const form = newSessionFormState({
    task,
    branchEdited,
    branch: branchText,
    prefix: project.branchPrefix,
  });
  const models = model !== '' && !MODELS.includes(model) ? [...MODELS, model] : MODELS;

  const start = (startBase: Base): void => {
    if (!form.canSubmit || pending) {
      setTaskTouched(true);
      return;
    }
    requestId.current ??= crypto.randomUUID();
    setPending(true);
    setFailure(null);
    apiClient()
      .post<SessionView>('/v1/sessions', {
        projectId: project.id,
        task,
        branch: form.branch,
        base: startBase,
        prompt: prompt.trim() === '' ? null : prompt,
        model: model === '' ? null : model,
        effort: effort === '' ? null : effort,
        mode,
        requestId: requestId.current,
      })
      .then((session) => {
        setPending(false);
        select(session.id);
        onClose();
      })
      .catch((reason: unknown) => {
        setPending(false);
        if (reason instanceof ApiRequestError) requestId.current = null;
        setFailure(failureOf(reason));
      });
  };

  const fieldError = (field: 'task' | 'branch'): string | null =>
    failure?.field === field ? failure.message : null;
  const taskError = fieldError('task') ?? (taskTouched ? form.taskError : null);
  const branchError = fieldError('branch');
  const fetchFailed = failure?.field === 'base';
  const otherError = failure !== null && failure.field === null ? failure.message : null;

  const clearFieldFailure = (field: Failure['field']): void => {
    if (failure?.field === field) setFailure(null);
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Popup className="dialog wide panel">
          <form
            className="dialog-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              start(base);
            }}
          >
            <Dialog.Title className="dialog-title">New session in {project.name}</Dialog.Title>
            <Dialog.Description className="dialog-text">
              The session gets its own worktree and branch.
            </Dialog.Description>

            <div className="dialog-body">
              <div className="field">
                <label className="field-label" htmlFor="session-task">
                  Task
                </label>
                <input
                  id="session-task"
                  className="input mono-input"
                  value={task}
                  spellCheck={false}
                  autoComplete="off"
                  autoFocus
                  placeholder="upload-fix"
                  aria-invalid={taskError !== null}
                  aria-describedby={taskError !== null ? 'session-task-error' : undefined}
                  onChange={(event) => {
                    changed();
                    setTask(event.target.value);
                    if (event.target.value !== '') setTaskTouched(true);
                    clearFieldFailure('task');
                  }}
                />
                {taskError !== null && (
                  <p id="session-task-error" className="field-error">
                    {taskError}
                  </p>
                )}
              </div>

              <div className="field">
                <label className="field-label" htmlFor="session-branch">
                  Branch
                </label>
                <input
                  id="session-branch"
                  className="input mono-input"
                  value={form.branch}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={branchError !== null}
                  aria-describedby={branchError !== null ? 'session-branch-error' : undefined}
                  onChange={(event) => {
                    changed();
                    setBranchEdited(true);
                    setBranchText(event.target.value);
                    clearFieldFailure('branch');
                  }}
                />
                {branchError !== null && (
                  <p id="session-branch-error" className="field-error">
                    {branchError}
                  </p>
                )}
              </div>

              <div className="field">
                <label className="field-label" htmlFor="session-base">
                  Base
                </label>
                <select
                  id="session-base"
                  className="input"
                  value={base}
                  onChange={(event) => {
                    changed();
                    setBase(event.target.value === 'remote' ? 'remote' : 'local');
                    clearFieldFailure('base');
                  }}
                >
                  {remote !== null && (
                    <option value="remote">
                      {remote}/{project.defaultBranch} (fetch first)
                    </option>
                  )}
                  <option value="local">{project.defaultBranch} (local)</option>
                </select>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="session-prompt">
                  First prompt <span className="field-optional">optional</span>
                </label>
                <textarea
                  id="session-prompt"
                  className="input textarea"
                  value={prompt}
                  rows={3}
                  placeholder="Without one the session waits for your first message"
                  onChange={(event) => {
                    changed();
                    setPrompt(event.target.value);
                  }}
                />
              </div>

              <div className="field-pair">
                <div className="field">
                  <label className="field-label" htmlFor="session-model">
                    Model
                  </label>
                  <select
                    id="session-model"
                    className="input"
                    value={model}
                    onChange={(event) => {
                      changed();
                      setModel(event.target.value);
                    }}
                  >
                    <option value="">Default</option>
                    {models.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="session-effort">
                    Effort
                  </label>
                  <select
                    id="session-effort"
                    className="input"
                    value={effort}
                    onChange={(event) => {
                      changed();
                      setEffort(event.target.value);
                    }}
                  >
                    <option value="">Default</option>
                    {EFFORTS.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <fieldset className="field">
                <legend className="field-label">Mode</legend>
                <div className="segmented">
                  {(['auto', 'manual'] as const).map((value) => (
                    <label key={value} className="segment">
                      <input
                        type="radio"
                        name="session-mode"
                        className="segment-input"
                        value={value}
                        checked={mode === value}
                        onChange={() => {
                          changed();
                          setMode(value);
                        }}
                      />
                      <span>{value === 'auto' ? 'Auto' : 'Manual'}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            {fetchFailed && (
              <div className="dialog-alert" role="alert">
                <p>
                  Fetch failed: {failure.message.replace(/\.?$/, '.')} Start from the local branch?
                </p>
                <button
                  type="button"
                  className="btn small"
                  disabled={pending}
                  onClick={() => {
                    setBase('local');
                    start('local');
                  }}
                >
                  Start from local
                </button>
              </div>
            )}
            {otherError !== null && (
              <p className="dialog-error" role="alert">
                {otherError}
              </p>
            )}
            <div className="dialog-actions">
              <Dialog.Close className="btn ghost" disabled={pending}>
                Cancel
              </Dialog.Close>
              <button type="submit" className="btn primary" disabled={pending}>
                {pending ? 'Starting' : 'Start session'}
              </button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
