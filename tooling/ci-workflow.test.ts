import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(import.meta.dirname, '..');
const workflow = readFileSync(join(repo, '.github', 'workflows', 'ci.yml'), 'utf8');
const scripts = (
  JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;
const runs = [...workflow.matchAll(/^\s*(?:-\s+)?run:\s*(.*)$/gm)].map((m) => (m[1] ?? '').trim());
const uses = [...workflow.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((m) => m[1] ?? '');

describe('CI workflow', () => {
  it('runs only npm ci and existing npm scripts', () => {
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      if (run === 'npm ci') continue;
      const script = /^npm run ([\w:-]+)$/.exec(run)?.[1];
      expect(script, run).toBeDefined();
      expect(Object.keys(scripts), run).toContain(script);
    }
  });

  it('runs every required check on windows-latest', () => {
    expect(workflow).toMatch(/runs-on:\s*windows-latest/);
    expect(runs).toEqual(
      expect.arrayContaining([
        'npm ci',
        'npm run check',
        'npm run smoke:native',
        'npm run e2e',
        'npm run audit',
      ]),
    );
  });

  it('runs for pull requests and for pushes to main', () => {
    expect(workflow).toMatch(/^on:\s*\n\s+pull_request:/m);
    expect(workflow).toMatch(/push:\s*\n\s+branches:\s*\[main\]/);
  });

  it('pins every action to a major tag or a commit hash', () => {
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) {
      expect(action).toMatch(/^[\w.-]+\/[\w.-]+@(?:v\d+|[0-9a-f]{40})$/);
    }
  });

  it('keeps permissions minimal and never uses pull_request_target', () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(workflow).not.toContain('pull_request_target');
    expect(workflow).not.toMatch(/:\s*write\b/);
  });

  it('scans for secrets with gitleaks', () => {
    expect(uses).toContain('gitleaks/gitleaks-action@v3');
  });
});
