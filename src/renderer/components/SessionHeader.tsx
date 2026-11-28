import { useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Code, Ellipsis, FolderOpen, Square } from 'lucide-react';
import type { SessionStateWord, SessionView } from '../../shared/api-types';
import { ApiRequestError } from '../api/client';
import { apiClient, useAppStore } from '../state/store';
import { ConfirmRemoveDialog } from './ConfirmRemoveDialog';
import { StateWord } from './Lamp';

/** States with a live process that Stop can end. */
const STOPPABLE: readonly SessionStateWord[] = ['running', 'idle', 'needs-you'];

function contextText(pct: number | null): string {
  return pct === null ? 'ctx unknown' : `ctx ${String(Math.round(pct))} %`;
}

function failure(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

/** Name, state word with lamp, branch, context fill; Explorer, VS Code, Stop and a `⋯` menu. */
export function SessionHeader({ session }: { session: SessionView }): React.JSX.Element {
  const vscode = useAppStore((store) => store.state.status.vscodeAvailable);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/v1/sessions/${encodeURIComponent(session.id)}`;

  const reveal = (target: 'explorer' | 'vscode'): void => {
    setError(null);
    apiClient()
      .post(`${path}/reveal`, { target })
      .catch((reason: unknown) => {
        setError(failure(reason, 'Could not open the folder'));
      });
  };

  const stop = (): void => {
    setError(null);
    setStopping(true);
    apiClient()
      .post(`${path}/stop`, {})
      .catch((reason: unknown) => {
        setError(failure(reason, 'Could not stop the session'));
      })
      .finally(() => {
        setStopping(false);
      });
  };

  const reason = error ?? (session.state === 'failed' ? session.stateReason : null);

  return (
    <header className="session-header">
      <div className="session-header-text">
        <div className="session-header-line">
          <h2 className="session-header-title">{session.task}</h2>
          <StateWord word={session.state} />
          <span className="mono muted session-header-branch">{session.branch}</span>
        </div>
        <div className="session-header-line">
          <span className="mono muted">{contextText(session.contextPct)}</span>
          {reason !== null && (
            <span className="session-header-reason" role={error !== null ? 'alert' : undefined}>
              {reason}
            </span>
          )}
        </div>
      </div>
      <div className="session-header-actions">
        <span className="field-hint">F6 leaves the terminal</span>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            reveal('explorer');
          }}
        >
          <FolderOpen className="icon-small" strokeWidth={1.5} aria-hidden="true" />
          Explorer
        </button>
        {vscode && (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              reveal('vscode');
            }}
          >
            <Code className="icon-small" strokeWidth={1.5} aria-hidden="true" />
            VS Code
          </button>
        )}
        {STOPPABLE.includes(session.state) && (
          <button type="button" className="btn small" disabled={stopping} onClick={stop}>
            <Square className="icon-small" strokeWidth={1.5} aria-hidden="true" />
            Stop
          </button>
        )}
        <Menu.Root>
          <Menu.Trigger className="icon-btn" aria-label={`More for ${session.task}`}>
            <Ellipsis className="icon" strokeWidth={1.5} aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner className="menu-positioner" align="end" sideOffset={4}>
              <Menu.Popup className="menu">
                <Menu.Item
                  className="menu-item"
                  onClick={() => {
                    setRemoveOpen(true);
                  }}
                >
                  Remove session
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
      <ConfirmRemoveDialog session={session} open={removeOpen} onOpenChange={setRemoveOpen} />
    </header>
  );
}
