// The environment every child process (git, claude) gets: the app's own
// environment without variables that would make a child think it runs inside
// Claude Code or Electron's Node mode, that redirect the API, or that point
// git at another repository.

const GIT_REPO_VARS = new Set(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']);

function isDropped(key: string): boolean {
  const k = key.toUpperCase();
  return (
    GIT_REPO_VARS.has(k) ||
    k === 'CLAUDECODE' ||
    k === 'CLAUDE_PID' ||
    k === 'ELECTRON_RUN_AS_NODE' ||
    k === 'ANTHROPIC_BASE_URL' ||
    k.startsWith('CLAUDE_CODE_') ||
    k.startsWith('CLAUDE_AGENT_SDK_') ||
    k.startsWith('CLAUDE_PREVIEW_')
  );
}

export function cleanEnv(
  extra: Readonly<Record<string, string>> = {},
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !isDropped(key)) env[key] = value;
  }
  return { ...env, ...extra };
}

// The main process sets this so libuv never runs a git.exe or where.exe planted in a
// repository folder. Claude Code sessions do not get it: inside them cmd.exe would stop
// finding programs in the current folder, which the user's own commands may rely on.
const MAIN_ONLY_VARS = new Set(['NODEFAULTCURRENTDIRECTORYINEXEPATH']);

/** The environment of every process that runs Claude Code (runClaude, `--bg`, attach PTY). */
export function claudeEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(cleanEnv({}, base)).filter(([key]) => !MAIN_ONLY_VARS.has(key.toUpperCase())),
  );
}
