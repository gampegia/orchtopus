// One app-owned PTY (ConPTY through node-pty): `claude attach <id>` for a session or plain
// `claude` for the trust step. Keys typed before the TUI has rendered are dropped by Claude
// Code (spike), so input waits for `ready`. The output tail is kept for late stream clients.
import { randomUUID } from 'node:crypto';
import { spawn as spawnNodePty } from 'node-pty';
import { cleanEnv } from '../child-env';
import type { TerminalExit, TerminalHandle, TerminalSize } from './agent-adapter';

/** What this module needs from a PTY; node-pty's IPty fits it. */
export interface PtyProcess {
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: (e: { exitCode: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type PtySpawn = (
  file: string,
  args: string[],
  opts: { cwd: string; cols: number; rows: number; env: Record<string, string> },
) => PtyProcess;

export const REPLAY_BYTES = 512 * 1024;
export const READY_QUIET_MS = 500;
export const READY_MAX_MS = 6_000;
/** What `claude attach` prints when a newer attach takes the session over (spike Q3). */
export const ELSEWHERE_TEXT = 'Session opened in another window';
const TAIL_CHARS = 4_096;

// CSI, OSC (BEL or ST terminated) and two-byte escapes; cursor moves become a space.
// eslint-disable-next-line no-control-regex
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

function plainText(text: string): string {
  return text.replace(ESCAPES, ' ').replace(/\s+/g, ' ');
}

/** node-pty with ConPTY; the default spawn of openPtyTerminal. */
export const nodePtySpawn: PtySpawn = (file, args, opts) =>
  spawnNodePty(file, args, {
    name: 'xterm-256color',
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: opts.env,
    useConpty: true,
  });

export function openPtyTerminal(opts: {
  file: string;
  args: readonly string[];
  cwd: string;
  size: TerminalSize;
  spawn?: PtySpawn;
  env?: Record<string, string>;
}): TerminalHandle {
  const spawn = opts.spawn ?? nodePtySpawn;
  const pty = spawn(opts.file, [...opts.args], {
    cwd: opts.cwd,
    cols: opts.size.cols,
    rows: opts.size.rows,
    env: opts.env ?? cleanEnv(),
  });

  const dataListeners = new Set<(chunk: string) => void>();
  const exitListeners = new Set<(info: TerminalExit) => void>();
  let chunks: string[] = [];
  let bytes = 0;
  let tail = '';
  let isReady = false;
  let ended = false;
  let queue: string[] = [];
  let quietTimer: NodeJS.Timeout | undefined;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const markReady = (): void => {
    if (isReady) return;
    isReady = true;
    clearTimeout(quietTimer);
    clearTimeout(maxTimer);
    const pending = queue;
    queue = [];
    if (!ended) for (const data of pending) pty.write(data);
    resolveReady();
  };
  const maxTimer = setTimeout(markReady, READY_MAX_MS);

  const keep = (chunk: string): void => {
    chunks.push(chunk);
    bytes += Buffer.byteLength(chunk);
    while (bytes > REPLAY_BYTES && chunks.length > 0) {
      const first = chunks[0] ?? '';
      const over = bytes - REPLAY_BYTES;
      const size = Buffer.byteLength(first);
      if (size <= over) {
        chunks.shift();
        bytes -= size;
      } else {
        // Cut the oldest chunk on a character boundary.
        const cut = Buffer.from(first).subarray(over).toString('utf8').replace(/^�+/, '');
        chunks[0] = cut;
        bytes -= size - Buffer.byteLength(cut);
      }
    }
    if (chunks.length > 256) {
      chunks = [chunks.join('')];
    }
    tail = (tail + chunk).slice(-TAIL_CHARS);
  };

  const dataSub = pty.onData((chunk) => {
    keep(chunk);
    if (!isReady) {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(markReady, READY_QUIET_MS);
    }
    for (const cb of dataListeners) cb(chunk);
  });

  const exitSub = pty.onExit(({ exitCode }) => {
    if (ended) return;
    ended = true;
    markReady();
    const info: TerminalExit = {
      code: exitCode,
      elsewhere: plainText(tail).includes(ELSEWHERE_TEXT),
    };
    for (const cb of [...exitListeners]) cb(info);
    exitListeners.clear();
    dataListeners.clear();
    dataSub.dispose();
    exitSub.dispose();
  });

  return {
    id: randomUUID(),
    ready,
    write: (data) => {
      if (ended) return;
      if (isReady) pty.write(data);
      else queue.push(data);
    },
    resize: (cols, rows) => {
      if (ended) return;
      try {
        pty.resize(cols, rows);
      } catch {
        // The PTY ended between the check and the call.
      }
    },
    onData: (cb) => {
      dataListeners.add(cb);
      return () => dataListeners.delete(cb);
    },
    onExit: (cb) => {
      exitListeners.add(cb);
      return () => exitListeners.delete(cb);
    },
    replay: () => chunks.join(''),
    dispose: () => {
      if (ended) return;
      ended = true;
      clearTimeout(quietTimer);
      clearTimeout(maxTimer);
      queue = [];
      resolveReady();
      dataListeners.clear();
      exitListeners.clear();
      dataSub.dispose();
      exitSub.dispose();
      try {
        pty.kill();
      } catch {
        // Already gone.
      }
    },
  };
}
