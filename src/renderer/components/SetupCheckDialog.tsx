// The setup check of an added project, run on request from the project menu.
import { useEffect, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import type { ProjectView, SetupCheckResponse, SetupItem } from '../../shared/api-types';
import { ApiRequestError } from '../api/client';
import { apiClient } from '../state/store';
import { SetupChecklist } from './SetupChecklist';

type Result =
  { kind: 'checking' } | { kind: 'done'; items: SetupItem[] } | { kind: 'failed'; message: string };

export function SetupCheckDialog({
  project,
  onClose,
}: {
  project: ProjectView;
  onClose: () => void;
}): React.JSX.Element {
  const [result, setResult] = useState<Result>({ kind: 'checking' });
  const projectId = project.id;

  useEffect(() => {
    let stale = false;
    apiClient()
      .post<SetupCheckResponse>(`/v1/projects/${encodeURIComponent(projectId)}/setup-check`)
      .then(({ items }) => {
        if (!stale) setResult({ kind: 'done', items });
      })
      .catch((reason: unknown) => {
        if (stale) return;
        setResult({
          kind: 'failed',
          message:
            reason instanceof ApiRequestError ? reason.message : 'Could not run the setup check',
        });
      });
    return () => {
      stale = true;
    };
  }, [projectId]);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Popup className="dialog wide panel">
          <Dialog.Title className="dialog-title">Setup check of {project.name}</Dialog.Title>
          <Dialog.Description className="dialog-text">
            Read only. Orchtopus changes nothing; copy a fix to apply it yourself.
          </Dialog.Description>
          <div className="dialog-body">
            {result.kind === 'checking' && (
              <p className="dialog-text" role="status">
                Checking
              </p>
            )}
            {result.kind === 'done' && <SetupChecklist items={result.items} />}
            {result.kind === 'failed' && (
              <p className="dialog-error" role="alert">
                {result.message}
              </p>
            )}
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="btn primary">Close</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
