// Native module smoke test: loads node-pty and better-sqlite3 inside the
// Electron main process and prints one PASS or FAIL line per check.
// Run it with `npm run smoke:native`. ELECTRON_RUN_AS_NODE must not be set.

if (process.versions.electron === undefined || process.type !== 'browser') {
  console.error(
    'FAIL runtime: not in the Electron main process (run it with npm run smoke:native; ELECTRON_RUN_AS_NODE must not be set)',
  );
  process.exit(1);
}

const { app } = require('electron');

const TIMEOUT_MS = 30_000;
const PTY_GRACE_MS = 500;
const EXPECTED_RESULT = '66666';

let failed = 0;

function summary() {
  return failed === 0
    ? 'native smoke: all checks passed'
    : `native smoke: ${String(failed)} check(s) failed`;
}

const timer = setTimeout(() => {
  fail('timeout', `native smoke did not finish in ${String(TIMEOUT_MS / 1000)} s`);
  console.log(summary());
  app.exit(1);
}, TIMEOUT_MS);

function pass(name, detail) {
  console.log(`PASS ${name}: ${detail}`);
}

function fail(name, detail) {
  failed += 1;
  console.log(`FAIL ${name}: ${detail}`);
}

// First line only: the output contract is one line per check, and a
// "Cannot find module" message appends a multi-line require stack.
function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\r?\n/)[0];
}

function checkBetterSqlite3() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    try {
      const row = db.prepare('select sqlite_version() as version').get();
      const version = row && row.version;
      if (typeof version === 'string' && version.length > 0) {
        pass('better-sqlite3', `sqlite ${version}`);
      } else {
        fail('better-sqlite3', `unexpected result ${JSON.stringify(row)}`);
      }
    } finally {
      db.close();
    }
  } catch (error) {
    fail('better-sqlite3', errorMessage(error));
  }
}

function reportNodeSqlite() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    try {
      const row = db.prepare('select sqlite_version() as version').get();
      console.log(`INFO node:sqlite: available, sqlite ${row.version}`);
    } finally {
      db.close();
    }
  } catch (error) {
    console.log(`INFO node:sqlite: not available (${errorMessage(error)})`);
  }
}

function checkNodePty() {
  return new Promise((resolve) => {
    let pty;
    try {
      pty = require('node-pty');
    } catch (error) {
      fail('node-pty', errorMessage(error));
      resolve();
      return;
    }

    let output = '';
    let term;
    try {
      term = pty.spawn('cmd.exe', ['/d', '/c', 'set /a 12345+54321'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: process.env,
      });
    } catch (error) {
      fail('node-pty', errorMessage(error));
      resolve();
      return;
    }

    term.onData((data) => {
      output += data;
    });
    term.onExit(({ exitCode }) => {
      // ConPTY can deliver the last output after the exit event.
      setTimeout(() => {
        const seen = output.includes(EXPECTED_RESULT);
        const detail = `exit ${String(exitCode)}, result ${seen ? 'seen' : 'missing'}`;
        if (exitCode === 0 && seen) {
          pass('node-pty', detail);
        } else {
          fail('node-pty', detail);
        }
        resolve();
      }, PTY_GRACE_MS);
    });
  });
}

async function main() {
  await app.whenReady();
  const { versions } = process;
  console.log(
    `INFO runtime: electron ${versions.electron}, node ${versions.node}, modules ${versions.modules}`,
  );

  checkBetterSqlite3();
  reportNodeSqlite();
  await checkNodePty();

  clearTimeout(timer);
  console.log(summary());
  app.exit(failed ? 1 : 0);
}

main().catch((error) => {
  clearTimeout(timer);
  fail('unexpected', errorMessage(error));
  console.log(summary());
  app.exit(1);
});
