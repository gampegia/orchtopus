// Self-test for isLocalRemote. Usage: node selftest-remotes.mjs (exits 1 on a wrong verdict).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLocalRemote } from './lib.mjs';

const base = mkdtempSync(join(tmpdir(), 'orch-remote-test-'));
const bare = mkdtempSync(join(tmpdir(), 'orch-remote-bare-'));
const cases = [
  [bare, true],
  [bare.replaceAll('\\', '/'), true],
  [`../${bare.split(/[\\/]/).pop() ?? ''}`, true],
  [join(base, 'missing.git'), false],
  ['../no-such-remote.git', false],
  ['', false],
  ['git@github.com:acme/acme-app.git', false],
  ['github.com:acme/acme-app.git', false],
  ['https://github.com/acme/acme-app.git', false],
  ['ssh://git@github.com/acme/acme-app.git', false],
  [`file:///${bare.replaceAll('\\', '/')}`, false],
];

let failed = 0;
for (const [url, expected] of cases) {
  const actual = isLocalRemote(url, base);
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(actual).padEnd(5)} ${url}`);
}
rmSync(base, { recursive: true, force: true });
rmSync(bare, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
