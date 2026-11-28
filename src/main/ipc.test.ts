import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it } from 'vitest';
import { IPC_CONNECTION, IPC_PICK_FOLDER } from '../shared/preload-api';
import { isTrustedSender, registerIpc, type IpcDeps } from './ipc';

describe('isTrustedSender', () => {
  const allowed = ['app://orchtopus'];

  it('accepts a page on an allowed origin', () => {
    expect(isTrustedSender('app://orchtopus/index.html', allowed)).toBe(true);
    expect(isTrustedSender('http://127.0.0.1:5173/', ['http://127.0.0.1:5173'])).toBe(true);
  });

  it('refuses other origins, look-alikes and missing frames', () => {
    for (const url of [
      'https://evil.test/',
      'app://orchtopus.evil.test/index.html',
      'app://evil/index.html',
      'file:///C:/index.html',
      'about:blank',
      'not a url',
      '',
      undefined,
    ]) {
      expect(isTrustedSender(url, allowed)).toBe(false);
    }
  });
});

type Handler = (event: IpcMainInvokeEvent) => unknown;

/** Registers the handlers on a fake ipcMain; returns them by channel and the log lines. */
function setup(): {
  handlers: Map<string, Handler>;
  logs: string[];
  picks: number[];
  remove: () => void;
} {
  const handlers = new Map<string, Handler>();
  const logs: string[] = [];
  const picks: number[] = [];
  const deps: IpcDeps = {
    ipcMain: {
      handle: (channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      },
      removeHandler: (channel: string) => {
        handlers.delete(channel);
      },
    },
    pickFolder: () => {
      picks.push(1);
      return Promise.resolve('C:\\repos\\acme-app');
    },
    allowedOrigins: ['app://orchtopus'],
    connection: () => ({ baseUrl: 'http://127.0.0.1:47620', token: 'f'.repeat(64) }),
    log: (message) => {
      logs.push(message);
    },
  };
  const remove = registerIpc(deps);
  return { handlers, logs, picks, remove };
}

function eventFrom(senderFrame: { url: string; parent: unknown } | null): IpcMainInvokeEvent {
  return { senderFrame } as unknown as IpcMainInvokeEvent;
}

const topFrame = { url: 'app://orchtopus/index.html', parent: null };

describe('registerIpc', () => {
  it('answers the top frame on the app origin', async () => {
    const { handlers, picks } = setup();
    expect(handlers.get(IPC_CONNECTION)?.(eventFrom(topFrame))).toEqual({
      baseUrl: 'http://127.0.0.1:47620',
      token: 'f'.repeat(64),
    });
    await expect(handlers.get(IPC_PICK_FOLDER)?.(eventFrom(topFrame))).resolves.toBe(
      'C:\\repos\\acme-app',
    );
    expect(picks).toHaveLength(1);
  });

  it('refuses a null senderFrame, a subframe on the app origin and a foreign origin', () => {
    const { handlers, logs, picks } = setup();
    const refused = [
      eventFrom(null),
      eventFrom({ url: 'app://orchtopus/index.html', parent: topFrame }),
      eventFrom({ url: 'https://evil.test/', parent: null }),
    ];
    for (const channel of [IPC_CONNECTION, IPC_PICK_FOLDER]) {
      for (const event of refused) {
        expect(() => handlers.get(channel)?.(event)).toThrow('untrusted sender');
      }
    }
    expect(picks).toEqual([]);
    expect(logs).toHaveLength(6);
    expect(logs.join('\n')).not.toContain('f'.repeat(64));
  });

  it('returns a function that removes both handlers', () => {
    const { handlers, remove } = setup();
    expect(handlers.size).toBe(2);
    remove();
    expect(handlers.size).toBe(0);
  });
});
