// Project routes (spec section 1 and 2). The service publishes the `project` and
// `project-removed` stream messages; these handlers only validate and answer.
import type { ProjectService } from '../../projects/project-service';
import type { RouteTable } from '../router';
import { addProjectSchema, inspectProjectSchema, parseBody } from '../schemas';

export function createProjectRoutes(deps: { service: ProjectService }): RouteTable {
  const { service } = deps;
  return {
    'POST /v1/projects/inspect': async (req) => {
      const { path } = parseBody(inspectProjectSchema, req.body);
      return { status: 200, body: await service.inspect(path) };
    },
    'POST /v1/projects': async (req) => {
      const { requestId, ...input } = parseBody(addProjectSchema, req.body);
      return { status: 201, body: await service.add(input, requestId) };
    },
    'DELETE /v1/projects/:id': async (req) => {
      await service.remove(req.params['id'] ?? '');
      return { status: 204 };
    },
    'POST /v1/projects/:id/setup-check': async (req) => ({
      status: 200,
      body: { items: await service.setupCheck(req.params['id'] ?? '') },
    }),
  };
}
