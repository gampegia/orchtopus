import { describe, expect, it } from 'vitest';
import type { ITheme } from '@xterm/xterm';
import lagoonJson from '../../../themes/lagoon/tokens.json';
import { parseTheme, tokenValue } from '../../shared/tokens';
import { buildXtermTheme, xtermFont } from './xterm-theme';

/** All 16 ANSI foreground slots; each must be readable on the terminal surface. */
const ANSI_SLOTS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const satisfies readonly (keyof ITheme)[];

/** WCAG 2 contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (match?.[1] === undefined) throw new Error(`Not a #rrggbb colour: ${hex}`);
    const channels = [0, 2, 4].map(
      (i) => Number.parseInt(match[1]?.slice(i, i + 2) ?? '', 16) / 255,
    );
    const [r, g, bl] = channels.map((c) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (bl ?? 0);
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** Opaque stand-ins for token values; the module passes them through unchanged. */
const TOKENS = [
  '--surface-terminal',
  '--text-terminal',
  '--border-strong',
  '--signal-danger',
  '--signal-done',
  '--signal-permission',
  '--signal-running',
  '--signal-plan',
  '--accent-default',
  '--text-muted',
  '--text-secondary',
  '--text-primary',
];
const v = (name: string): string => `value of ${name}`;
const px = (n: number): string => `${String(n)}px`;
const values: Record<string, string> = {
  ...Object.fromEntries(TOKENS.map((name) => [name, v(name)])),
  '--surface-terminal': ' value of --surface-terminal',
  '--text-terminal': 'value of --text-terminal ',
  '--font-mono': '"JetBrains Mono", Consolas, monospace',
  '--type-small': px(13),
  '--leading-small': px(20),
};
const read = (name: string): string => values[name] ?? '';

describe('buildXtermTheme', () => {
  it('takes background, foreground and cursor from the terminal tokens', () => {
    const theme = buildXtermTheme(read);
    expect(theme.background).toBe(v('--surface-terminal'));
    expect(theme.foreground).toBe(v('--text-terminal'));
    expect(theme.cursor).toBe(v('--text-terminal'));
    expect(theme.cursorAccent).toBe(v('--surface-terminal'));
    expect(theme.selectionBackground).toBe(v('--border-strong'));
  });

  it('maps the ANSI colours to signal tokens with the same meaning', () => {
    const theme = buildXtermTheme(read);
    expect(theme.red).toBe(v('--signal-danger'));
    expect(theme.green).toBe(v('--signal-done'));
    expect(theme.yellow).toBe(v('--signal-permission'));
    expect(theme.blue).toBe(v('--signal-running'));
    expect(theme.magenta).toBe(v('--signal-plan'));
    expect(theme.cyan).toBe(v('--accent-default'));
  });

  it('maps black, white and bright white to text tokens, so none falls back to xterm defaults', () => {
    const theme = buildXtermTheme(read);
    expect(theme.black).toBe(v('--text-terminal'));
    expect(theme.white).toBe(v('--text-secondary'));
    expect(theme.brightWhite).toBe(v('--text-primary'));
  });

  describe.each(['light', 'dark'] as const)('with the Lagoon %s tokens', (mode) => {
    const lagoon = parseTheme(lagoonJson);
    const readLagoon = (name: string): string => {
      const token = name.slice(2).replace('-', '.');
      return Object.hasOwn(lagoon[mode], token) ? tokenValue(lagoon, mode, token) : '';
    };
    const theme = buildXtermTheme(readLagoon);
    const background = theme.background ?? '';

    it.each(ANSI_SLOTS)('sets %s with AA contrast (4.5:1) on the terminal surface', (slot) => {
      const colour = theme[slot];
      expect(colour).toBeTypeOf('string');
      expect(contrast(String(colour), background)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('leaves a colour out when its token is missing, so xterm keeps its default', () => {
    const theme = buildXtermTheme((name) => (name === '--text-terminal' ? 'only' : ''));
    expect(theme.foreground).toBe('only');
    expect('background' in theme).toBe(false);
    expect('red' in theme).toBe(false);
  });
});

describe('xtermFont', () => {
  it('reads the mono font, size and line height from the small type tokens', () => {
    expect(xtermFont(read)).toEqual({
      fontFamily: '"JetBrains Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 20 / 13,
    });
  });

  it('falls back to a monospace font and line height 1 for unreadable tokens', () => {
    expect(xtermFont(() => '')).toEqual({ fontFamily: 'monospace', fontSize: 13, lineHeight: 1 });
  });
});
