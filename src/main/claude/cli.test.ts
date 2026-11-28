import { describe, expect, it } from 'vitest';
import {
  ClaudeSpawnError,
  compareVersions,
  MIN_CLAUDE_VERSION,
  parseClaudeVersion,
  readClaudeVersion,
  resolveClaudeCommand,
  runClaude,
  type ClaudeCommand,
} from './cli';

const fakeCommand = JSON.stringify(['node', 'tooling/fake-claude/cli.mjs']);
const whereLines = (lines: string[]) => () => Promise.resolve(lines);

/** A command that runs a small Node script instead of the real CLI. */
function nodeScript(source: string): ClaudeCommand {
  return { command: process.execPath, prefixArgs: ['-e', source, '--'] };
}

describe('resolveClaudeCommand', () => {
  it('uses ORCHTOPUS_CLAUDE_COMMAND only when unpackaged', async () => {
    const env = { ORCHTOPUS_CLAUDE_COMMAND: fakeCommand };
    const where = whereLines(['C:\\Tools\\claude.exe']);
    await expect(resolveClaudeCommand({ env, packaged: false, where })).resolves.toEqual({
      command: 'node',
      prefixArgs: ['tooling/fake-claude/cli.mjs'],
    });
    await expect(resolveClaudeCommand({ env, packaged: true, where })).resolves.toEqual({
      command: 'C:\\Tools\\claude.exe',
      prefixArgs: [],
    });
  });

  it('rejects an override that is not a JSON array of strings', async () => {
    for (const bad of ['claude', '[]', '[1]', '{"a":1}', '[""]']) {
      await expect(
        resolveClaudeCommand({
          env: { ORCHTOPUS_CLAUDE_COMMAND: bad },
          packaged: false,
          where: whereLines([]),
        }),
      ).rejects.toThrow(/ORCHTOPUS_CLAUDE_COMMAND/);
    }
  });

  it('picks the first .exe from where', async () => {
    const where = whereLines([
      'C:\\Users\\demo\\AppData\\Roaming\\npm\\claude',
      'C:\\Users\\demo\\AppData\\Roaming\\npm\\claude.cmd',
      '  C:\\Users\\demo user\\.local\\bin\\claude.EXE  ',
      'C:\\Other\\claude.exe',
    ]);
    await expect(resolveClaudeCommand({ env: {}, packaged: false, where })).resolves.toEqual({
      command: 'C:\\Users\\demo user\\.local\\bin\\claude.EXE',
      prefixArgs: [],
    });
  });

  it('returns null when nothing is found', async () => {
    await expect(
      resolveClaudeCommand({ env: {}, packaged: true, where: whereLines([]) }),
    ).resolves.toBeNull();
    await expect(
      resolveClaudeCommand({
        env: {},
        packaged: true,
        where: whereLines(['C:\\npm\\claude.cmd']),
      }),
    ).resolves.toBeNull();
  });
});

describe('version check', () => {
  it('pins the minimum supported version', () => {
    expect(MIN_CLAUDE_VERSION).toBe('2.1.302');
  });

  it('parses the leading version', () => {
    expect(parseClaudeVersion('2.1.332 (Claude Code)\n')).toBe('2.1.332');
    expect(parseClaudeVersion('  2.1.302\r\n')).toBe('2.1.302');
    expect(parseClaudeVersion('Claude Code 2.1.332')).toBeNull();
    expect(parseClaudeVersion('garbage')).toBeNull();
  });

  it('compares versions numerically', () => {
    expect(compareVersions('2.1.332', '2.1.302')).toBeGreaterThan(0);
    expect(compareVersions('2.1.301', '2.1.302')).toBeLessThan(0);
    expect(compareVersions('2.1.302', '2.1.302')).toBe(0);
    expect(compareVersions('2.10.0', '2.9.999')).toBeGreaterThan(0);
    expect(compareVersions('3.0.0', '2.99.99')).toBeGreaterThan(0);
  });

  it('2.1.332 (Claude Code) is supported', async () => {
    await expect(
      readClaudeVersion(nodeScript('console.log("2.1.332 (Claude Code)")')),
    ).resolves.toEqual({ version: '2.1.332', supported: true });
  });

  it('2.1.301 is not supported', async () => {
    await expect(
      readClaudeVersion(nodeScript('console.log("2.1.301 (Claude Code)")')),
    ).resolves.toEqual({ version: '2.1.301', supported: false });
  });

  it('garbage gives no version', async () => {
    await expect(readClaudeVersion(nodeScript('console.log("garbage")'))).resolves.toEqual({
      version: null,
      supported: false,
    });
  });

  it('a missing executable or a failing exit gives no version', async () => {
    await expect(
      readClaudeVersion({ command: 'orchtopus-missing-claude-cli', prefixArgs: [] }),
    ).resolves.toEqual({ version: null, supported: false });
    await expect(
      readClaudeVersion(nodeScript('console.log("2.1.332"); process.exit(3)')),
    ).resolves.toEqual({ version: null, supported: false });
  });
});

describe('runClaude', () => {
  it('passes prefix args, then args, with the clean environment', async () => {
    const before = process.env.CLAUDECODE;
    process.env.CLAUDECODE = '1';
    try {
      const res = await runClaude(
        nodeScript(
          'console.log(JSON.stringify({ argv: process.argv.slice(1), cc: process.env.CLAUDECODE ?? null }))',
        ),
        ['agents', '--json'],
        { cwd: process.cwd(), timeoutMs: 10_000 },
      );
      expect(res.code).toBe(0);
      const out = JSON.parse(res.stdout) as { argv: string[]; cc: string | null };
      expect(out.argv).toEqual(['agents', '--json']);
      expect(out.cc).toBeNull();
    } finally {
      if (before === undefined) delete process.env.CLAUDECODE;
      else process.env.CLAUDECODE = before;
    }
  });

  it('resolves a non-zero exit with its code and stderr', async () => {
    const res = await runClaude(nodeScript('console.error("bad"); process.exit(2)'), [], {
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });
    expect(res.code).toBe(2);
    expect(res.stderr.trim()).toBe('bad');
  });

  it('resolves a timeout with code null', async () => {
    const res = await runClaude(nodeScript('setTimeout(() => {}, 20000)'), [], {
      cwd: process.cwd(),
      timeoutMs: 300,
    });
    expect(res.code).toBeNull();
  });

  it('rejects with ClaudeSpawnError when the executable is missing', async () => {
    await expect(
      runClaude({ command: 'orchtopus-missing-claude-cli', prefixArgs: [] }, ['--version'], {
        cwd: process.cwd(),
        timeoutMs: 5_000,
      }),
    ).rejects.toBeInstanceOf(ClaudeSpawnError);
  });
});
