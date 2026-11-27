import { describe, expect, it } from 'vitest';
import { cssVarName } from './tokens';

describe('cssVarName', () => {
  it('turns a dotted token name into a CSS custom property', () => {
    expect(cssVarName('surface.page')).toBe('--surface-page');
    expect(cssVarName('space.0-5')).toBe('--space-0-5');
    expect(cssVarName('size.window-width')).toBe('--size-window-width');
  });

  it.each(['Surface.page', 'surface', 'surface..page', 'surface.page ', 'surface.pa;ge', '.page'])(
    'rejects the invalid name %j',
    (name) => {
      expect(() => cssVarName(name)).toThrow(`Invalid token name: "${name}"`);
    },
  );
});
