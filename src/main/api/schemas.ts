// zod schemas for request bodies of the local API. Each later task adds the schemas of its
// routes here. Handlers validate with parseBody, which answers invalid input with 422.
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { branchPrefixSchema, copyListEntrySchema } from '../projects/project-config';
import { HttpError } from './router';

/** Parses a request body; on failure throws HttpError 422 naming the first invalid field. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue?.path.map(String).join('.') ?? '';
  throw new HttpError(422, issue?.message ?? 'Invalid request', field === '' ? undefined : field);
}

// Project routes (Task 8).

/** An absolute local folder path. */
export const folderPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => isAbsolute(p) && !p.includes('\0'), { error: 'Use an absolute folder path' });

/** Ids that clients make up for idempotent requests; they become part of event ids. */
export const requestIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/, { error: 'Use 8 to 64 letters, digits or dashes' });

/** A check command; blank text means "no command". */
const checkCommandSchema = z
  .string()
  .max(1000)
  .nullable()
  .transform((c) => (c === null || c.trim() === '' ? null : c.trim()));

export const inspectProjectSchema = z.object({ path: folderPathSchema });

export const addProjectSchema = z.object({
  path: folderPathSchema,
  checkCommands: z.object({
    test: checkCommandSchema,
    lint: checkCommandSchema,
    typecheck: checkCommandSchema,
  }),
  copyList: z.array(copyListEntrySchema).max(200),
  branchPrefix: branchPrefixSchema,
  requestId: requestIdSchema,
});
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
