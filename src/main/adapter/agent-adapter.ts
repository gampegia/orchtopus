// The only surface of Claude Code for the rest of the app (spec section 4). The UI and the API
// know sessions through this interface; M1 has one implementation, the background adapter.
import type { AgentEntry } from '../claude/agents';

export type { AgentEntry } from '../claude/agents';

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface StartInput {
  cwd: string;
  settingsFile: string;
  systemPromptFile: string;
  name: string;
  mode: 'auto' | 'manual';
  model: string | null;
  effort: string | null;
  prompt: string | null;
  agentsJson: string | null;
  pluginDirs: readonly string[];
}

export interface StartedSession {
  sessionId: string;
  shortId: string;
}

export interface SessionRef {
  sessionId: string;
  shortId: string;
  /**
   * The session's folder, when the caller knows it. Resume and attach run there; without it
   * the adapter looks the folder up in `agents --json`.
   */
  cwd?: string;
}

export interface TerminalExit {
  code: number;
  /** True when another `claude attach` took the session over. */
  elsewhere: boolean;
}

/** An app-owned PTY: `claude attach <id>` for a session, or plain `claude` for the trust step. */
export interface TerminalHandle {
  id: string;
  /** Resolves once the TUI has rendered (500 ms of silence after the first output, or 6 s). */
  ready: Promise<void>;
  /** Input written before `ready` is queued and sent when it resolves. */
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (chunk: string) => void): () => void;
  onExit(cb: (info: TerminalExit) => void): () => void;
  /** The last 512 KiB of output. */
  replay(): string;
  /** Ends this PTY only; the background session keeps running. */
  dispose(): void;
}

export interface AgentAdapter {
  start(input: StartInput): Promise<StartedSession>;
  list(): Promise<AgentEntry[]>;
  resume(ref: SessionRef): Promise<void>;
  stop(ref: SessionRef): Promise<void>;
  attach(ref: SessionRef, size: TerminalSize): Promise<TerminalHandle>;
  /** Plain `claude` in a folder, for the trust step. */
  openPlain(cwd: string, size: TerminalSize): Promise<TerminalHandle>;
}

/** A start, resume or stop that Claude Code refused; the message is safe to show. */
export class StartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StartError';
  }
}

/** Resume or stop failed; the message is safe to show. */
export class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterError';
  }
}
