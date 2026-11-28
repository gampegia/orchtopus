/** A main-column message with exactly one action. */
export function EmptyState(props: {
  title: string;
  text: string;
  action: string;
  onAction: () => void;
}): React.JSX.Element {
  return (
    <section className="panel empty-state" aria-labelledby="empty-state-title">
      <h2 id="empty-state-title" className="empty-title">
        {props.title}
      </h2>
      <p className="empty-text">{props.text}</p>
      <button type="button" className="btn primary" onClick={props.onAction}>
        {props.action}
      </button>
    </section>
  );
}
