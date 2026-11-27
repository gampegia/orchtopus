import type { Session, WebContents } from 'electron';
import { isAllowedNavigation, isAllowedRedirect, type NavigationPolicy } from './navigation';

/**
 * The renderer's Content Security Policy. It has no `frame-ancestors`: a `<meta>` CSP ignores
 * that directive and logs a console error. The app protocol adds it in the header it sends with
 * HTML pages (see `DOCUMENT_CONTENT_SECURITY_POLICY`).
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
 * Blocks navigation (main frame and subframes), redirects off the startup origin, webview
 * attachment, Bluetooth device selection and new windows for a web contents. The only allowed
 * navigation is a dev server reload of the current page (see `isAllowedNavigation`).
 */
export function hardenWebContents(
  contents: WebContents,
  policy: NavigationPolicy,
  log: (message: string) => void,
): void {
  contents.on('will-navigate', (event) => {
    const { url } = event;
    if (isAllowedNavigation(url, contents.getURL(), policy)) return;
    event.preventDefault();
    log(`Blocked navigation to ${url}`);
  });
  // Subframes only: will-navigate guards the main frame, and will-frame-navigate also fires
  // for main-frame reloads, which must keep working.
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame) event.preventDefault();
  });
  contents.on('will-redirect', (event) => {
    const { url } = event;
    if (isAllowedRedirect(url, policy)) return;
    event.preventDefault();
    log(`Blocked redirect to ${url}`);
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
