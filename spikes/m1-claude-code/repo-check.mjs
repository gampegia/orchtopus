// Shows what changed in the test repo: git status (ignored files included),
// worktrees, and whether Claude Code created a .claude folder there.
//
// Usage: node repo-check.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './lib/common.mjs';

const git = (...a) => execFileSync('git', a, { cwd: paths.repo, encoding: 'utf8' }).trim();
console.log(
  'git status --porcelain --ignored:\n' + (git('status', '--porcelain', '--ignored') || '(clean)'),
);
console.log('\ngit worktree list:\n' + git('worktree', 'list'));
console.log('\ngit log --oneline:\n' + git('log', '--oneline', '--all'));
const dotClaude = join(paths.repo, '.claude');
console.log('\n.claude in test repo:', existsSync(dotClaude) ? readdirSync(dotClaude) : 'absent');
