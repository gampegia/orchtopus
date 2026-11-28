// Detection for the add-project dialog (spec section 1, step 2): check commands from common
// manifests and the git-ignored `.env*` files to copy into new worktrees (D11). Read only.
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runGit, type GitResult } from '../git/git';
import type { ProjectConfig } from './project-config';

type CheckCommands = ProjectConfig['checkCommands'];

const NO_COMMANDS: CheckCommands = { test: null, lint: null, typecheck: null };
const TYPECHECK_SCRIPTS = ['typecheck', 'type-check', 'check-types'] as const;
/** The test script `npm init` writes; it only fails. */
const PLACEHOLDER_TEST = /no test specified/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

async function packageManager(root: string): Promise<PackageManager> {
  if (await exists(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(join(root, 'yarn.lock'))) return 'yarn';
  if ((await exists(join(root, 'bun.lock'))) || (await exists(join(root, 'bun.lockb')))) {
    return 'bun';
  }
  return 'npm';
}

async function fromPackageJson(root: string): Promise<CheckCommands | null> {
  const pkg = await readJson(join(root, 'package.json'));
  if (!isRecord(pkg) || !isRecord(pkg.scripts)) return null;
  const scripts = pkg.scripts;
  const has = (name: string): boolean => typeof scripts[name] === 'string';
  const manager = await packageManager(root);
  const run = (script: string): string => `${manager} run ${script}`;

  const testScript = scripts['test'];
  const hasTest = typeof testScript === 'string' && !PLACEHOLDER_TEST.test(testScript);
  // `bun test` starts bun's own test runner, not the script.
  const test = hasTest ? (manager === 'bun' ? run('test') : `${manager} test`) : null;
  const typecheckScript = TYPECHECK_SCRIPTS.find(has);
  const commands: CheckCommands = {
    test,
    lint: has('lint') ? run('lint') : null,
    typecheck: typecheckScript === undefined ? null : run(typecheckScript),
  };
  return Object.values(commands).some((c) => c !== null) ? commands : null;
}

export async function detectCheckCommands(root: string): Promise<CheckCommands> {
  const node = await fromPackageJson(root);
  if (node !== null) return node;
  if (await exists(join(root, 'Cargo.toml'))) {
    return { test: 'cargo test', lint: 'cargo clippy', typecheck: null };
  }
  if (await exists(join(root, 'go.mod'))) {
    return { test: 'go test ./...', lint: 'go vet ./...', typecheck: null };
  }
  return { ...NO_COMMANDS };
}

type RunGit = (args: readonly string[], opts: { cwd: string }) => Promise<GitResult>;

/** check-ignore exit codes: 0 ignored, 1 not ignored, anything else is a git error or timeout. */
async function isIgnored(root: string, name: string, run: RunGit): Promise<boolean | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await run(['check-ignore', '--quiet', '--', name], { cwd: root });
      if (res.code === 0) return true;
      if (res.code === 1) return false;
    } catch {
      // A git that cannot start counts like a failed run: retry once.
    }
  }
  return null;
}

/**
 * Top-level `.env*` files that git reports as ignored (tracked files never are). When git cannot
 * answer for a name, even after one retry, every name comes back unfiltered: the dialog shows the
 * list for review, and a silently dropped file is worse than one extra suggestion.
 */
export async function suggestCopyList(root: string, run: RunGit = runGit): Promise<string[]> {
  let names: string[];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    names = entries.filter((e) => e.isFile() && e.name.startsWith('.env')).map((e) => e.name);
  } catch {
    return [];
  }
  names.sort();
  // One quiet check per name: plain output may quote unusual names, and -z needs --stdin.
  const ignored: string[] = [];
  for (const name of names) {
    const answer = await isIgnored(root, name, run);
    if (answer === null) return names;
    if (answer) ignored.push(name);
  }
  return ignored;
}
