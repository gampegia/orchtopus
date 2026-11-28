import type { SessionView } from '../../shared/api-types';
import { StateWord } from './Lamp';

/** One session in the list: task name, then lamp and state word. */
export function SessionRow(props: {
  session: SessionView;
  selected: boolean;
  focusable: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const { session } = props;
  return (
    <li
      role="option"
      aria-selected={props.selected}
      tabIndex={props.focusable ? 0 : -1}
      data-session-id={session.id}
      className={props.selected ? 'session-row selected' : 'session-row'}
      onClick={props.onSelect}
    >
      <span className="session-name">{session.task}</span>
      <StateWord word={session.state} />
    </li>
  );
}
