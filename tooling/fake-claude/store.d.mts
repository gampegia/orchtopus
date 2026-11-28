// Types for the parts of store.mjs that TypeScript tests and e2e specs import.

export const FAKE_VERSION: string;
export const PROMPT_BOX: string;
export const TAKEOVER_TEXT: string;

/** JSON lines of the tool calls a session ran (a call denied by a PreToolUse hook is not run). */
export function ranFile(home: string, id: string): string;
