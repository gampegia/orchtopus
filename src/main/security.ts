import type { Session, WebContents } from 'electron';

/**
 * The renderer's Content Security Policy. It has no `frame-ancestors`: a `<meta>` CSP ignores
 * that directive and logs a console error.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

/**
 * Blocks navigation (main frame, subframes and redirects), webview attachment, Bluetooth device
 * selection and new windows for a web contents.
 */
export function hardenWebContents(contents: WebContents): void {
  contents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  // Subframes only: will-navigate guards the main frame, and will-frame-navigate also fires
  // for main-frame reloads, which must keep working.
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame) event.preventDefault();
  });
  contents.on('will-redirect', (event) => {
    event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  // Without preventDefault Electron selects the first available device.
  contents.on('select-bluetooth-device', (event, _devices, callback) => {
    event.preventDefault();
    callback('');
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

/** Denies every permission request, permission check, device permission and display capture. */
export function denyAllPermissions(target: Session): void {
  target.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  target.setPermissionCheckHandler(() => false);
  target.setDevicePermissionHandler(() => false);
  // The callback must run: an empty answer denies, a missing call leaves the request pending.
  target.setDisplayMediaRequestHandler((_request, callback) => {
    callback({});
  });
}
