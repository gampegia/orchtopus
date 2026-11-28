// Trust-step terminals (spec section 2, step 4): plain `claude` in a folder, so the user can
// answer Claude Code's own trust prompt. Session terminals are opened by the session service.
//   POST   /v1/terminals/trust { path }  → { terminalId }
//   DELETE /v1/terminals/:id             → 204; trust terminals only (killed at once, nothing typed)
import { realpath, stat } from 'node:fs/promises';
import type { TerminalRegistry } from '../../adapter/terminals';
import { HttpError, type RouteTable } from '../router';
import { parseBody, trustTerminalBodySchema } from '../schemas';

/** The first size of a trust terminal; the client sends its real size on connect. */
export const TRUST_TERMINAL_SIZE = { cols: 120, rows: 30 } as const;

/** A local drive path such as `C:\x` or `C:/x`. Rejects UNC (`\\host`, `//host`), device
 *  (`\\?\`, `//./`) and drive-less rooted paths before any file system call touches them. */
const DRIVE_PATH = /^[A-Za-z]:[\\/]/;

/** True for an existing local folder. The real path is checked too, so a junction or
 *  symlink cannot lead to a network share. */
async function isLocalFolder(path: string): Promise<boolean> {
  if (!DRIVE_PATH.test(path)) return false;
  try {
    const real = await realpath(path);
    if (!DRIVE_PATH.test(real)) return false;
    return (await stat(real)).isDirectory();
  } catch {
    return false;
  }
}

export function createTerminalRoutes(deps: { registry: TerminalRegistry }): RouteTable {
  const { registry } = deps;
  return {
    'POST /v1/terminals/trust': async (req) => {
      const { path } = parseBody(trustTerminalBodySchema, req.body);
      if (!(await isLocalFolder(path))) {
        throw new HttpError(422, 'Not an existing local folder', 'path');
      }
      const terminalId = await registry.openTrust(path, { ...TRUST_TERMINAL_SIZE });
      return { status: 200, body: { terminalId } };
    },

    'DELETE /v1/terminals/:id': async (req) => {
      const closed = await registry.closeTrust(req.params['id'] ?? '');
      if (!closed) throw new HttpError(404, 'No trust terminal with this id');
      return { status: 204 };
    },
  };
}
