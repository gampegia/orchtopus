import { AddProjectDialog } from './components/AddProjectDialog';
import { AppLayout } from './components/AppLayout';
import { NewSessionDialog } from './components/NewSessionDialog';
import { SetupCheckDialog } from './components/SetupCheckDialog';
import { useAppStore } from './state/store';

export function App(): React.JSX.Element {
  return (
    <>
      <AppLayout />
      <Dialogs />
    </>
  );
}

/** The dialog the shell asked for through the store, at most one at a time. */
function Dialogs(): React.JSX.Element | null {
  const dialog = useAppStore((store) => store.dialog);
  const projects = useAppStore((store) => store.state.projects);
  const closeDialog = useAppStore((store) => store.closeDialog);
  if (dialog === null) return null;
  if (dialog.kind === 'add-project') return <AddProjectDialog onClose={closeDialog} />;
  // A project removed while its dialog was open: nothing is left to show.
  const project = projects.find((p) => p.id === dialog.projectId);
  if (project === undefined) return null;
  return dialog.kind === 'new-session' ? (
    <NewSessionDialog key={project.id} project={project} onClose={closeDialog} />
  ) : (
    <SetupCheckDialog key={project.id} project={project} onClose={closeDialog} />
  );
}
