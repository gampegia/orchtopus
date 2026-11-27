import type { BrowserWindow } from 'electron';

/** Set to '1' to show the main window without taking keyboard focus (used by e2e runs). */
export const BACKGROUND_WINDOW_ENV = 'ORCHTOPUS_BACKGROUND_WINDOW';

export function showMainWindow(
  window: Pick<BrowserWindow, 'show' | 'showInactive'>,
  env: Readonly<Record<string, string | undefined>>,
): void {
  if (env[BACKGROUND_WINDOW_ENV] === '1') {
    window.showInactive();
  } else {
    window.show();
  }
}
