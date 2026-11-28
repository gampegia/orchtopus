// Words, signals and short texts the shell shows for session states and app status. Pure.
import type { AppStatus, SessionStateWord, SessionView } from './api-types';
import { MIN_CLAUDE_VERSION } from './claude-version';

/** The signal colour of a state word (DESIGN.md section 3). */
export type StateSignal = 'running' | 'permission' | 'idle' | 'danger';

/** Order of the status bar counts: what needs the user first. */
export const STATE_WORDS: readonly SessionStateWord[] = [
  'needs-you',
  'running',
  'failed',
  'idle',
  'stopped',
];

export const STATE_LABEL: Record<SessionStateWord, string> = {
  running: 'running',
  'needs-you': 'needs you',
  idle: 'idle',
  stopped: 'stopped',
  failed: 'failed',
};

/** Stopped shares the idle colour; its lamp is hollow like idle's (see `isRingLamp`). */
export const STATE_SIGNAL: Record<SessionStateWord, StateSignal> = {
  running: 'running',
  'needs-you': 'permission',
  idle: 'idle',
  stopped: 'idle',
  failed: 'danger',
};

/** Idle and stopped show a ring lamp, so they read apart from the others without colour. */
export function isRingLamp(word: SessionStateWord): boolean {
  return STATE_SIGNAL[word] === 'idle';
}

export function countStates(
  sessions: readonly Pick<SessionView, 'state'>[],
): { word: SessionStateWord; count: number }[] {
  return STATE_WORDS.map((word) => ({
    word,
    count: sessions.filter((session) => session.state === word).length,
  })).filter((entry) => entry.count > 0);
}

/** The title bar note: "1 session needs you", or null when nothing waits. */
export function needsYouNote(sessions: readonly Pick<SessionView, 'state'>[]): string | null {
  const count = sessions.filter((session) => session.state === 'needs-you').length;
  if (count === 0) return null;
  return count === 1 ? '1 session needs you' : `${String(count)} sessions need you`;
}

export type ConnectionState = 'connecting' | 'connected' | 'lost';

export interface StatusNotice {
  text: string;
  /** True when something is wrong; the status bar shows it with an alert icon. */
  problem: boolean;
}

/** The status bar texts after the state counts: connection, Claude Code, spool. */
export function statusNotices(input: {
  connection: ConnectionState;
  ready: boolean;
  status: AppStatus;
}): StatusNotice[] {
  if (input.connection === 'lost') return [{ text: 'API connection lost', problem: true }];
  if (input.connection === 'connecting') return [{ text: 'Connecting to the API', problem: false }];
  const notices: StatusNotice[] = [{ text: 'API connected', problem: false }];
  // Before the restart sequence has finished the CLI status is not known yet.
  if (!input.ready) return notices;
  const { cli, agentsReachable, spoolDamaged } = input.status;
  if (!cli.found) {
    notices.push({ text: 'Claude Code not found', problem: true });
  } else if (!cli.supported) {
    notices.push({
      text:
        cli.version === null
          ? 'Claude Code version could not be read'
          : `Claude Code ${cli.version} is too old (needs ${MIN_CLAUDE_VERSION})`,
      problem: true,
    });
  } else if (!agentsReachable) {
    notices.push({ text: 'Claude Code not reachable', problem: true });
  }
  if (spoolDamaged > 0) {
    notices.push({
      text:
        spoolDamaged === 1
          ? '1 damaged spool line kept'
          : `${String(spoolDamaged)} damaged spool lines kept`,
      problem: true,
    });
  }
  return notices;
}
