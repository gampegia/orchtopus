import type { SessionView } from '../../shared/api-types';
import { SessionHeader } from './SessionHeader';
import { TerminalView } from './TerminalView';

/**
 * Header and live terminal of the selected session. Both are keyed by the session id, so
 * their local state (error text, stopping flag, remove dialog, terminal) never carries over
 * to the next session the user selects.
 */
export function SessionPane({ session }: { session: SessionView }): React.JSX.Element {
  return (
    <section className="panel session-pane" aria-label={session.task}>
      <SessionHeader key={`${session.id}:header`} session={session} />
      <TerminalView key={`${session.id}:terminal`} session={session} />
    </section>
  );
}
