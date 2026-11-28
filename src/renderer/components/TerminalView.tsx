// The live terminal of one session: xterm.js on the session's attach PTY. Opening calls
// POST /open once (it resumes a stopped or failed session), then the terminal stream carries
// output, input and resize. Leaving the session closes only the stream; the PTY stays attached.
// A terminal that ended is never reopened by itself (Review Focus 3): the user clicks Reattach.
import { useEffect, useRef, useState } from 'react';
import { STILL_STARTING_MESSAGE, type SessionView } from '../../shared/api-types';
import { ApiRequestError } from '../api/client';
import { apiClient, useAppStore } from '../state/store';
import { mountXterm, type TerminalHost } from '../terminal/create-xterm';

const STARTING_RETRY_MS = 500;

type Phase = { kind: 'opening' } | { kind: 'live' } | { kind: 'ended'; error: string | null };

function resumable(word: SessionView['state'] | undefined): boolean {
  return word === 'stopped' || word === 'failed';
}

function currentSession(id: string): SessionView | undefined {
  return useAppStore.getState().state.sessions.find((session) => session.id === id);
}

export function TerminalView({ session }: { session: SessionView }): React.JSX.Element {
  const hostRef = useRef<TerminalHost>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>(() =>
    // A session opened in another window stays there until the user reattaches.
    session.terminal.status === 'elsewhere' ? { kind: 'ended', error: null } : { kind: 'opening' },
  );
  const sessionId = session.id;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const first = currentSession(sessionId);
    if (attempt === 0 && first?.terminal.status === 'elsewhere') return;

    let disposed = false;
    const { term, dispose } = mountXterm(host);

    let closeSocket: (() => void) | null = null;
    const connect = (terminalId: string): void => {
      const socket = apiClient().openTerminal(terminalId, (chunk) => {
        term.write(chunk);
      });
      const input = term.onData((data) => {
        socket.input(data);
      });
      const resize = term.onResize(({ cols, rows }) => {
        socket.resize(cols, rows);
      });
      socket.onClose(() => {
        input.dispose();
        resize.dispose();
        if (!disposed) setPhase({ kind: 'ended', error: null });
      });
      socket.resize(term.cols, term.rows);
      closeSocket = () => {
        socket.close();
      };
      setPhase({ kind: 'live' });
      term.focus();
    };

    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const open = (): void => {
      apiClient()
        .post<{ terminalId: string }>(`/v1/sessions/${encodeURIComponent(sessionId)}/open`, {
          cols: term.cols,
          rows: term.rows,
        })
        .then(({ terminalId }) => {
          if (!disposed) connect(terminalId);
        })
        .catch((error: unknown) => {
          if (disposed) return;
          // A session selected while its start still runs: open it once the start is done.
          if (error instanceof ApiRequestError && error.message === STILL_STARTING_MESSAGE) {
            retryTimer = setTimeout(open, STARTING_RETRY_MS);
            return;
          }
          setPhase({
            kind: 'ended',
            error: error instanceof ApiRequestError ? error.message : 'Could not open the session',
          });
        });
    };

    const live = first?.terminal;
    // A stopped or failed session always goes through open, which resumes it; a terminal id
    // left from its old process is dead even when its exit has not arrived yet.
    const reuse = attempt === 0 && live?.status !== 'exited' && !resumable(first?.state);
    const liveId = reuse ? (live?.id ?? null) : null;
    if (liveId !== null) connect(liveId);
    else open();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      closeSocket?.();
      dispose();
    };
  }, [sessionId, attempt]);

  const resuming = resumable(session.state);
  let notice: { text: string; action: boolean } | null = null;
  if (phase.kind === 'opening') {
    notice = { text: resuming ? 'Resuming the session' : 'Attaching', action: false };
  } else if (phase.kind === 'ended') {
    if (phase.error !== null) notice = { text: phase.error, action: true };
    else if (session.terminal.status === 'elsewhere')
      notice = { text: 'Opened in another window', action: true };
    else notice = { text: 'Terminal closed', action: true };
  }

  return (
    <div className="terminal-frame">
      <div ref={hostRef} className="terminal-host" data-terminal={sessionId} />
      {notice !== null && (
        <div className="terminal-notice" role="status">
          <span>{notice.text}</span>
          {notice.action && (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                setPhase({ kind: 'opening' });
                setAttempt((n) => n + 1);
              }}
            >
              Reattach
            </button>
          )}
        </div>
      )}
    </div>
  );
}
