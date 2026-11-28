import { Plus } from 'lucide-react';
import { useRef } from 'react';
import type { ProjectView, SessionView } from '../../shared/api-types';
import { sessionsInListOrder, useAppStore } from '../state/store';
import { ProjectMenu } from './ProjectMenu';
import { SessionRow } from './SessionRow';

const MOVES: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowDown: (index, last) => Math.min(index + 1, last),
  ArrowUp: (index) => Math.max(index - 1, 0),
  Home: () => 0,
  End: (_index, last) => last,
};

/** Sessions grouped by project, with one `+ Session` per project and `+ Project` at the end. */
export function SessionList(): React.JSX.Element {
  const ready = useAppStore((store) => store.state.ready);
  const projects = useAppStore((store) => store.state.projects);
  const sessions = useAppStore((store) => store.state.sessions);
  const selectedId = useAppStore((store) => store.selectedSessionId);
  const select = useAppStore((store) => store.select);
  const openDialog = useAppStore((store) => store.openDialog);
  const listRef = useRef<HTMLDivElement>(null);

  // Arrow keys move the selection through all rows, across projects; focus follows it.
  // Only keys on a row count: the project menu and the add buttons keep their own keys.
  const onKeyDown = (event: React.KeyboardEvent): void => {
    const move = MOVES[event.key];
    if (move === undefined) return;
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'option') {
      return;
    }
    const ordered = sessionsInListOrder(useAppStore.getState().state);
    if (ordered.length === 0) return;
    event.preventDefault();
    const index = Math.max(
      ordered.findIndex((session) => session.id === selectedId),
      0,
    );
    const next = ordered[move(index, ordered.length - 1)];
    if (next === undefined) return;
    select(next.id);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(next.id)}"]`)
      ?.focus();
  };

  return (
    <nav className="panel session-list" aria-label="Sessions">
      <div className="session-list-head">
        <h2 className="session-list-title">Sessions</h2>
      </div>
      <div className="session-list-body" ref={listRef} onKeyDown={onKeyDown}>
        {!ready ? (
          <p className="session-list-note" role="status">
            Loading sessions
          </p>
        ) : (
          projects.map((project) => (
            <ProjectGroup
              key={project.id}
              project={project}
              sessions={sessions.filter((session) => session.projectId === project.id)}
              selectedId={selectedId}
              onSelect={select}
              onNewSession={() => {
                openDialog({ kind: 'new-session', projectId: project.id });
              }}
            />
          ))
        )}
      </div>
      <div className="session-list-foot">
        <button
          type="button"
          className="btn ghost small"
          aria-label="Add project"
          onClick={() => {
            openDialog({ kind: 'add-project' });
          }}
        >
          <Plus className="icon-small" strokeWidth={1.5} aria-hidden="true" />
          Project
        </button>
      </div>
    </nav>
  );
}

function ProjectGroup(props: {
  project: ProjectView;
  sessions: SessionView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewSession: () => void;
}): React.JSX.Element {
  const { project, sessions, selectedId } = props;
  const error = useAppStore((store) =>
    store.projectError?.projectId === project.id ? store.projectError.message : null,
  );
  const headingId = `project-${project.id}`;
  return (
    <section className="project-group" aria-labelledby={headingId}>
      <div className="project-head">
        <h3 id={headingId} className="project-name">
          {project.name}
        </h3>
        <ProjectMenu project={project} />
      </div>
      {error !== null && (
        <p className="project-error" role="alert">
          {error}
        </p>
      )}
      {sessions.length > 0 && (
        <ul className="session-rows" role="listbox" aria-labelledby={headingId}>
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              selected={session.id === selectedId}
              focusable={session.id === selectedId}
              onSelect={() => {
                props.onSelect(session.id);
              }}
            />
          ))}
        </ul>
      )}
      <button
        type="button"
        className="btn ghost small add-session"
        aria-label={`New session in ${project.name}`}
        onClick={props.onNewSession}
      >
        <Plus className="icon-small" strokeWidth={1.5} aria-hidden="true" />
        Session
      </button>
    </section>
  );
}
