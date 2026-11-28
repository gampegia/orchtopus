import { Menu } from '@base-ui/react/menu';
import { Ellipsis } from 'lucide-react';
import type { ProjectView } from '../../shared/api-types';
import { ApiRequestError } from '../api/client';
import { apiClient, useAppStore } from '../state/store';

/** The project's `⋯` menu: run the setup check, or remove the project from Orchtopus. */
export function ProjectMenu({ project }: { project: ProjectView }): React.JSX.Element {
  const openDialog = useAppStore((store) => store.openDialog);
  const setProjectError = useAppStore((store) => store.setProjectError);

  const remove = (): void => {
    setProjectError(null);
    // Removes the config only; the repository and its files stay as they are.
    apiClient()
      .delete(`/v1/projects/${encodeURIComponent(project.id)}`)
      .catch((error: unknown) => {
        setProjectError({
          projectId: project.id,
          message:
            error instanceof ApiRequestError ? error.message : 'Could not remove the project',
        });
      });
  };

  return (
    <Menu.Root>
      <Menu.Trigger className="icon-btn" aria-label={`More for ${project.name}`}>
        <Ellipsis className="icon" strokeWidth={1.5} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="menu-positioner" align="end" sideOffset={4}>
          <Menu.Popup className="menu">
            <Menu.Item
              className="menu-item"
              onClick={() => {
                openDialog({ kind: 'setup-check', projectId: project.id });
              }}
            >
              Run setup check
            </Menu.Item>
            <Menu.Item className="menu-item" onClick={remove}>
              Remove from Orchtopus
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
