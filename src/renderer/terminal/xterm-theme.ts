// The xterm theme and font from the Lagoon tokens. Pure: the caller passes a reader for CSS
// custom properties (getComputedStyle in the app), so a colour-mode change only needs a rebuild.
import type { ITheme } from '@xterm/xterm';

type ReadToken = (name: string) => string;

/** ANSI colours that carry a signal keep its meaning (DESIGN.md section 3). */
const ANSI_TOKENS = {
  red: '--signal-danger',
  green: '--signal-done',
  yellow: '--signal-permission',
  blue: '--signal-running',
  magenta: '--signal-plan',
  cyan: '--accent-default',
  brightRed: '--signal-danger',
  brightGreen: '--signal-done',
  brightYellow: '--signal-permission',
  brightBlue: '--signal-running',
  brightMagenta: '--signal-plan',
  brightCyan: '--accent-default',
  brightBlack: '--text-muted',
} as const satisfies Partial<Record<keyof ITheme, string>>;

export function buildXtermTheme(read: ReadToken): ITheme {
  const value = (name: string): string | undefined => {
    const text = read(name).trim();
    return text === '' ? undefined : text;
  };
  const background = value('--surface-terminal');
  const foreground = value('--text-terminal');
  const entries: [keyof ITheme, string | undefined][] = [
    ['background', background],
    ['foreground', foreground],
    ['cursor', foreground],
    ['cursorAccent', background],
    ['selectionBackground', value('--border-strong')],
    ...Object.entries(ANSI_TOKENS).map(([key, token]): [keyof ITheme, string | undefined] => [
      key as keyof ITheme,
      value(token),
    ]),
  ];
  const theme: ITheme = Object.fromEntries(entries.filter((entry) => entry[1] !== undefined));
  return theme;
}

export interface XtermFont {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}

const FALLBACK_FONT_SIZE = 13;

function pixels(text: string): number | null {
  const n = Number.parseFloat(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Mono body 13/20 (DESIGN.md, terminal frame): `--font-mono`, `--type-small`/`--leading-small`. */
export function xtermFont(read: ReadToken): XtermFont {
  const family = read('--font-mono').trim();
  const size = pixels(read('--type-small'));
  const leading = pixels(read('--leading-small'));
  const fontSize = size ?? FALLBACK_FONT_SIZE;
  return {
    fontFamily: family === '' ? 'monospace' : family,
    fontSize,
    lineHeight: size !== null && leading !== null ? leading / size : 1,
  };
}
