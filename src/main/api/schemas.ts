// zod schemas for request bodies of the local API. Each later task adds the schemas of its
// routes here. Handlers validate with parseBody, which answers invalid input with 422.
import { z } from 'zod';
import { HttpError } from './router';

/** Parses a request body; on failure throws HttpError 422 naming the first invalid field. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue?.path.map(String).join('.') ?? '';
  throw new HttpError(422, issue?.message ?? 'Invalid request', field === '' ? undefined : field);
}

// Terminal stream client frames (Task 10). Input is limited to MAX_TERMINAL_INPUT_BYTES of
// UTF-8 by the stream handler; the schema only fixes the shape.
export const terminalClientMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('input'), data: z.string() }),
  z.strictObject({
    type: z.literal('resize'),
    cols: z.int().min(1).max(500),
    rows: z.int().min(1).max(300),
  }),
]);

export type TerminalClientMessage = z.output<typeof terminalClientMessageSchema>;

/** POST /v1/terminals/trust */
export const trustTerminalBodySchema = z.strictObject({ path: z.string().min(1).max(4096) });
