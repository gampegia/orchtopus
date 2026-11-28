// The PR block (spec section 5): finds `gh pr create`, `gh pr merge`, `glab mr create` and
// `glab mr merge` in a shell command line, so the PreToolUse hook can deny it locally.
//
// Bundled into the hook helper, so it imports nothing. It reads Bash and PowerShell command lines
// well enough to find a program call at the start of every simple command (after `&&`, `;`, `|`,
// `&`, a new line, `(`, `$(`, a backtick), with quotes removed, a path or `.exe` on the program,
// leading variable assignments and wrappers like `env`, and inside `bash -c` / `cmd /c` /
// `pwsh -Command` strings. Text inside quotes is never a command, except `$(…)` and backticks
// inside double quotes, which a shell runs. It errs toward blocking. The full set of hard blocks
// (API calls, force pushes, …) comes in M3.

export type PrCommandKind = 'gh-pr-create' | 'gh-pr-merge' | 'glab-mr-create' | 'glab-mr-merge';

export const PR_BLOCK_REASON =
  'Orchtopus does not let sessions create or merge pull requests or merge requests. Commit and push your branch instead; Orchtopus opens the pull request after the user releases the work.';

interface Lexed {
  segments: string[][];
  /** Command substitutions found inside double quotes; checked as commands of their own. */
  nested: string[];
}

const SEPARATORS = new Set(['&', '|', ';', '(', ')', '{', '}', '`', '<', '>', '\n', '\r']);
const BLANKS = new Set([' ', '\t']);
const MAX_DEPTH = 4;

/** Index of the `)` that closes the `(` before `start`, or the end of the text. */
function closingParen(text: string, start: number): number {
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return text.length;
}

function lex(command: string): Lexed {
  const segments: string[][] = [];
  const nested: string[] = [];
  let segment: string[] = [];
  let word: string | null = null;

  const endWord = (): void => {
    if (word !== null) segment.push(word);
    word = null;
  };
  const endSegment = (): void => {
    endWord();
    if (segment.length > 0) segments.push(segment);
    segment = [];
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command.charAt(i);
    if (BLANKS.has(ch)) {
      endWord();
    } else if (SEPARATORS.has(ch)) {
      endSegment();
    } else if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      const stop = end === -1 ? command.length : end;
      word = (word ?? '') + command.slice(i + 1, stop);
      i = stop;
    } else if (ch === '"') {
      let text = '';
      let j = i + 1;
      for (; j < command.length && command[j] !== '"'; j++) {
        const c = command.charAt(j);
        if (c === '\\' && (command[j + 1] === '"' || command[j + 1] === '\\')) {
          text += command.charAt(j + 1);
          j++;
        } else if (c === '$' && command[j + 1] === '(') {
          const close = closingParen(command, j + 2);
          nested.push(command.slice(j + 2, close));
          text += command.slice(j, close + 1);
          j = close;
        } else if (c === '`') {
          const end = command.indexOf('`', j + 1);
          const stop = end === -1 ? command.length : end;
          nested.push(command.slice(j + 1, stop));
          text += command.slice(j, stop + 1);
          j = stop;
        } else {
          text += c;
        }
      }
      word = (word ?? '') + text;
      i = j;
    } else {
      word = (word ?? '') + ch;
    }
  }
  endSegment();
  return { segments, nested };
}

/** The program name as a shell finds it: no folder, no extension, lower case. */
function programName(word: string): string {
  const base = word.split(/[\\/]/).pop() ?? '';
  return base.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, '');
}

const WRAPPERS = new Set(['env', 'command', 'exec', 'time', 'nohup', 'sudo', 'nice', 'start']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'cmd', 'pwsh', 'powershell']);
const SHELL_COMMAND_FLAGS = new Set(['-c', '/c', '/k', '-command', '/command']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** gh and glab options that take a separate value. */
const VALUE_FLAGS = new Set(['-r', '--repo', '--hostname']);

const TOOLS: Readonly<
  Record<string, { group: string; create: PrCommandKind; merge: PrCommandKind }>
> = {
  gh: { group: 'pr', create: 'gh-pr-create', merge: 'gh-pr-merge' },
  glab: { group: 'mr', create: 'glab-mr-create', merge: 'glab-mr-merge' },
};

/** The first two arguments that are not options. */
function positionals(args: readonly string[]): string[] {
  const found: string[] = [];
  for (let i = 0; i < args.length && found.length < 2; i++) {
    const arg = args[i] ?? '';
    if (arg.startsWith('-')) {
      if (VALUE_FLAGS.has(arg.toLowerCase())) i++;
      continue;
    }
    found.push(arg.toLowerCase());
  }
  return found;
}

function detectSegment(words: readonly string[], depth: number): PrCommandKind | null {
  let i = 0;
  for (; i < words.length; i++) {
    const word = words[i] ?? '';
    if (ASSIGNMENT.test(word) || word === '.' || word === '') continue;
    if (WRAPPERS.has(programName(word))) {
      while ((words[i + 1] ?? '').startsWith('-')) i++;
      continue;
    }
    break;
  }
  if (i >= words.length) return null;
  const program = programName(words[i] ?? '');
  const args = words.slice(i + 1);

  if (SHELLS.has(program)) {
    const flag = args.findIndex((arg) => SHELL_COMMAND_FLAGS.has(arg.toLowerCase()));
    return flag === -1 ? null : detect(args.slice(flag + 1).join(' '), depth + 1);
  }

  const tool = TOOLS[program];
  if (tool === undefined) return null;
  const [group, action] = positionals(args);
  if (group !== tool.group) return null;
  if (action === 'create' || action === 'new') return tool.create;
  if (action === 'merge') return tool.merge;
  return null;
}

function detect(command: string, depth: number): PrCommandKind | null {
  if (depth > MAX_DEPTH) return null;
  const { segments, nested } = lex(command);
  for (const words of segments) {
    const kind = detectSegment(words, depth);
    if (kind !== null) return kind;
  }
  for (const inner of nested) {
    const kind = detect(inner, depth + 1);
    if (kind !== null) return kind;
  }
  return null;
}

export function detectPrCommand(command: string): { kind: PrCommandKind } | null {
  const kind = detect(command, 0);
  return kind === null ? null : { kind };
}
