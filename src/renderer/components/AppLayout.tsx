import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  type LayoutStorage,
} from 'react-resizable-panels';
import { EmptyState } from './EmptyState';
import { SessionHeader } from './SessionHeader';
import { SessionList } from './SessionList';
import { StatusBar } from './StatusBar';
import { TerminalView } from './TerminalView';
import { TitleBar } from './TitleBar';
import { selectedSession, useAppStore } from '../state/store';

/** Session list width limits in pixels (DESIGN.md section 5); the default is `size.sidebar`. */
const LIST_MIN = 224;
const LIST_MAX = 360;

/** Reads a pixel token such as `--size-sidebar` from the linked theme stylesheet. */
function pixelToken(name: string, fallback: number): number {
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name),
  );
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** localStorage that never throws (storage can be blocked); the layout then is not kept. */
const layoutStorage: LayoutStorage = {
  getItem: (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Not kept; the default width comes back on the next start.
    }
  },
};

/** Title bar, resizable session list next to the main column, status bar. */
export function AppLayout(): React.JSX.Element {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'orchtopus-shell',
    storage: layoutStorage,
    onlySaveAfterUserInteractions: true,
  });
  return (
    <div className="shell">
      <TitleBar />
      <Group
        className="shell-body"
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        <Panel
          id="sessions"
          className="shell-pane"
          defaultSize={pixelToken('--size-sidebar', LIST_MIN)}
          minSize={LIST_MIN}
          maxSize={LIST_MAX}
          groupResizeBehavior="preserve-pixel-size"
        >
          <SessionList />
        </Panel>
        <Separator className="shell-separator" aria-label="Resize the session list" />
        <Panel id="main" className="shell-pane">
          <MainColumn />
        </Panel>
      </Group>
      <StatusBar />
    </div>
  );
}

/** The selected session, or the empty state with its one action. */
function MainColumn(): React.JSX.Element {
  const ready = useAppStore((store) => store.state.ready);
  const projects = useAppStore((store) => store.state.projects);
  const session = useAppStore(selectedSession);
  const openDialog = useAppStore((store) => store.openDialog);

  let content: React.JSX.Element | null;
  if (!ready) {
    content = null;
  } else if (projects.length === 0) {
    content = (
      <EmptyState
        title="No project yet"
        text="Add a Git repository to run Claude Code sessions in it"
        action="Add a project"
        onAction={() => {
          openDialog({ kind: 'add-project' });
        }}
      />
    );
  } else if (session === null) {
    const first = projects[0];
    content =
      first === undefined ? null : (
        <EmptyState
          title="No sessions yet"
          text={`Each session in ${first.name} gets its own worktree and branch`}
          action="Start a session"
          onAction={() => {
            openDialog({ kind: 'new-session', projectId: first.id });
          }}
        />
      );
  } else {
    content = (
      <section className="panel session-pane" aria-label={session.task}>
        <SessionHeader session={session} />
        <TerminalView key={session.id} session={session} />
      </section>
    );
  }
  return <main className="main-column">{content}</main>;
}
