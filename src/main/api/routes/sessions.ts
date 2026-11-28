// Session routes (spec section 4). The service runs every change as a logged action and
// publishes through the state tracker; these handlers only validate and answer.
//   POST   /v1/sessions                 StartSessionInput → 201 SessionView (idempotent by requestId;
//                                       409 { error, field: 'base' } when the fetch failed)
//   POST   /v1/sessions/:id/open        { cols, rows } → 200 { terminalId }
//   POST   /v1/sessions/:id/stop        {} → 204
//   DELETE /v1/sessions/:id             { confirm: true } → 204 (409 for a dirty worktree)
//   POST   /v1/sessions/:id/reveal      { target: 'explorer' | 'vscode' } → 204
import type { SessionService } from '../../sessions/session-service';
import type { RouteTable } from '../router';
import {
  openSessionSchema,
  parseBody,
  removeSessionSchema,
  revealSessionSchema,
  startSessionSchema,
} from '../schemas';

export function createSessionRoutes(deps: { service: SessionService }): RouteTable {
  const { service } = deps;
  return {
    'POST /v1/sessions': async (req) => {
      const input = parseBody(startSessionSchema, req.body);
      return { status: 201, body: await service.start(input) };
    },
    'POST /v1/sessions/:id/open': async (req) => {
      const size = parseBody(openSessionSchema, req.body);
      return { status: 200, body: await service.open(req.params['id'] ?? '', size) };
    },
    'POST /v1/sessions/:id/stop': async (req) => {
      await service.stop(req.params['id'] ?? '');
      return { status: 204 };
    },
    'DELETE /v1/sessions/:id': async (req) => {
      const { confirm } = parseBody(removeSessionSchema, req.body);
      await service.remove(req.params['id'] ?? '', confirm);
      return { status: 204 };
    },
    'POST /v1/sessions/:id/reveal': async (req) => {
      const { target } = parseBody(revealSessionSchema, req.body);
      await service.reveal(req.params['id'] ?? '', target);
      return { status: 204 };
    },
  };
}
