// App-owned attach PTYs: a scripted PTY for the timing rules, the fake claude CLI in a real
// ConPTY for replay, takeover and dispose.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TerminalExit, TerminalHandle } from './agent-adapter';
import { openPtyTerminal, REPLAY_BYTES, type PtyProcess } from './attach-terminal';
import { createBackgroundAdapter } from './background-adapter';
import { isAlive, setupFakeClaude, sleep, waitFor, type FakeClaude } from './testing';

const SIZE = { cols: 100, rows: 30 };
const PROMPT_BOX = '╭─ fake prompt ─╮';

interface ScriptedPty extends PtyProcess {
  writes: string[];
  emit: (data: string) => void;
  exit: (code: number) => void;
  killed: boolean;
}

function scriptedPty(): ScriptedPty {
  const dataListeners = new Set<(d: string) => void>();
  const exitListeners = new Set<(e: { exitCode: number }) => void>();
  const pty: ScriptedPty = {
    writes: [],
    killed: false,
    onData: (cb) => {
      dataListeners.add(cb);
      return { dispose: () => dataListeners.delete(cb) };
    },
    onExit: (cb) => {
      exitListeners.add(cb);
      return { dispose: () => exitListeners.delete(cb) };
    },
    write: (d) => pty.writes.push(d),
    resize: () => undefined,
    kill: () => {
      pty.killed = true;
    },
    emit: (d) => {
      for (const cb of dataListeners) cb(d);
    },
    exit: (code) => {
      for (const cb of exitListeners) cb({ exitCode: code });
    },
  };
  return pty;
}

function scripted(): { pty: ScriptedPty; handle: TerminalHandle } {
  const pty = scriptedPty();
  const handle = openPtyTerminal({
    file: 'claude',
    args: ['attach', 'a1b2c3d4'],
    cwd: 'C:\\acme-app',
    size: SIZE,
    spawn: () => pty,
  });
  return { pty, handle };
}

describe('attach terminal (scripted PTY)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('queues input until ready', async () => {
    vi.useFakeTimers();
    const { pty, handle } = scripted();
    let ready = false;
    void handle.ready.then(() => (ready = true));
    handle.write('hello\r');
    pty.emit('booting');
    await vi.advanceTimersByTimeAsync(300);
    pty.emit(PROMPT_BOX);
    await vi.advanceTimersByTimeAsync(499);
    expect(pty.writes).toEqual([]);
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(ready).toBe(true);
    expect(pty.writes).toEqual(['hello\r']);
    handle.write('more');
    expect(pty.writes).toEqual(['hello\r', 'more']);
  });

  it('is ready after 6 s even when the output never pauses', async () => {
    vi.useFakeTimers();
    const { pty, handle } = scripted();
    let ready = false;
    void handle.ready.then(() => (ready = true));
    handle.write('x');
    for (let t = 0; t < 5_900; t += 100) {
      pty.emit('.');
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(ready).toBe(true);
    expect(pty.writes).toEqual(['x']);
  });

  it('keeps only the last 512 KiB for replay', () => {
    const { pty, handle } = scripted();
    pty.emit('a'.repeat(REPLAY_BYTES));
    pty.emit('tail');
    const replay = handle.replay();
    expect(Buffer.byteLength(replay)).toBeLessThanOrEqual(REPLAY_BYTES);
    expect(replay.endsWith('tail')).toBe(true);
  });

  it('reports elsewhere when the tail has the takeover text, even with escape codes', () => {
    const { pty, handle } = scripted();
    const exits: TerminalExit[] = [];
    handle.onExit((e) => exits.push(e));
    pty.emit('\x1b[2KSession opened\x1b[1C in another\x1b[0m window\r\n');
    pty.exit(0);
    expect(exits).toEqual([{ code: 0, elsewhere: true }]);
  });

  it('dispose kills the PTY and ignores later writes', () => {
    const { pty, handle } = scripted();
    handle.dispose();
    expect(pty.killed).toBe(true);
    handle.write('late');
    handle.resize(80, 24);
    expect(pty.writes).toEqual([]);
  });
});

describe('attach terminal (fake claude)', { timeout: 30_000 }, () => {
  let fake: FakeClaude | undefined;
  const handles: TerminalHandle[] = [];

  afterEach(async () => {
    for (const h of handles.splice(0)) h.dispose();
    await fake?.cleanup();
    fake = undefined;
  });

  async function startSession(scenario: string) {
    fake = setupFakeClaude(scenario);
    const adapter = createBackgroundAdapter({ cmd: fake.cmd, now: Date.now, sleep });
    const ref = await adapter.start({
      cwd: fake.folder('acme-app'),
      settingsFile: `${fake.root}\\settings.json`,
      systemPromptFile: `${fake.root}\\workflow.md`,
      name: 'upload-fix',
      mode: 'auto',
      model: null,
      effort: null,
      prompt: 'Install the packages.',
      agentsJson: null,
      pluginDirs: [],
    });
    const attach = async (): Promise<TerminalHandle> => {
      const h = await adapter.attach(ref, SIZE);
      handles.push(h);
      return h;
    };
    return { adapter, ref, attach };
  }

  it('replay returns earlier output to a late subscriber', async () => {
    const { attach } = await startSession('needs-you');
    const h = await attach();
    await h.ready;
    await waitFor(() => h.replay().includes('This command requires approval'));
    expect(h.replay()).toContain(PROMPT_BOX);
    const late: string[] = [];
    h.onData((d) => late.push(d));
    h.write('hello there\r');
    await waitFor(() => late.join('').includes('fake reply: hello there'));
    expect(h.replay()).toContain('This command requires approval');
  });

  it('reports elsewhere when another attach takes over', async () => {
    const { attach } = await startSession('needs-you');
    const first = await attach();
    await first.ready;
    const exited = new Promise<TerminalExit>((resolve) => first.onExit(resolve));
    const second = await attach();
    expect(await exited).toEqual({ code: 0, elsewhere: true });
    await second.ready;
    await waitFor(() => second.replay().includes(PROMPT_BOX));
  });

  it('dispose leaves the session running', async () => {
    const { adapter, attach } = await startSession('needs-you');
    const h = await attach();
    await h.ready;
    const [before] = await adapter.list();
    h.dispose();
    await sleep(500);
    const [after] = await adapter.list();
    expect(after?.pid).toBe(before?.pid);
    expect(isAlive(after?.pid ?? 0)).toBe(true);
    expect(after?.state).not.toBe('failed');
    expect(after?.status).not.toBeNull();
  });
});
