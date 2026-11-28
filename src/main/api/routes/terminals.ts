// Trust-step terminals (spec section 2, step 4): plain `claude` in a folder, so the user can
// answer Claude Code's own trust prompt. Session terminals are opened by the session service.
//   POST   /v1/terminals/trust { path }  → { terminalId }
//   DELETE /v1/terminals/:id             → 204; trust terminals only (killed at once, nothing typed)
import { realpath, stat } from 'node:fs/promises';
import type { TerminalRegistry } from '../../adapter/terminals';
import { HttpError, type RouteTable } from '../router';
import { DRIVE_PATH, parseBody, trustTerminalBodySchema } from '../schemas';

/** The first size of a trust terminal; the client sends its real size on connect. */
export const TRUST_TERMINAL_SIZE = { cols: 120, rows: 30 } as const;

/** The real path of an existing local folder, or null. The real path is checked too, so a
 *  junction or symlink cannot lead to a network share, and the caller uses it, so a junction
 *  swapped after the check cannot either. */
async function localFolder(path: string): Promise<string | null> {
  if (!DRIVE_PATH.test(path)) return null;
  try {
    const real = await realpath(path);
    if (!DRIVE_PATH.test(real)) return null;
    return (await stat(real)).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

export function createTerminalRoutes(deps: { registry: TerminalRegistry }): RouteTable {
  const { registry } = deps;
  return {
    'POST /v1/terminals/trust': async (req) => {
      const { path } = parseBody(trustTerminalBodySchema, req.body);
      const folder = await localFolder(path);
      if (folder === null) throw new HttpError(422, 'Not an existing local folder', 'path');
      const terminalId = await registry.openTrust(folder, { ...TRUST_TERMINAL_SIZE });
      return { status: 200, body: { terminalId } };
    },

    'DELETE /v1/terminals/:id': async (req) => {
      const closed = await registry.closeTrust(req.params['id'] ?? '');
      if (!closed) throw new HttpError(404, 'No trust terminal with this id');
      return { status: 204 };
    },
  };
}
