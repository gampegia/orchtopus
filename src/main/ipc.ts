// IPC handlers behind the preload: connection details for the local API and a folder picker.
// Each handler refuses a sender whose frame is not on an allowed origin (the app origin, or the
// dev server origin when unpackaged), so no other page can read the token.
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { IPC_CONNECTION, IPC_PICK_FOLDER, type ApiConnection } from '../shared/preload-api';
import { originOf } from './navigation';

export function isTrustedSender(
  url: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (url === undefined) return false;
  const origin = originOf(url);
  return origin !== null && allowedOrigins.includes(origin);
}

export interface IpcDeps {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  /** Shows the folder dialog for the sender's window; null when cancelled. */
  pickFolder: (event: IpcMainInvokeEvent) => Promise<string | null>;
  allowedOrigins: readonly string[];
  connection: () => ApiConnection;
  log: (message: string) => void;
}

function checkSender(event: IpcMainInvokeEvent, deps: IpcDeps, channel: string): void {
  // senderFrame is null when the frame navigated away or was destroyed. Subframes never qualify.
  const frame = event.senderFrame;
  if (frame === null || frame.parent !== null || !isTrustedSender(frame.url, deps.allowedOrigins)) {
    deps.log(`Refused IPC ${channel} from an untrusted sender`);
    throw new Error('untrusted sender');
  }
}

/** Registers the handlers; returns a function that removes them. */
export function registerIpc(deps: IpcDeps): () => void {
  deps.ipcMain.handle(IPC_CONNECTION, (event) => {
    checkSender(event, deps, IPC_CONNECTION);
    return deps.connection();
  });
  deps.ipcMain.handle(IPC_PICK_FOLDER, (event) => {
    checkSender(event, deps, IPC_PICK_FOLDER);
    return deps.pickFolder(event);
  });
  return () => {
    deps.ipcMain.removeHandler(IPC_CONNECTION);
    deps.ipcMain.removeHandler(IPC_PICK_FOLDER);
  };
}
