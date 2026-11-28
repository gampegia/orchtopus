import { describe, expect, it } from 'vitest';
import { buildXtermTheme, xtermFont } from './xterm-theme';

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
