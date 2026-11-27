import { describe, expect, it, vi } from 'vitest';
import { showMainWindow } from './show-window';

function fakeWindow() {
  return { show: vi.fn(), showInactive: vi.fn() };
}

describe('showMainWindow', () => {
  it('shows the window without focus when ORCHTOPUS_BACKGROUND_WINDOW is 1', () => {
    const window = fakeWindow();
    showMainWindow(window, { ORCHTOPUS_BACKGROUND_WINDOW: '1' });
    expect(window.showInactive).toHaveBeenCalledTimes(1);
    expect(window.show).not.toHaveBeenCalled();
  });

  it.each([
    ['unset', {}],
    ['0', { ORCHTOPUS_BACKGROUND_WINDOW: '0' }],
    ['true', { ORCHTOPUS_BACKGROUND_WINDOW: 'true' }],
    ['empty', { ORCHTOPUS_BACKGROUND_WINDOW: '' }],
  ])('shows the window normally when the variable is %s', (_label, env) => {
    const window = fakeWindow();
    showMainWindow(window, env);
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.showInactive).not.toHaveBeenCalled();
  });
});
