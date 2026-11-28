import { describe, expect, it } from 'vitest';
import {
  AgentsListError,
  AgentsParseError,
  filterByCwd,
  listAgents,
  parseAgentsJson,
  type AgentEntry,
} from './agents';
import type { ClaudeCommand } from './cli';

function nodeScript(source: string): ClaudeCommand {
  return { command: process.execPath, prefixArgs: ['-e', source, '--'] };
}

// The entry shape observed in the spike (Q1): background entries carry
// state, status and waitingFor; interactive entries have no state.
const observed = JSON.stringify([
  {
    pid: 4242,
    id: '1a2b3c4d',
    cwd: 'C:\\Repos\\acme-app\\.claude\\worktrees\\upload-fix',
    kind: 'background',
    startedAt: 1795000000000,
    sessionId: '1a2b3c4d-0000-4000-8000-000000000001',
    name: 'upload-fix',
    status: 'waiting',
    state: 'blocked',
    waitingFor: 'permission prompt',
  },
  {
    pid: 4343,
    id: '5e6f7a8b',
    cwd: 'C:\\Repos\\acme-app',
    kind: 'interactive',
    startedAt: 1795000001000,
    sessionId: '5e6f7a8b-0000-4000-8000-000000000002',
    status: 'busy',
  },
]);

function entry(cwd: string, id = 'x'): AgentEntry {
  return {
    id,
    sessionId: null,
    cwd,
    kind: 'background',
    state: null,
    status: null,
    waitingFor: null,
    name: null,
    startedAt: null,
    pid: null,
  };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (err: unknown) => err,
  );
}

describe('parseAgentsJson', () => {
  it("parses the spike's observed entry shape", () => {
    expect(parseAgentsJson(observed)).toEqual([
      {
        id: '1a2b3c4d',
        sessionId: '1a2b3c4d-0000-4000-8000-000000000001',
        cwd: 'C:\\Repos\\acme-app\\.claude\\worktrees\\upload-fix',
        kind: 'background',
        state: 'blocked',
        status: 'waiting',
        waitingFor: 'permission prompt',
        name: 'upload-fix',
        startedAt: 1795000000000,
        pid: 4242,
      },
      {
        id: '5e6f7a8b',
        sessionId: '5e6f7a8b-0000-4000-8000-000000000002',
        cwd: 'C:\\Repos\\acme-app',
        kind: 'interactive',
        state: null,
        status: 'busy',
        waitingFor: null,
        name: null,
        startedAt: 1795000001000,
        pid: 4343,
      },
    ]);
  });

  it('accepts an ISO startedAt and an empty list', () => {
    const [first] = parseAgentsJson(
      JSON.stringify([
        { id: 'a', cwd: 'C:\\r', kind: 'background', startedAt: '2026-11-27T10:00:00.000Z' },
      ]),
    );
    expect(first?.startedAt).toBe(Date.parse('2026-11-27T10:00:00.000Z'));
    expect(parseAgentsJson('[]\n')).toEqual([]);
  });

  it('skips entries without an id or cwd and fills missing fields with null', () => {
    const parsed = parseAgentsJson(
      JSON.stringify([
        { cwd: 'C:\\r' },
        { id: 'a' },
        null,
        'x',
        { id: 'b', cwd: 'C:\\r', pid: 'no', startedAt: 'never' },
      ]),
    );
    expect(parsed).toEqual([{ ...entry('C:\\r', 'b'), kind: '' }]);
  });

  it('throws AgentsParseError for "Error: …"', () => {
    for (const text of ['Error: supervisor not running', '', '{"agents":[]}']) {
      let caught: unknown = null;
      try {
        parseAgentsJson(text);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AgentsParseError);
      expect(caught).toBeInstanceOf(AgentsListError);
      expect((caught as AgentsListError).cause).toBe('parse');
    }
  });
});

describe('listAgents', () => {
  it('runs agents --json --all without --cwd and parses the output', async () => {
    const cmd = nodeScript(
      "console.log(JSON.stringify([{ id: process.argv.slice(1).join(' '), cwd: 'C:/r', kind: 'background' }]))",
    );
    const [first] = await listAgents(cmd);
    expect(first?.id).toBe('agents --json --all');
  });

  it.each([
    ['parse', 'console.log("Error: updating")', 5_000],
    ['exit', 'console.log("[]"); process.exit(1)', 5_000],
    ['timeout', 'setTimeout(() => {}, 20000)', 300],
  ] as const)('throws AgentsListError with cause %s', async (cause, source, timeoutMs) => {
    const err = await failure(listAgents(nodeScript(source), { timeoutMs }));
    expect(err).toBeInstanceOf(AgentsListError);
    expect((err as AgentsListError).cause).toBe(cause);
  });

  it('throws AgentsListError with cause spawn for a missing executable', async () => {
    const err = await failure(
      listAgents({ command: 'orchtopus-missing-claude-cli', prefixArgs: [] }),
    );
    expect(err).toBeInstanceOf(AgentsListError);
    expect((err as AgentsListError).cause).toBe('spawn');
  });
});

describe('filterByCwd', () => {
  it('filterByCwd matches the worktree and subfolders, not siblings', () => {
    const dir = 'C:\\r\\.claude\\worktrees\\upload-fix';
    const entries = [
      entry('C:\\r\\.claude\\worktrees\\upload-fix', 'same'),
      entry('c:/R/.claude/worktrees/upload-fix/src', 'sub'),
      entry('C:\\r\\.claude\\worktrees\\upload-fix\\', 'trailing'),
      entry('C:\\r\\.claude\\worktrees\\upload-fix-2', 'sibling'),
      entry('C:\\r', 'parent'),
    ];
    expect(filterByCwd(entries, dir).map((e) => e.id)).toEqual(['same', 'sub', 'trailing']);
    expect(filterByCwd(entries, `${dir}\\`).map((e) => e.id)).toEqual(['same', 'sub', 'trailing']);
  });
});
