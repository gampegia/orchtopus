// The environment every child process (git, claude) gets: the app's own
// environment without variables that would make a child think it runs inside
// Claude Code or Electron's Node mode, or that redirect the API.

function isDropped(key: string): boolean {
  const k = key.toUpperCase();
  return (
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
