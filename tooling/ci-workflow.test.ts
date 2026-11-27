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

  it('pins third-party actions to a commit hash', () => {
    for (const action of uses.filter((name) => !name.startsWith('actions/'))) {
      expect(action).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('does not keep the GITHUB_TOKEN in .git/config after checkout', () => {
    // Each checkout step with the more deeply indented lines (its `with:` block) below it.
    const checkouts = [...workflow.matchAll(/uses: actions\/checkout@\S+\n((?: {8,}.*\n)*)/g)];
    expect(checkouts.length).toBeGreaterThan(0);
    for (const checkout of checkouts) {
      expect(checkout[1] ?? '').toMatch(/^\s+persist-credentials: false$/m);
    }
  });

  it('cancels superseded runs only for pull requests, never on main', () => {
    expect(workflow).toMatch(
      /^ {2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/m,
    );
  });

  it('keeps permissions minimal and never uses pull_request_target', () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(workflow).not.toContain('pull_request_target');
    expect(workflow).not.toMatch(/:\s*write\b/);
  });

  it('scans for secrets with gitleaks', () => {
    expect(uses.some((action) => action.startsWith('gitleaks/gitleaks-action@'))).toBe(true);
  });
});
