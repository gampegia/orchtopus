// zod schemas for request bodies of the local API. Each later task adds the schemas of its
// routes here. Handlers validate with parseBody, which answers invalid input with 422.
import type { z } from 'zod';
import { HttpError } from './router';

/** Parses a request body; on failure throws HttpError 422 naming the first invalid field. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue?.path.map(String).join('.') ?? '';
  throw new HttpError(422, issue?.message ?? 'Invalid request', field === '' ? undefined : field);
}
