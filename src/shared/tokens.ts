/** A token name: a lower-case group plus one or more dot-separated segments. */
export const TOKEN_NAME = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

/** Turns a dotted token name such as `surface.page` into `--surface-page`. */
export function cssVarName(token: string): string {
  if (!TOKEN_NAME.test(token)) {
    throw new Error(`Invalid token name: "${token}"`);
  }
  return `--${token.replaceAll('.', '-')}`;
}
