// T1: does a `--bg` session stay in the worktree Orchtopus created, and what
// does it do with git (commit, push, PR) when it finishes?
//
// Variant A: settings with `worktree.bgIsolation: "none"` (make-settings --no-bg-isolation).
// Variant B: the same settings without the key.
// Both run in parallel, each in its own fresh worktree, with the PR-block
// stand-in (`danger` label in `deny-match` mode) and the draft workflow
// instruction of plan Task 7 as `--append-system-prompt-file`.
//
// Usage: node checks/t1-isolation.mjs [--variants a,b]
// Prereqs: node setup.mjs --reset; node make-settings.mjs; node make-settings.mjs --name t1a --no-bg-isolation
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, writeJsonAtomic } from '../lib/common.mjs';
import {
  git,
  hookInputs,
  listDir,
  logsText,
  makeWorktree,
  paths,
  startBg,
  toolCalls,
  waitTurnEnd,
  writeEvidence,
} from './_shared.mjs';

const a = parseArgs(process.argv.slice(2));
const variants = String(a.variants ?? 'a,b').split(',');
const PROMPT = 'Add a file notes/t1.txt with the line T1 probe, then finish the task.';
const settingsFor = { a: 't1a', b: 'full' };

writeJsonAtomic(paths.policy, {
  danger: { mode: 'deny-match', pattern: 'gh(\\.exe)?\\s+pr|glab(\\.exe)?\\s+mr' },
});

const instruction = (branch) =>
  `You work in a git worktree that Orchtopus created for this task, on the branch ${branch}. ` +
  'Make all changes in this folder. Commit your work on this branch and push the branch when the task is done. ' +
  'Do not create or merge pull requests or merge requests: Orchtopus opens the pull request after the user has ' +
  'reviewed and released the work. Do not push to main and do not switch to another branch.\n';

const runs = [];
for (const v of variants) {
  const task = `t1${v}-probe`;
  const wt = makeWorktree(task);
  const promptFile = join(paths.config, `t1-workflow-${v}.md`);
  writeFileSync(promptFile, instruction(`orch/${task}`));
  const settings = join(paths.settings, `${settingsFor[v]}.json`);
  const start = startBg({
    cwd: wt,
    settings,
    prompt: PROMPT,
    extra: ['--append-system-prompt-file', promptFile, '--name', task],
    label: `t1-${v}`,
  });
  console.log(`variant ${v}: started ${start.id} status=${start.status}`);
  runs.push({ v, task, wt, start });
}

for (const r of runs) {
  if (!r.start.id) continue;
  r.wait = await waitTurnEnd(r.start.id);
  console.log(
    `variant ${r.v}: ended=${r.wait.ended} state=${r.wait.entry?.state}/${r.wait.entry?.status}`,
  );
}

const findT1Files = () => {
  const hits = [];
  if (existsSync(join(paths.repo, 'notes', 't1.txt'))) hits.push('<repo>/notes/t1.txt');
  for (const d of listDir(join(paths.repo, '.claude', 'worktrees')) ?? []) {
    if (existsSync(join(paths.repo, '.claude', 'worktrees', d, 'notes', 't1.txt')))
      hits.push(`<repo>/.claude/worktrees/${d}/notes/t1.txt`);
    for (const e of listDir(join(paths.repo, '.claude', 'worktrees', d, '.claude', 'worktrees')) ??
      [])
      if (
        existsSync(
          join(paths.repo, '.claude', 'worktrees', d, '.claude', 'worktrees', e, 'notes', 't1.txt'),
        )
      )
        hits.push(`<repo>/.claude/worktrees/${d}/.claude/worktrees/${e}/notes/t1.txt`);
  }
  return hits;
};

const remoteRefs = () =>
  execFileSync('git', ['for-each-ref', '--format=%(refname) %(objectname:short)'], {
    cwd: paths.remote,
    encoding: 'utf8',
  }).trim();

const summary = { prompt: PROMPT, t1Files: findT1Files(), remoteRefs: remoteRefs() };
summary.worktreeList = git(paths.repo, 'worktree', 'list').out;
summary.worktreeFolders = listDir(join(paths.repo, '.claude', 'worktrees'));
summary.branches = git(paths.repo, 'branch', '-a', '-vv').out;
summary.repoStatus = git(paths.repo, 'status', '--porcelain', '--ignored').out;

for (const r of runs) {
  const sessionId = r.wait?.entry?.sessionId;
  const hooks = sessionId ? hookInputs(sessionId) : [];
  const ev = {
    variant: r.v,
    settings: settingsFor[r.v],
    id: r.start.id,
    startStatus: r.start.status,
    startOut: (r.start.stdout + r.start.stderr).trim(),
    wait: r.wait,
    wtStatus: git(r.wt, 'status', '--porcelain', '--untracked-files=all').out,
    wtFileExists: existsSync(join(r.wt, 'notes', 't1.txt')),
    commits: git(paths.repo, 'log', '--oneline', `origin/main..orch/${r.task}`).out,
    upstream: git(r.wt, 'config', `branch.orch/${r.task}.merge`),
    sessionStartCwds: hooks.filter((h) => h.event === 'SessionStart').map((h) => h.input.cwd),
    toolCalls: sessionId ? toolCalls(sessionId) : [],
    // Commands the PR-block stand-in denied (same regex as the policy).
    prBlock: hooks
      .filter((h) => h.label === 'danger')
      .map((h) => h.input.tool_input?.command)
      .filter((c) => typeof c === 'string' && /gh(\.exe)?\s+pr|glab(\.exe)?\s+mr/.test(c)),
    worktreeEvents: hooks
      .filter((h) => /Worktree/.test(h.event ?? '') || /Worktree/.test(h.input.tool_name ?? ''))
      .map((h) => ({ event: h.event, tool: h.input.tool_name })),
    stopMessages: hooks
      .filter((h) => h.event === 'Stop')
      .map((h) => h.input.last_assistant_message),
    screen: r.start.id ? logsText(r.start.id, 80) : [],
  };
  summary[r.v] = ev;
  console.log(
    `variant ${r.v}: wtFile=${ev.wtFileExists} commits=[${ev.commits}] prBlock=${JSON.stringify(ev.prBlock)}`,
  );
}
writeJsonAtomic(paths.policy, {});
console.log('t1 files:', summary.t1Files);
console.log('remote refs:\n' + summary.remoteRefs);
console.log('evidence:', writeEvidence('t1', summary));
