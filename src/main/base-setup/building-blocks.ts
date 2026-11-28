// Versioned building blocks shipped with the app (prompts now, skills later): found in
// building-blocks/ next to the app, loaded at run time, filled from `{{name}}` variables.
import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';

export const BUILDING_BLOCKS_DIR = 'building-blocks';
export const WORKFLOW_INSTRUCTION = 'workflow-instruction.md';

export interface BuildingBlock {
  version: string;
  body: string;
}

/** process.resourcesPath when packaged (electron-builder extraResources), else the repo root. */
export function buildingBlocksDir(
  packaged: boolean,
  resourcesPath: string,
  appRoot: string,
): string {
  return join(packaged ? resourcesPath : appRoot, BUILDING_BLOCKS_DIR);
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)+/;
const FIELD = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/;
const VERSION = /^\d+\.\d+\.\d+$/;

/** A `---` block of `key: value` lines at the very start; values are kept as plain strings. */
export function parseFrontMatter(text: string): { fields: Record<string, string>; body: string } {
  const match = FRONT_MATTER.exec(text);
  if (match === null) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const field = FIELD.exec(line);
    if (field?.[1] !== undefined) fields[field[1]] = field[2] ?? '';
  }
  return { fields, body: text.slice(match[0].length) };
}

/** Reads `<dir>/<name>`; the name is a relative path that stays inside the folder. */
export function loadBuildingBlock(dir: string, name: string): BuildingBlock {
  const clean = normalize(name);
  if (name === '' || isAbsolute(name) || /^[A-Za-z]:/.test(name) || clean.startsWith('..')) {
    throw new Error(`invalid building block name: ${JSON.stringify(name)}`);
  }
  const { fields, body } = parseFrontMatter(readFileSync(join(dir, clean), 'utf8'));
  const version = fields['version'];
  if (version === undefined || !VERSION.test(version)) {
    throw new Error(`building block ${name} has no version x.y.z in its front matter`);
  }
  return { version, body };
}

/** Replaces every `{{name}}` in one pass; a name without a value throws. */
export function renderTemplate(body: string, vars: Readonly<Record<string, string>>): string {
  return body.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (_match, key: string) => {
    if (!Object.hasOwn(vars, key)) throw new Error(`unknown template variable: ${key}`);
    return vars[key] ?? '';
  });
}
