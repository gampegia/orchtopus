/** A token name: a lower-case group plus one or more dot-separated segments. */
export const TOKEN_NAME = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

/** Turns a dotted token name such as `surface.page` into `--surface-page`. */
export function cssVarName(token: string): string {
  if (!TOKEN_NAME.test(token)) {
    throw new Error(`Invalid token name: "${token}"`);
  }
  return `--${token.replaceAll('.', '-')}`;
}

export type ThemeMode = 'light' | 'dark';

export type TokenMap = Readonly<Record<string, string>>;

export interface ThemeTokens {
  readonly name: string;
  readonly version: string;
  readonly light: TokenMap;
  readonly dark: TokenMap;
}

const THEME_NAME = /^[a-z0-9-]+$/;
const UNSAFE_VALUE = /[;{}<>\r\n]|\/\*/;
const MODES: readonly ThemeMode[] = ['light', 'dark'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseTokenMap(value: unknown, mode: ThemeMode): TokenMap {
  if (!isPlainObject(value)) {
    throw new Error(`Theme field "${mode}" must be an object of token values`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([token, tokenValue]) => {
      if (typeof tokenValue !== 'string') {
        throw new Error(`Token "${token}" in ${mode} must be a string`);
      }
      return [token, tokenValue];
    }),
  );
}

/** Checks an untrusted value (for example a parsed `tokens.json`) and returns a new theme. */
export function parseTheme(value: unknown): ThemeTokens {
  if (!isPlainObject(value)) {
    throw new Error('Theme must be an object');
  }
  const { name, version } = value;
  if (typeof name !== 'string' || !THEME_NAME.test(name)) {
    throw new Error('Theme field "name" must be a string of a-z, 0-9 and -');
  }
  if (typeof version !== 'string') {
    throw new Error('Theme field "version" must be a string');
  }
  return {
    name,
    version,
    light: parseTokenMap(value.light, 'light'),
    dark: parseTokenMap(value.dark, 'dark'),
  };
}

/** Scene tokens are mode-specific: each mode lists only the tokens its own scenery paints. */
export function isOptionalToken(token: string): boolean {
  return token.split('.')[0] === 'scene';
}

function missingIn(target: TokenMap, source: TokenMap): string[] {
  return Object.keys(source).filter(
    (token) => !isOptionalToken(token) && !Object.hasOwn(target, token),
  );
}

/** Lists the required tokens that one mode has and the other lacks, in source order. */
export function missingTokens(theme: ThemeTokens): { light: string[]; dark: string[] } {
  return {
    light: missingIn(theme.light, theme.dark),
    dark: missingIn(theme.dark, theme.light),
  };
}

/** Returns the value of a token in a mode. */
export function tokenValue(theme: ThemeTokens, mode: ThemeMode, token: string): string {
  const map = theme[mode];
  const value = Object.hasOwn(map, token) ? map[token] : undefined;
  if (value === undefined) {
    throw new Error(`Unknown token "${token}" in ${mode}`);
  }
  return value;
}

function declarations(map: TokenMap, mode: ThemeMode, indent: string): string[] {
  const tokenByCssName = new Map<string, string>();
  return Object.entries(map).map(([token, value]) => {
    const name = cssVarName(token);
    const other = tokenByCssName.get(name);
    if (other !== undefined) {
      throw new Error(`Tokens "${other}" and "${token}" map to the same CSS name ${name}`);
    }
    tokenByCssName.set(name, token);
    if (UNSAFE_VALUE.test(value) || value.trim() === '') {
      throw new Error(`Token "${token}" in ${mode} has an unsafe value`);
    }
    return `${indent}${name}: ${value};`;
  });
}

/** Builds the theme stylesheet: light tokens on `:root`, dark tokens in a dark media query. */
export function buildThemeCss(theme: ThemeTokens): string {
  const missing = missingTokens(theme);
  const missingList = MODES.flatMap((mode) => missing[mode].map((token) => `${mode}: ${token}`));
  if (missingList.length > 0) {
    throw new Error(`Theme "${theme.name}" misses tokens: ${missingList.join(', ')}`);
  }
  const light = declarations(theme.light, 'light', '  ');
  const dark = declarations(theme.dark, 'dark', '    ');
  return [
    `/* Generated from themes/${theme.name}/tokens.json. Do not edit. */`,
    ':root {',
    '  color-scheme: light dark;',
    ...light,
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    '  :root {',
    ...dark,
    '  }',
    '}',
    '',
  ].join('\n');
}
