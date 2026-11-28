import type { PreloadApi } from '../shared/preload-api';

declare global {
  interface Window {
    /** Set by src/preload/index.ts. */
    readonly orchtopus: PreloadApi;
  }
}

export {};
