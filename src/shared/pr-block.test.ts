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
  ])('also matches %s', (command, kind) => {
    expect(detectPrCommand(command)).toEqual({ kind });
  });

  it.each([
    'gh issue create --title "pr create"',
    'git push -u origin upload-fix',
    'echo "& gh pr create"',
    '',
  ])('also does not match %s', (command) => {
    expect(detectPrCommand(command)).toBeNull();
  });
});
