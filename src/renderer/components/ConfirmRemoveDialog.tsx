import { useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import type { SessionView } from '../../shared/api-types';
import { ApiRequestError } from '../api/client';
import { apiClient } from '../state/store';

/** Confirms removing a session: the worktree folder goes, the branch stays. Esc cancels. */
export function ConfirmRemoveDialog({
  session,
  open,
  onOpenChange,
}: {
  session: SessionView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = (next: boolean): void => {
    if (pending) return;
    if (!next) setError(null);
    onOpenChange(next);
  };

  const remove = (): void => {
    setPending(true);
    setError(null);
    apiClient()
      .delete(`/v1/sessions/${encodeURIComponent(session.id)}`, { confirm: true })
      .then(() => {
        setPending(false);
        onOpenChange(false);
      })
      .catch((reason: unknown) => {
        setPending(false);
        setError(
          reason instanceof ApiRequestError ? reason.message : 'Could not remove the session',
        );
      });
  };

  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <Dialog.Portal>
        <Dialog.Popup className="dialog panel">
          <Dialog.Title className="dialog-title">Remove {session.task}?</Dialog.Title>
          <Dialog.Description render={<div />} className="dialog-text">
            <p>
              Stops the session and deletes its worktree folder{' '}
              <span className="mono path">{session.worktreePath}</span>.
            </p>
            <p>
              The branch <span className="mono">{session.branch}</span> is kept.
            </p>
          </Dialog.Description>
          {error !== null && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Dialog.Close className="btn ghost" disabled={pending}>
              Cancel
            </Dialog.Close>
            <button type="button" className="btn primary" disabled={pending} onClick={remove}>
              Remove
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
