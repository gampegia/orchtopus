/** The privileged scheme that serves the built renderer (registered in src/main/app-protocol.ts). */
export const APP_SCHEME = 'app';

/** The single host under APP_SCHEME. */
export const APP_HOST = 'orchtopus';

/** The origin of the built renderer. Pages under it are the only ones that load app code. */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
