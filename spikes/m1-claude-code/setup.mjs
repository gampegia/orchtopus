// Creates the scratch test project and the config folder outside every repo.
// Usage: node setup.mjs [--reset]
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, parseArgs, paths, writeJson } from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.reset) {
  for (const p of [paths.repo, paths.remote]) rmSync(p, { recursive: true, force: true });
}

const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', encoding: 'utf8' });

// Test project: one commit, a dummy .env that deny rules must protect.
if (!existsSync(join(paths.repo, '.git'))) {
  ensureDir(paths.repo);
  git(paths.repo, 'init', '-q', '-b', 'main');
  git(paths.repo, 'config', 'user.name', 'Acme Dev');
  git(paths.repo, 'config', 'user.email', 'dev@acme.invalid');
  writeFileSync(
    join(paths.repo, 'README.md'),
    '# acme-app\n\nThrowaway project for the M1 spike.\n',
  );
  writeFileSync(join(paths.repo, 'report-export.js'), "export const format = () => 'csv';\n");
  writeFileSync(join(paths.repo, '.gitignore'), '.env\n');
  git(paths.repo, 'add', '.');
  git(paths.repo, 'commit', '-q', '-m', 'Initial commit');
  // Local bare remote: "force push" tests never touch a real remote.
  git(paths.root, 'init', '-q', '--bare', paths.remote);
  git(paths.repo, 'remote', 'add', 'origin', paths.remote);
  git(paths.repo, 'push', '-q', 'origin', 'main');
}
writeFileSync(join(paths.repo, '.env'), 'ACME_API_KEY=dummy-not-a-secret-ORCH_ENV_CANARY\n');

ensureDir(paths.config);
ensureDir(paths.logs);
ensureDir(paths.screens);

if (!existsSync(paths.token)) writeFileSync(paths.token, randomBytes(24).toString('hex'));

writeFileSync(
  paths.systemPrompt,
  'If the user asks for the file marker, reply with ORCH_SYSPROMPT_FILE_OK.\n',
);

writeJson(paths.agents, {
  'orch-probe': {
    description: 'Spike probe agent. Use only when asked for the agent marker.',
    prompt: 'Reply with exactly ORCH_AGENT_OK and nothing else.',
    tools: [],
  },
});

// Plugin with one skill, for --plugin-dir and the skill visibility question.
writeJson(join(paths.plugin, '.claude-plugin', 'plugin.json'), {
  name: 'orch-spike',
  version: '0.0.1',
  description: 'Orchtopus M1 spike probe plugin',
});
ensureDir(join(paths.plugin, 'skills', 'orch-probe'));
writeFileSync(
  join(paths.plugin, 'skills', 'orch-probe', 'SKILL.md'),
  [
    '---',
    'name: orch-probe',
    'description: Spike probe skill. Use it when the user asks for the skill marker.',
    '---',
    '',
    'Reply with exactly ORCH_SKILL_OK and stop. Do not run any tools.',
    '',
  ].join('\n'),
);

if (!existsSync(paths.policy)) writeJson(paths.policy, {});
if (!existsSync(paths.releases)) writeJson(paths.releases, []);

console.log(`scratch ready: ${paths.root}`);
