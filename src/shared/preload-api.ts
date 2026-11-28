// The only surface the preload gives the renderer: how to reach the local API, and a folder
// picker (a native dialog the renderer cannot open itself). Everything else goes through the API.

export interface ApiConnection {
  /** `http://127.0.0.1:<port>` */
  baseUrl: string;
  token: string;
}

export interface PreloadApi {
  connection(): Promise<ApiConnection>;
  /** Shows a folder dialog; null when cancelled. */
  pickFolder(): Promise<string | null>;
}

/** The key on `window` the preload exposes `PreloadApi` under. */
export const PRELOAD_KEY = 'orchtopus';

export const IPC_CONNECTION = 'orchtopus:connection';
export const IPC_PICK_FOLDER = 'orchtopus:pick-folder';
