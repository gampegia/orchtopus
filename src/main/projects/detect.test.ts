import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTempRepo, git, isolatedGitEnv, type TempRepo } from '../test-helpers/temp-repo';
import type { GitResult } from '../git/git';
import { detectCheckCommands, suggestCopyList } from './detect';

let dirs: string[] = [];
let repos: TempRepo[] = [];

beforeAll(() => {
  for (const [key, value] of Object.entries(isolatedGitEnv())) vi.stubEnv(key, value);
});
afterAll(() => {
  vi.unstubAllEnvs();
});
afterEach(async () => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
  await Promise.all(repos.map((r) => r.cleanup()));
  repos = [];
});

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'orchtopus-detect-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

const pkg = (scripts: Record<string, string>): string =>
  JSON.stringify({ name: 'acme-app', scripts });

describe('detectCheckCommands', () => {
  it('npm: npm test and npm run for the others', async () => {
    const dir = folder({
      'package.json': pkg({ test: 'vitest run', lint: 'eslint .', typecheck: 'tsc --noEmit' }),
      'package-lock.json': '{}',
    });
    await expect(detectCheckCommands(dir)).resolves.toEqual({
      test: 'npm test',
      lint: 'npm run lint',
      typecheck: 'npm run typecheck',
    });
  });

  it('npm without a lockfile, type-check and check-types names', async () => {
    await expect(
      detectCheckCommands(folder({ 'package.json': pkg({ 'type-check': 'tsc' }) })),
    ).resolves.toEqual({ test: null, lint: null, typecheck: 'npm run type-check' });
    await expect(
      detectCheckCommands(folder({ 'package.json': pkg({ 'check-types': 'tsc' }) })),
    ).resolves.toEqual({ test: null, lint: null, typecheck: 'npm run check-types' });
  });

  it('skips the npm init placeholder test script', async () => {
    const dir = folder({
      'package.json': pkg({ test: 'echo "Error: no test specified" && exit 1', lint: 'eslint .' }),
    });
    await expect(detectCheckCommands(dir)).resolves.toEqual({
      test: null,
      lint: 'npm run lint',
      typecheck: null,
    });
  });

  it('pnpm', async () => {
    const dir = folder({
      'package.json': pkg({ test: 'vitest', lint: 'eslint .', typecheck: 'tsc' }),
      'pnpm-lock.yaml': '',
    });
    await expect(detectCheckCommands(dir)).resolves.toEqual({
      test: 'pnpm test',
      lint: 'pnpm run lint',
      typecheck: 'pnpm run typecheck',
    });
  });

  it('yarn', async () => {
    const dir = folder({
      'package.json': pkg({ test: 'jest', lint: 'eslint .' }),
      'yarn.lock': '',
    });
    await expect(detectCheckCommands(dir)).resolves.toEqual({
      test: 'yarn test',
      lint: 'yarn run lint',
      typecheck: null,
    });
  });

  it('bun runs the test script, not its own test runner', async () => {
    const dir = folder({ 'package.json': pkg({ test: 'vitest' }), 'bun.lock': '' });
    await expect(detectCheckCommands(dir)).resolves.toEqual({
      test: 'bun run test',
      lint: null,
      typecheck: null,
    });
    const old = folder({ 'package.json': pkg({ lint: 'eslint .' }), 'bun.lockb': '' });
    await expect(detectCheckCommands(old)).resolves.toMatchObject({ lint: 'bun run lint' });
  });

  it('cargo', async () => {
    await expect(
      detectCheckCommands(folder({ 'Cargo.toml': '[package]\nname = "acme-app"\n' })),
    ).resolves.toEqual({ test: 'cargo test', lint: 'cargo clippy', typecheck: null });
  });

  it('go', async () => {
    await expect(
      detectCheckCommands(folder({ 'go.mod': 'module example.test/acme-app\n' })),
    ).resolves.toEqual({ test: 'go test ./...', lint: 'go vet ./...', typecheck: null });
  });

  it('nothing found, or a package.json that is not JSON', async () => {
    const none = { test: null, lint: null, typecheck: null };
    await expect(detectCheckCommands(folder({ 'README.md': '# acme-app' }))).resolves.toEqual(none);
    await expect(detectCheckCommands(folder({ 'package.json': '{ broken' }))).resolves.toEqual(
      none,
    );
  });
});

describe('suggestCopyList', () => {
  it('suggests .env and .env.local, not tracked .env.example', async () => {
    const r = await createTempRepo();
    repos.push(r);
    writeFileSync(join(r.root, '.gitignore'), '.env\n.env.local\n');
    writeFileSync(join(r.root, '.env.local'), 'API_URL=\n');
    // Not ignored and not tracked: not suggested either.
    writeFileSync(join(r.root, '.envrc'), 'export X=1\n');
    git(r.root, ['add', '.gitignore']);
    git(r.root, ['commit', '--quiet', '-m', 'ignore env']);
    await expect(suggestCopyList(r.root)).resolves.toEqual(['.env', '.env.local']);
  });

  it('is empty without .env files', async () => {
    const r = await createTempRepo();
    repos.push(r);
    rmSync(join(r.root, '.env'));
    await expect(suggestCopyList(r.root)).resolves.toEqual([]);
  });

  it('outside a repository git cannot answer, so the names come back unfiltered', async () => {
    await expect(suggestCopyList(folder({ '.env': 'X=1' }))).resolves.toEqual(['.env']);
  });

  it('counts only exit code 1 as not ignored and retries a git error once', async () => {
    const r = await createTempRepo();
    repos.push(r);
    writeFileSync(join(r.root, '.env.local'), 'API_URL=\n');
    const calls: string[] = [];
    // .env fails once, then is ignored; the other names are not ignored.
    const run = (args: readonly string[]): Promise<GitResult> => {
      const name = args[args.length - 1] ?? '';
      calls.push(name);
      if (name === '.env') {
        const first = calls.filter((c) => c === '.env').length === 1;
        return Promise.resolve({ code: first ? 128 : 0, stdout: '', stderr: '' });
      }
      return Promise.resolve({ code: 1, stdout: '', stderr: '' });
    };
    await expect(suggestCopyList(r.root, run)).resolves.toEqual(['.env']);
    expect(calls).toEqual(['.env', '.env', '.env.example', '.env.local']);
  });

  it('returns the names unfiltered when git keeps failing, so none is dropped silently', async () => {
    const r = await createTempRepo();
    repos.push(r);
    writeFileSync(join(r.root, '.env.local'), 'API_URL=\n');
    const timeout = (): Promise<GitResult> =>
      Promise.resolve({ code: -1, stdout: '', stderr: 'git timed out after 30 s' });
    await expect(suggestCopyList(r.root, timeout)).resolves.toEqual([
      '.env',
      '.env.example',
      '.env.local',
    ]);
    const missing = (): Promise<GitResult> =>
      Promise.reject(new Error('git could not be started.'));
    await expect(suggestCopyList(r.root, missing)).resolves.toEqual([
      '.env',
      '.env.example',
      '.env.local',
    ]);
  });
});
