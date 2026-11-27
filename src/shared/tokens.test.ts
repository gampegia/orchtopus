import { describe, expect, it } from 'vitest';
import lagoonJson from '../../themes/lagoon/tokens.json';
import {
  buildThemeCss,
  cssVarName,
  missingTokens,
  parseTheme,
  tokenValue,
  type ThemeTokens,
} from './tokens';

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

const lagoon = parseTheme(lagoonJson);

function withTokens(mode: 'light' | 'dark', tokens: Record<string, string>): ThemeTokens {
  return { ...lagoon, [mode]: tokens };
}

function without(map: Readonly<Record<string, string>>, token: string): Record<string, string> {
  return Object.fromEntries(Object.entries(map).filter(([name]) => name !== token));
}

describe('parseTheme', () => {
  it('reads the Lagoon theme', () => {
    expect(lagoon.name).toBe('lagoon');
    expect(lagoon.version).toBe('1.0.0');
  });

  it('rejects input that is not a theme', () => {
    expect(() => parseTheme(null)).toThrow('Theme must be an object');
    expect(() => parseTheme({ ...lagoonJson, name: 'Acme App' })).toThrow('"name"');
    expect(() => parseTheme({ ...lagoonJson, dark: undefined })).toThrow('"dark"');
    expect(() => parseTheme({ ...lagoonJson, light: { 'surface.page': 1 } })).toThrow(
      'Token "surface.page" in light must be a string',
    );
  });
});

describe('missingTokens', () => {
  it('finds every non-scene Lagoon token in both modes', () => {
    expect(missingTokens(lagoon)).toEqual({ light: [], dark: [] });
  });

  it('allows scene tokens to differ between modes', () => {
    expect(Object.hasOwn(lagoon.light, 'scene.sky-top')).toBe(true);
    expect(Object.hasOwn(lagoon.dark, 'scene.sky-top')).toBe(false);
  });

  it('reports a token that is missing in one mode', () => {
    const theme = withTokens('dark', without(lagoon.dark, 'text.primary'));
    expect(missingTokens(theme)).toEqual({ light: [], dark: ['text.primary'] });
  });
});

describe('tokenValue', () => {
  it('returns the value for a mode', () => {
    expect(tokenValue(lagoon, 'light', 'surface.page')).toBe('#e3e7e5');
    expect(tokenValue(lagoon, 'dark', 'surface.page')).toBe('#0a0f17');
  });

  it('throws for an unknown token', () => {
    expect(() => tokenValue(lagoon, 'light', 'surface.unknown')).toThrow(
      'Unknown token "surface.unknown" in light',
    );
  });
});

describe('buildThemeCss', () => {
  const css = buildThemeCss(lagoon);
  const [lightPart = '', darkPart = ''] = css.split('@media (prefers-color-scheme: dark)');
  const declarations = (part: string) => part.match(/^\s+--[a-z0-9-]+: .+;$/gm) ?? [];

  it('writes light tokens on :root and dark tokens in a dark media query', () => {
    expect(lightPart).toContain(':root {');
    expect(lightPart).toContain('  --surface-page: #e3e7e5;');
    expect(lightPart).toContain('  --text-primary: #17212a;');
    expect(darkPart).toContain('    --surface-page: #0a0f17;');
    expect(darkPart).toContain('    --text-primary: #e6ecf3;');
  });

  it('writes one declaration per token', () => {
    expect(declarations(lightPart)).toHaveLength(Object.keys(lagoon.light).length);
    expect(declarations(darkPart)).toHaveLength(Object.keys(lagoon.dark).length);
  });

  it('refuses an incomplete theme', () => {
    const theme = withTokens('dark', without(lagoon.dark, 'text.primary'));
    expect(() => buildThemeCss(theme)).toThrow('Theme "lagoon" misses tokens: dark: text.primary');
  });

  it.each(['#fff; } body { display: none', '#fff\n', '   ', 'red /* x */', '<b>'])(
    'refuses the unsafe value %j',
    (value) => {
      const theme = withTokens('light', { ...lagoon.light, 'surface.page': value });
      expect(() => buildThemeCss(theme)).toThrow(
        'Token "surface.page" in light has an unsafe value',
      );
    },
  );

  it('refuses two tokens that map to the same CSS name', () => {
    const light = { ...lagoon.light, 'acme.report-export': '1px', 'acme-report.export': '2px' };
    const dark = { ...lagoon.dark, 'acme.report-export': '1px', 'acme-report.export': '2px' };
    expect(() => buildThemeCss({ ...lagoon, light, dark })).toThrow(
      'Tokens "acme.report-export" and "acme-report.export" map to the same CSS name --acme-report-export',
    );
  });
});
