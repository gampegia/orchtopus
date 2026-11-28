// The demo repository of the walking skeleton: `acme-app` with one commit, an ignored `.env`,
// a `package.json` with test and lint scripts, and a bare `origin` remote.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../../src/main/test-helpers/temp-repo';

export interface DemoRepo {
  root: string;
  remote: string;
  cleanup(): Promise<void>;
}

const PACKAGE_JSON = {
  name: 'acme-app',
  version: '1.0.0',
  private: true,
  scripts: { test: 'node --test', lint: 'eslint .' },
};

export function createDemoRepo(): Promise<DemoRepo> {
  const base = mkdtempSync(join(tmpdir(), 'orchtopus-e2e-repo-'));
  const root = join(base, 'acme-app');
  const remote = join(base, 'acme-app.git');
  mkdirSync(root);
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.name', 'Demo']);
  git(root, ['config', 'user.email', 'demo@example.test']);
  writeFileSync(join(root, '.gitignore'), '.env\nnode_modules/\n');
  writeFileSync(join(root, '.env'), 'API_URL=http://localhost\n');
  writeFileSync(join(root, '.env.example'), 'API_URL=\n');
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(PACKAGE_JSON, null, 2)}\n`);
  writeFileSync(join(root, 'README.md'), '# acme-app\n');
  git(root, ['add', '.gitignore', '.env.example', 'package.json', 'README.md']);
  git(root, ['commit', '--quiet', '-m', 'initial commit']);
  git(base, ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '--quiet', '-u', 'origin', 'main']);
  git(root, ['remote', 'set-head', 'origin', 'main']);
  return Promise.resolve({
    root,
    remote,
    cleanup: () => {
      rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      return Promise.resolve();
    },
  });
}
