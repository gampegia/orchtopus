import { describe, expect, it } from 'vitest';
import { detectPrCommand } from './pr-block';

describe('detectPrCommand', () => {
  it.each([
    ['gh pr create --draft', 'gh-pr-create'],
    ['gh pr merge 12', 'gh-pr-merge'],
    ['gh -R acme/acme-app pr create', 'gh-pr-create'],
    ['gh.exe pr create', 'gh-pr-create'],
    ['cd x && gh pr create', 'gh-pr-create'],
    ['glab mr create', 'glab-mr-create'],
    ['glab mr merge 3', 'glab-mr-merge'],
    ['& gh pr create', 'gh-pr-create'],
    ['"gh" pr create', 'gh-pr-create'],
  ])('matches %s', (command, kind) => {
    expect(detectPrCommand(command)).toEqual({ kind });
  });

  it.each([
    'gh pr list',
    'gh pr view 3',
    'git commit -m "gh pr create later"',
    'echo glab mr',
    'ghq pr create',
  ])('does not match %s', (command) => {
    expect(detectPrCommand(command)).toBeNull();
  });

  it.each([
    ['C:\\tools\\gh.exe pr create', 'gh-pr-create'],
    ['/usr/bin/gh pr merge 3 --squash', 'gh-pr-merge'],
    ['git push -u origin upload-fix; gh pr create --fill', 'gh-pr-create'],
    ['git push | gh pr create', 'gh-pr-create'],
    ['echo $(gh pr create)', 'gh-pr-create'],
    ['GH_TOKEN=x gh pr create', 'gh-pr-create'],
    ['gh --repo acme/acme-app pr merge 4', 'gh-pr-merge'],
    ['gh pr -R acme/acme-app create', 'gh-pr-create'],
    ['gh pr new', 'gh-pr-create'],
    ['glab mr new', 'glab-mr-create'],
    ['GLAB.EXE mr create', 'glab-mr-create'],
    ['bash -c "gh pr create --draft"', 'gh-pr-create'],
    ['pwsh -Command "gh pr merge 2"', 'gh-pr-merge'],
    ['cmd /c gh pr create', 'gh-pr-create'],
    ['git status\ngh pr create', 'gh-pr-create'],
    ['glab mr accept 3', 'glab-mr-merge'],
    ['if git push; then gh pr create; fi', 'gh-pr-create'],
    ['if gh pr create; then echo ok; fi', 'gh-pr-create'],
    ['for b in x; do gh pr merge; done', 'gh-pr-merge'],
    ['while true; do gh pr merge 1; done', 'gh-pr-merge'],
    ['until false; do glab mr merge 1; done', 'glab-mr-merge'],
    ['! gh pr create', 'gh-pr-create'],
    ['if false; then :; else gh pr create; fi', 'gh-pr-create'],
    ['if false; then :; elif gh pr create; then :; fi', 'gh-pr-create'],
    ['{ gh pr create; }', 'gh-pr-create'],
  ])('also matches %s', (command, kind) => {
    expect(detectPrCommand(command)).toEqual({ kind });
  });

  it.each([
    'gh issue create --title "pr create"',
    'git push -u origin upload-fix',
    'echo "& gh pr create"',
    'gh mr accept 3',
    'echo if gh pr create',
    '',
  ])('also does not match %s', (command) => {
    expect(detectPrCommand(command)).toBeNull();
  });

  it.each([
    ['bash -lc "gh pr create"', 'gh-pr-create'],
    ['sh -ec "gh pr merge 1"', 'gh-pr-merge'],
    ['zsh -ic "glab mr create"', 'glab-mr-create'],
  ])('matches combined shell flags in %s', (command, kind) => {
    expect(detectPrCommand(command)).toEqual({ kind });
  });

  it.each([
    ['nice -n 10 gh pr create', 'gh-pr-create'],
    ['sudo -u x gh pr merge 2', 'gh-pr-merge'],
    ['env -u GH_TOKEN gh pr create', 'gh-pr-create'],
    ['timeout 30 gh pr create', 'gh-pr-create'],
    ['timeout -s KILL 30s glab mr merge 3', 'glab-mr-merge'],
    ['echo 3 | xargs -n 1 gh pr merge', 'gh-pr-merge'],
    ['npx gh pr create', 'gh-pr-create'],
    ['wsl -d Ubuntu gh pr create', 'gh-pr-create'],
    ['wsl -e bash -c "gh pr merge 1"', 'gh-pr-merge'],
    ['sudo env A=1 nice -n 5 gh pr create', 'gh-pr-create'],
  ])('matches through the wrapper in %s', (command, kind) => {
    expect(detectPrCommand(command)).toEqual({ kind });
  });

  it.each(['nice -n 10 gh pr list', 'timeout 30 git push', 'npx prettier --check .'])(
    'does not match %s',
    (command) => {
      expect(detectPrCommand(command)).toBeNull();
    },
  );

  it('blocks a command nested deeper than it reads', () => {
    let command = 'echo hi';
    for (let i = 0; i < 6; i++) command = `bash -c ${JSON.stringify(command)}`;
    expect(detectPrCommand(command)).toEqual({ kind: 'too-deep' });
    expect(detectPrCommand('bash -c "echo hi"')).toBeNull();
  });
});
