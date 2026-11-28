// The trust step of the add-project dialog. Orchtopus never writes the trust entry: it opens
// plain `claude` in the folder in a terminal here, Claude Code asks, and the user answers. The
// dialog re-checks trust; once Claude Code trusts the folder this closes the terminal.
// TrustStep owns the PTY and kills it; TrustTerminal only shows it. React's StrictMode runs an
// effect's cleanup once right after mounting in a dev build, so a kill in TrustTerminal's
// cleanup would end the PTY the moment it appears.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import type { TrustStateView } from '../../shared/api-types';
import { ApiRequestError } from '../api/client';
import { apiClient } from '../state/store';
import { mountXterm, type TerminalHost } from '../terminal/create-xterm';

/** Kills the trust PTY: on Close terminal, once Claude Code trusts the folder, on unmount. */
function closeTrustTerminal(terminalId: string): void {
  apiClient()
    .delete(`/v1/terminals/${encodeURIComponent(terminalId)}`)
    .catch(() => {
      // Already gone: the process ended or the user answered no.
    });
}

/** The trust terminal: xterm on the trust PTY. Unmounting closes only the stream. */
function TrustTerminal({
  terminalId,
  onEnded,
}: {
  terminalId: string;
  onEnded: () => void;
}): React.JSX.Element {
  const hostRef = useRef<TerminalHost>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let disposed = false;
    const { term, dispose } = mountXterm(host);
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
      if (!disposed) onEnded();
    });
    socket.resize(term.cols, term.rows);
    term.focus();
    return () => {
      disposed = true;
      input.dispose();
      resize.dispose();
      socket.close();
      dispose();
    };
  }, [terminalId, onEnded]);

  return (
    <div className="terminal-frame trust-terminal">
      <div ref={hostRef} className="terminal-host" data-trust-terminal={terminalId} />
    </div>
  );
}

export function TrustStep({
  path,
  trust,
}: {
  path: string;
  trust: TrustStateView;
}): React.JSX.Element {
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trusted = trust === 'trusted';
  // The open terminal for the kill paths below, which must not depend on render timing.
  const terminalIdRef = useRef<string | null>(null);

  useEffect(() => {
    terminalIdRef.current = terminalId;
  }, [terminalId]);

  const killTerminal = useCallback(() => {
    const id = terminalIdRef.current;
    terminalIdRef.current = null;
    if (id !== null) closeTrustTerminal(id);
  }, []);
  const closeTerminal = useCallback(() => {
    killTerminal();
    setTerminalId(null);
  }, [killTerminal]);

  // Once trusted the terminal is no longer shown; its PTY has nothing left to do.
  useEffect(() => {
    if (trusted) killTerminal();
  }, [trusted, killTerminal]);

  // StrictMode's extra cleanup runs right after the first mount, while no terminal is open.
  useEffect(() => killTerminal, [killTerminal]);

  const open = (): void => {
    setOpening(true);
    setError(null);
    apiClient()
      .post<{ terminalId: string }>('/v1/terminals/trust', { path })
      .then(({ terminalId: id }) => {
        setOpening(false);
        setTerminalId(id);
      })
      .catch((reason: unknown) => {
        setOpening(false);
        setError(reason instanceof ApiRequestError ? reason.message : 'Could not open Claude Code');
      });
  };

  return (
    <section className="trust-step" aria-labelledby="trust-step-title">
      <h3 id="trust-step-title" className="section-title">
        Workspace trust
      </h3>
      {trusted ? (
        <p className="trust-done">
          <CircleCheck className="icon-small" strokeWidth={1.5} aria-hidden="true" />
          Claude Code trusts this folder
        </p>
      ) : (
        <>
          <p className="dialog-text">
            Sessions start only in a folder Claude Code trusts. Orchtopus opens Claude Code here; it
            asks whether you trust the folder, and you answer in the terminal.
          </p>
          {terminalId === null ? (
            <div>
              <button type="button" className="btn" disabled={opening} onClick={open}>
                Trust in Claude Code
              </button>
            </div>
          ) : (
            <>
              <TrustTerminal terminalId={terminalId} onEnded={closeTerminal} />
              <div>
                <button type="button" className="btn small" onClick={closeTerminal}>
                  Close terminal
                </button>
              </div>
            </>
          )}
          {error !== null && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
