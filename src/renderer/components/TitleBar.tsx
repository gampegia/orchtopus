import { PRODUCT_NAME } from '../../shared/product';
import { needsYouNote } from '../../shared/state-words';
import { useAppStore } from '../state/store';

/** The draggable title band: brand, project of the selected session, and who needs you. */
export function TitleBar(): React.JSX.Element {
  const projectName = useAppStore((store) => {
    const session = store.state.sessions.find((s) => s.id === store.selectedSessionId);
    const projectId = session?.projectId ?? store.state.projects[0]?.id;
    return store.state.projects.find((project) => project.id === projectId)?.name ?? null;
  });
  const note = useAppStore((store) => needsYouNote(store.state.sessions));
  return (
    <header className="titlebar">
      <h1 className="brand">{PRODUCT_NAME}</h1>
      {projectName !== null && <span className="titlebar-crumb">{projectName}</span>}
      {note !== null && (
        <p className="titlebar-note">
          <span
            className="lamp"
            data-lamp="needs-you"
            data-signal="permission"
            aria-hidden="true"
          />
          <span>{note}</span>
        </p>
      )}
    </header>
  );
}
