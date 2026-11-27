// Builds the Claude Code flags the product would pass to every session (D3),
// so background, interactive and -p runs use the same set.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './common.mjs';

export const INLINE_PROMPT =
  'If the user asks for the inline marker, reply with ORCH_SYSPROMPT_INLINE_OK.';

/**
 * @param {object} o
 * @param {string} [o.settings]  settings variant name (make-settings --name)
 * @param {string} [o.model]
 * @param {string} [o.effort]
 * @param {string} [o.mode]      permission mode
 * @param {string} [o.sessionId]
 * @param {boolean} [o.base]     add system prompt file, inline prompt, agents, plugin dir
 * @param {string} [o.name]      display name
 */
export function sessionFlags(o = {}) {
  const f = [];
  if (o.settings) f.push('--settings', join(paths.settings, `${o.settings}.json`));
  if (o.model) f.push('--model', o.model);
  if (o.effort) f.push('--effort', o.effort);
  if (o.mode) f.push('--permission-mode', o.mode);
  if (o.sessionId) f.push('--session-id', o.sessionId);
  if (o.name) f.push('--name', o.name);
  if (o.base) {
    f.push('--append-system-prompt-file', paths.systemPrompt);
    f.push('--append-system-prompt', INLINE_PROMPT);
    f.push('--agents', JSON.stringify(JSON.parse(readFileSync(paths.agents, 'utf8'))));
    f.push('--plugin-dir', paths.plugin);
  }
  return f;
}

export const tokenEnv = () => ({
  ORCH_SPIKE_TOKEN: readFileSync(paths.token, 'utf8').trim(),
});
