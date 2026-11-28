// Trust-step terminals (spec section 2, step 4): plain `claude` in a folder, so the user can
// answer Claude Code's own trust prompt. Session terminals are opened by the session service.
//   POST   /v1/terminals/trust { path }  → { terminalId }
//   DELETE /v1/terminals/:id             → 204; trust terminals only (writes /exit, kills after 5 s)
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { TerminalRegistry } from '../../adapter/terminals';
import { HttpError, type RouteTable } from '../router';
import { parseBody, trustTerminalBodySchema } from '../schemas';

/** The first size of a trust terminal; the client sends its real size on connect. */
export const TRUST_TERMINAL_SIZE = { cols: 120, rows: 30 } as const;

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export function createTerminalRoutes(deps: { registry: TerminalRegistry }): RouteTable {
  const { registry } = deps;
  return {
    'POST /v1/terminals/trust': async (req) => {
      const { path } = parseBody(trustTerminalBodySchema, req.body);
      if (!isAbsolute(path) || path.startsWith('\\') || !(await isFolder(path))) {
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
