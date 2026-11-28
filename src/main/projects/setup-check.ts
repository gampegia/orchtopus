// The read-only setup check (spec section 2). Every item has a status and, where possible, a
// fix the user can copy. Orchtopus applies nothing. Every read is best effort: a file that
// cannot be read turns its item into a hint that says so, never into a throw.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppStatus, SetupItem, SetupItemId } from '../../shared/api-types';
import { MIN_CLAUDE_VERSION, untestedVersionHint } from '../../shared/claude-version';
import type { ClaudeConfigPaths } from '../claude/claude-home';
import { readTrust } from '../claude/trust';
import { runGit } from '../git/git';
import type { ProjectConfig } from './project-config';

export type { SetupItem, SetupItemId } from '../../shared/api-types';

export const SETUP_ITEM_IDS: readonly SetupItemId[] = [
  'claude-version',
  'trust',
  'check-command',
  'claude-md-length',
  'claude-md-emphasis',
  'secret-deny',
  'superpowers',
  'auto-memory',
  'default-mode',
  'skill-length',
  'committed-personal-settings',
  'prompt-audit',
];

export interface SetupCheckInput {
  root: string;
  checkCommands: ProjectConfig['checkCommands'];
  cli: AppStatus['cli'];
  claudePaths: ClaudeConfigPaths;
  env: Readonly<Record<string, string | undefined>>;
}

/** Line targets from the Claude Code docs; hints, never rules. */
export const CLAUDE_MD_LINE_TARGET = 200;
export const SKILL_LINE_TARGET = 500;

const EMPHASIS = /\b(?:IMPORTANT|YOU MUST|MUST|NEVER|ALWAYS|CRITICAL)\b/g;
const SECRET_PATTERNS = ['.env', '.env.*', 'secrets/**'] as const;
const SECRET_DENY_FIX = JSON.stringify({
  permissions: { deny: ['Read(./.env)', 'Read(./.env.*)', 'Read(./secrets/**)'] },
});
const SUPERPOWERS_FIX = 'claude plugin install superpowers@claude-plugins-official';
const DISABLE_MEMORY_ENV = 'CLAUDE_CODE_DISABLE_AUTO_MEMORY';
const PERSONAL_KEYS = ['permissions.defaultMode', 'model', 'effortLevel'] as const;

type Text = { kind: 'missing' } | { kind: 'ok'; text: string } | { kind: 'unreadable' };
type Json =
  { kind: 'missing' } | { kind: 'ok'; value: Record<string, unknown> } | { kind: 'unreadable' };

interface Source<T> {
  /** How the item names the file. */
  label: string;
  read: T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error['code'] === 'string' ? error['code'] : undefined;
}

async function readText(file: string): Promise<Text> {
  try {
    return { kind: 'ok', text: await readFile(file, 'utf8') };
  } catch (error) {
    const code = errorCode(error);
    return code === 'ENOENT' || code === 'ENOTDIR' ? { kind: 'missing' } : { kind: 'unreadable' };
  }
}

async function readJson(file: string): Promise<Json> {
  const text = await readText(file);
  if (text.kind !== 'ok') return text;
  try {
    const value = JSON.parse(text.text) as unknown;
    return isRecord(value) ? { kind: 'ok', value } : { kind: 'unreadable' };
  } catch {
    return { kind: 'unreadable' };
  }
}

function countLines(text: string): number {
  if (text === '') return 0;
  const lines = text.split(/\r?\n/);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

function item(
  id: SetupItemId,
  status: SetupItem['status'],
  title: string,
  detail: string,
  fix: string | null = null,
): SetupItem {
  return { id, status, title, detail, fix };
}

function unreadableText(labels: string[]): string {
  return `${labels.join(', ')} could not be read.`;
}

interface Inputs {
  input: SetupCheckInput;
  claudeMd: Source<Text>[];
  user: Source<Json>;
  project: Source<Json>;
  local: Source<Json>;
}

function versionItem({ cli }: SetupCheckInput): SetupItem {
  const title = 'Claude Code version';
  if (cli.found && cli.supported) {
    const hint = untestedVersionHint(cli.version);
    if (hint !== null) return item('claude-version', 'hint', title, hint);
    return item('claude-version', 'ok', title, `Claude Code ${cli.version ?? ''} is installed.`);
  }
  const detail = !cli.found
    ? `Claude Code was not found. Install Claude Code ${MIN_CLAUDE_VERSION} or newer; sessions cannot start without it.`
    : `Claude Code ${cli.version ?? 'of an unknown version'} is installed; sessions need ${MIN_CLAUDE_VERSION} or newer.`;
  return item('claude-version', 'problem', title, detail, 'claude update');
}

async function trustItem({ root, claudePaths }: SetupCheckInput): Promise<SetupItem> {
  const title = 'Workspace trust';
  const state = await readTrust(claudePaths.globalConfig, root);
  if (state === 'trusted') return item('trust', 'ok', title, 'Claude Code trusts this folder.');
  const why =
    state === 'not-trusted'
      ? 'Claude Code does not trust this folder yet.'
      : 'Orchtopus could not tell whether Claude Code trusts this folder.';
  return item(
    'trust',
    'problem',
    title,
    `${why} Sessions cannot start until it does. Use Trust in Claude Code to answer its trust prompt.`,
  );
}

function checkCommandItem({ checkCommands }: SetupCheckInput): SetupItem {
  const title = 'Check command';
  if (Object.values(checkCommands).some((c) => c !== null && c.trim() !== '')) {
    return item('check-command', 'ok', title, 'Sessions have a check to run.');
  }
  return item(
    'check-command',
    'hint',
    title,
    'No test, lint or type check command is set. Claude works better with a check it can run.',
  );
}

function claudeMdLengthItem(sources: Source<Text>[]): SetupItem {
  const title = 'CLAUDE.md length';
  const long: string[] = [];
  const unreadable: string[] = [];
  for (const { label, read } of sources) {
    if (read.kind === 'unreadable') unreadable.push(label);
    if (read.kind !== 'ok') continue;
    const n = countLines(read.text);
    if (n >= CLAUDE_MD_LINE_TARGET) long.push(`${label} (${String(n)} lines)`);
  }
  const parts: string[] = [];
  if (long.length > 0) {
    parts.push(`Keep CLAUDE.md under ${String(CLAUDE_MD_LINE_TARGET)} lines: ${long.join(', ')}.`);
  }
  if (unreadable.length > 0) parts.push(unreadableText(unreadable));
  if (parts.length === 0) {
    return item(
      'claude-md-length',
      'ok',
      title,
      `Every CLAUDE.md is under ${String(CLAUDE_MD_LINE_TARGET)} lines.`,
    );
  }
  return item('claude-md-length', 'hint', title, parts.join(' '));
}

function claudeMdEmphasisItem(sources: Source<Text>[]): SetupItem {
  const title = 'CLAUDE.md emphasis';
  const found: string[] = [];
  const unreadable: string[] = [];
  for (const { label, read } of sources) {
    if (read.kind === 'unreadable') unreadable.push(label);
    if (read.kind !== 'ok') continue;
    const words = [...new Set(read.text.match(EMPHASIS) ?? [])];
    if (words.length > 0) found.push(`${label} (${words.join(', ')})`);
  }
  const parts: string[] = [];
  if (found.length > 0) {
    parts.push(
      `Capital emphasis words make Claude overreact; write plain instructions instead: ${found.join(', ')}.`,
    );
  }
  if (unreadable.length > 0) parts.push(unreadableText(unreadable));
  if (parts.length === 0) {
    return item('claude-md-emphasis', 'ok', title, 'No emphasis words in capitals.');
  }
  return item('claude-md-emphasis', 'hint', title, parts.join(' '));
}

// The path part of each `Read(...)` deny rule, without a leading `./`, `/` or `**/`.
function readSpecs(settings: Record<string, unknown>): string[] {
  const permissions = settings['permissions'];
  if (!isRecord(permissions) || !Array.isArray(permissions['deny'])) return [];
  const specs: string[] = [];
  for (const rule of permissions['deny']) {
    if (typeof rule !== 'string') continue;
    const match = /^Read(?:\((.*)\))?$/.exec(rule.trim());
    if (match === null) continue;
    let spec = match[1] ?? '**';
    // `//path` is absolute and `~/` is home-relative: neither covers the repository.
    if (spec.startsWith('//') || spec.startsWith('~')) continue;
    for (;;) {
      const next = spec.replace(/^(?:\.\/|\/|\*\*\/)/, '');
      if (next === spec) break;
      spec = next;
    }
    specs.push(spec);
  }
  return specs;
}

function covers(pattern: (typeof SECRET_PATTERNS)[number], specs: string[]): boolean {
  const accepted: Record<(typeof SECRET_PATTERNS)[number], string[]> = {
    '.env': ['.env', '.env*'],
    '.env.*': ['.env.*', '.env*'],
    'secrets/**': ['secrets/**', 'secrets', 'secrets/'],
  };
  return specs.some((s) => s === '**' || s === '*' || accepted[pattern].includes(s));
}

function secretDenyItem({ user, project, local }: Inputs): SetupItem {
  const title = 'Secrets in deny rules';
  const sources = [user, project, local];
  const specs = sources.flatMap((s) => (s.read.kind === 'ok' ? readSpecs(s.read.value) : []));
  const missing = SECRET_PATTERNS.filter((p) => !covers(p, specs));
  if (missing.length === 0) {
    return item(
      'secret-deny',
      'ok',
      title,
      'Your settings deny reading .env, .env.* and secrets/**.',
    );
  }
  const unreadable = sources.filter((s) => s.read.kind === 'unreadable').map((s) => s.label);
  const parts = [`Your settings do not deny reading ${missing.join(', ')}.`];
  if (unreadable.length > 0) parts.push(unreadableText(unreadable));
  parts.push('Orchtopus sessions get these rules anyway.');
  return item('secret-deny', 'hint', title, parts.join(' '), SECRET_DENY_FIX);
}

function superpowersItem({ user }: Inputs): SetupItem {
  const title = 'superpowers plugin';
  if (user.read.kind === 'unreadable') {
    return item(
      'superpowers',
      'hint',
      title,
      `${unreadableText([user.label])} Orchtopus cannot tell whether superpowers is installed.`,
      SUPERPOWERS_FIX,
    );
  }
  const plugins = user.read.kind === 'ok' ? user.read.value['enabledPlugins'] : undefined;
  const enabled =
    isRecord(plugins) &&
    Object.entries(plugins).some(
      ([key, value]) => key.startsWith('superpowers@') && value === true,
    );
  if (enabled) return item('superpowers', 'ok', title, 'superpowers is installed and enabled.');
  return item(
    'superpowers',
    'hint',
    title,
    'superpowers is not enabled. Its skills give sessions a planned, test-first workflow.',
    SUPERPOWERS_FIX,
  );
}

function autoMemoryItem({ input, user, project, local }: Inputs): SetupItem {
  const title = 'Auto memory';
  const off: string[] = [];
  const unreadable: string[] = [];
  for (const source of [user, project, local]) {
    if (source.read.kind === 'unreadable') unreadable.push(source.label);
    if (source.read.kind === 'ok' && source.read.value['autoMemoryEnabled'] === false) {
      off.push(source.label);
    }
  }
  const envValue = input.env[DISABLE_MEMORY_ENV];
  const parts: string[] = [];
  if (off.length > 0) parts.push(`autoMemoryEnabled is false in ${off.join(', ')}.`);
  if (envValue !== undefined && envValue !== '') parts.push(`${DISABLE_MEMORY_ENV} is set.`);
  if (unreadable.length > 0) parts.push(unreadableText(unreadable));
  if (parts.length === 0) return item('auto-memory', 'ok', title, 'Auto memory is on.');
  return item(
    'auto-memory',
    'hint',
    title,
    `${parts.join(' ')} Auto memory keeps what Claude learns about the project.`,
  );
}

function defaultModeItem({ user }: Inputs): SetupItem {
  const title = 'Default permission mode';
  if (user.read.kind === 'unreadable') {
    return item(
      'default-mode',
      'hint',
      title,
      `${unreadableText([user.label])} Orchtopus cannot check the default permission mode.`,
    );
  }
  const permissions = user.read.kind === 'ok' ? user.read.value['permissions'] : undefined;
  if (isRecord(permissions) && permissions['defaultMode'] === 'bypassPermissions') {
    return item(
      'default-mode',
      'problem',
      title,
      `permissions.defaultMode is bypassPermissions in ${user.label}: your own sessions skip every permission prompt. Orchtopus starts its sessions with an explicit mode anyway.`,
    );
  }
  return item(
    'default-mode',
    'ok',
    title,
    'Your default permission mode is not bypassPermissions.',
  );
}

async function skillLengthItem(root: string): Promise<SetupItem> {
  const title = 'Skill length';
  const dir = join(root, '.claude', 'skills');
  let names: string[];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') names = [];
    else return item('skill-length', 'hint', title, unreadableText(['.claude/skills']));
  }
  const long: string[] = [];
  const unreadable: string[] = [];
  for (const name of names.sort()) {
    const label = `.claude/skills/${name}/SKILL.md`;
    const read = await readText(join(dir, name, 'SKILL.md'));
    if (read.kind === 'unreadable') unreadable.push(label);
    if (read.kind !== 'ok') continue;
    const n = countLines(read.text);
    if (n >= SKILL_LINE_TARGET) long.push(`${label} (${String(n)} lines)`);
  }
  const parts: string[] = [];
  if (long.length > 0) {
    parts.push(`Keep SKILL.md under ${String(SKILL_LINE_TARGET)} lines: ${long.join(', ')}.`);
  }
  if (unreadable.length > 0) parts.push(unreadableText(unreadable));
  if (parts.length === 0) {
    return item(
      'skill-length',
      'ok',
      title,
      `Every project skill is under ${String(SKILL_LINE_TARGET)} lines.`,
    );
  }
  return item('skill-length', 'hint', title, parts.join(' '));
}

function personalKeys(settings: Record<string, unknown>): string[] {
  const permissions = settings['permissions'];
  return PERSONAL_KEYS.filter((key) =>
    key === 'permissions.defaultMode'
      ? isRecord(permissions) && permissions['defaultMode'] !== undefined
      : settings[key] !== undefined,
  );
}

async function committedSettingsItem({ input, project }: Inputs): Promise<SetupItem> {
  const title = 'Personal settings in the repository';
  const ok = item(
    'committed-personal-settings',
    'ok',
    title,
    'The committed .claude/settings.json holds no personal settings.',
  );
  if (project.read.kind === 'missing') return ok;
  let tracked: boolean;
  try {
    const res = await runGit(['ls-files', '--error-unmatch', '--', '.claude/settings.json'], {
      cwd: input.root,
    });
    tracked = res.code === 0;
  } catch {
    return item(
      'committed-personal-settings',
      'hint',
      title,
      'Orchtopus could not ask git whether .claude/settings.json is committed.',
    );
  }
  if (!tracked) return ok;
  if (project.read.kind === 'unreadable') {
    return item('committed-personal-settings', 'hint', title, unreadableText([project.label]));
  }
  const keys = personalKeys(project.read.value);
  if (keys.length === 0) return ok;
  return item(
    'committed-personal-settings',
    'hint',
    title,
    `The committed .claude/settings.json sets ${keys.join(', ')}. These are personal choices; Claude Code ignores some of them in project settings. Move them to your user settings or .claude/settings.local.json.`,
  );
}

function promptAuditItem(): SetupItem {
  return item(
    'prompt-audit',
    'info',
    'Prompt audit',
    'Run /doctor prompt-audit in Claude Code to review your prompts.',
    '/doctor prompt-audit',
  );
}

export async function runSetupCheck(input: SetupCheckInput): Promise<SetupItem[]> {
  const { root, claudePaths } = input;
  const [rootMd, dotMd, userMd, user, project, local] = await Promise.all([
    readText(join(root, 'CLAUDE.md')),
    readText(join(root, '.claude', 'CLAUDE.md')),
    readText(claudePaths.userClaudeMd),
    readJson(claudePaths.userSettings),
    readJson(join(root, '.claude', 'settings.json')),
    readJson(join(root, '.claude', 'settings.local.json')),
  ]);
  const inputs: Inputs = {
    input,
    claudeMd: [
      { label: 'CLAUDE.md', read: rootMd },
      { label: '.claude/CLAUDE.md', read: dotMd },
      { label: claudePaths.userClaudeMd, read: userMd },
    ],
    user: { label: claudePaths.userSettings, read: user },
    project: { label: '.claude/settings.json', read: project },
    local: { label: '.claude/settings.local.json', read: local },
  };
  return [
    versionItem(input),
    await trustItem(input),
    checkCommandItem(input),
    claudeMdLengthItem(inputs.claudeMd),
    claudeMdEmphasisItem(inputs.claudeMd),
    secretDenyItem(inputs),
    superpowersItem(inputs),
    autoMemoryItem(inputs),
    defaultModeItem(inputs),
    await skillLengthItem(root),
    await committedSettingsItem(inputs),
    promptAuditItem(),
  ];
}
