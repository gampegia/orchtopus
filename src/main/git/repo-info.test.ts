import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTempRepo, git, isolatedGitEnv, type TempRepo } from '../test-helpers/temp-repo';
import { inspectRepo } from './repo-info';

let repos: TempRepo[] = [];

beforeAll(() => {
  for (const [key, value] of Object.entries(isolatedGitEnv())) vi.stubEnv(key, value);
});
afterAll(() => {
  vi.unstubAllEnvs();
});
afterEach(async () => {
  await Promise.all(repos.map((r) => r.cleanup()));
  repos = [];
});

async function repo(opts?: Parameters<typeof createTempRepo>[0]): Promise<TempRepo> {
  const r = await createTempRepo(opts);
  repos.push(r);
  return r;
}

const same = (a: string, b: string): boolean =>
  resolve(a).toLowerCase() === resolve(b).toLowerCase();

describe('inspectRepo', () => {
  it('detects default branch from origin/HEAD', async () => {
    const r = await repo({ withRemote: true });
    git(r.root, ['checkout', '--quiet', '-b', 'feature']);
    const info = await inspectRepo(r.root);
    expect(info).toMatchObject({
      ok: true,
      defaultBranch: 'main',
      currentBranch: 'feature',
      provider: null,
    });
    if (!info.ok) throw new Error('expected ok');
    expect(same(info.root, r.root)).toBe(true);
    expect(info.remotes).toEqual([{ name: 'origin', url: r.remote }]);
  });

  it('falls back to the current branch without a remote', async () => {
    const r = await repo();
    git(r.root, ['checkout', '--quiet', '-b', 'develop']);
    const info = await inspectRepo(r.root);
    expect(info).toMatchObject({ ok: true, defaultBranch: 'develop', remotes: [] });
  });

  it('refuses a folder that is not a repository', async () => {
    const r = await repo();
    const outside = resolve(r.root, '..', 'plain');
    mkdirSync(outside);
    expect(await inspectRepo(outside)).toMatchObject({ ok: false, reason: 'not-a-repo' });
    expect(await inspectRepo(join(outside, 'missing'))).toMatchObject({
      ok: false,
      reason: 'not-a-repo',
    });
  });

  it('refuses a subfolder as not-top-level', async () => {
    const r = await repo();
    const sub = join(r.root, 'src');
    mkdirSync(sub);
    expect(await inspectRepo(sub)).toMatchObject({ ok: false, reason: 'not-top-level' });
  });

  it('refuses a linked worktree', async () => {
    const r = await repo();
    const wt = resolve(r.root, '..', 'linked');
    git(r.root, ['worktree', 'add', '--quiet', '-b', 'linked', wt]);
    expect(await inspectRepo(wt)).toMatchObject({ ok: false, reason: 'is-worktree' });
  });

  it('refuses a bare repository', async () => {
    const r = await repo({ withRemote: true });
    if (r.remote === null) throw new Error('expected remote');
    expect(await inspectRepo(r.remote)).toMatchObject({ ok: false, reason: 'is-bare' });
  });

  it('stores remotes stripped', async () => {
    const r = await repo();
    git(r.root, [
      'remote',
      'add',
      'origin',
      'https://x-access-token:FAKE_TOKEN@github.com/acme/acme-app.git',
    ]);
    git(r.root, [
      'remote',
      'add',
      'mirror',
      'https://user:FAKE_TOKEN@gitlab.com/acme/acme-app.git?private_token=FAKE_TOKEN',
    ]);
    const info = await inspectRepo(r.root);
    expect(JSON.stringify(info)).not.toContain('FAKE_TOKEN');
    expect(info).toMatchObject({
      ok: true,
      provider: 'github',
      remotes: [
        { name: 'mirror', url: 'https://gitlab.com/acme/acme-app.git' },
        { name: 'origin', url: 'https://github.com/acme/acme-app.git' },
      ],
    });
  });

  it('detects gitlab from the origin host', async () => {
    const r = await repo();
    git(r.root, ['remote', 'add', 'origin', 'git@gitlab.example.test:acme/acme-web.git']);
    expect(await inspectRepo(r.root)).toMatchObject({ ok: true, provider: 'gitlab' });
  });

  it('works on a repository path with a space', async () => {
    const r = await repo({ dirName: 'acme app é', withRemote: true });
    const info = await inspectRepo(r.root);
    expect(info).toMatchObject({ ok: true, defaultBranch: 'main', currentBranch: 'main' });
    if (!info.ok) throw new Error('expected ok');
    expect(same(info.root, r.root)).toBe(true);
  });
});
