// The preload exposes exactly one key, `window.orchtopus` (PreloadApi): the local API connection
// and a folder picker. It passes no Electron or Node object to the page.
import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CONNECTION,
  IPC_PICK_FOLDER,
  PRELOAD_KEY,
  type ApiConnection,
  type PreloadApi,
} from '../shared/preload-api';

const api: PreloadApi = {
  connection: () => ipcRenderer.invoke(IPC_CONNECTION) as Promise<ApiConnection>,
  pickFolder: () => ipcRenderer.invoke(IPC_PICK_FOLDER) as Promise<string | null>,
};

contextBridge.exposeInMainWorld(PRELOAD_KEY, api);
