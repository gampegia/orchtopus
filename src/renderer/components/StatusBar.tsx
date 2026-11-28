import { TriangleAlert } from 'lucide-react';
import { STATE_LABEL, countStates, statusNotices } from '../../shared/state-words';
import { useAppStore } from '../state/store';
import { Lamp } from './Lamp';

/** Bottom bar: state counts in words, then connection, Claude Code and spool notices. */
export function StatusBar(): React.JSX.Element {
  const connection = useAppStore((store) => store.connection);
  const ready = useAppStore((store) => store.state.ready);
  const status = useAppStore((store) => store.state.status);
  const sessions = useAppStore((store) => store.state.sessions);
  const counts = ready ? countStates(sessions) : [];
  const notices = statusNotices({ connection, ready, status });
  return (
    <footer className="statusbar">
      {counts.length > 0 && (
        <ul className="status-group" aria-label="Session states">
          {counts.map(({ word, count }) => (
            <li key={`${word}-${String(count)}`} className="status-count" data-word={word}>
              <Lamp word={word} />
              <span>
                <span className="num">{count}</span> {STATE_LABEL[word]}
              </span>
            </li>
          ))}
        </ul>
      )}
      {counts.length > 0 && <span className="status-sep" aria-hidden="true" />}
      <ul className="status-group" aria-label="App status">
        {notices.map((notice) => (
          <li key={notice.text} className={notice.problem ? 'status-item problem' : 'status-item'}>
            {notice.problem && (
              <TriangleAlert className="icon-tiny" strokeWidth={1.5} aria-hidden="true" />
            )}
            <span>{notice.text}</span>
          </li>
        ))}
      </ul>
    </footer>
  );
}
