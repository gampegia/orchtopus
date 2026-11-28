// zod schemas for request bodies of the local API. Each later task adds the schemas of its
// routes here. Handlers validate with parseBody, which answers invalid input with 422.
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { validateTaskName } from '../../shared/task-name';
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

/** A local drive path such as `C:\x` or `C:/x`. Rejects UNC (`\\host`, `//host`), device
 *  (`\\?\`, `//./`) and drive-less rooted paths before any file system call touches them, so
 *  git and fs never reach a network host (which could leak the NTLM hash). */
export const DRIVE_PATH = /^[A-Za-z]:[\\/]/;

/** An absolute local folder path on a drive. */
export const folderPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => DRIVE_PATH.test(p) && isAbsolute(p) && !p.includes('\0'), {
    error: 'Use an absolute folder path on a local drive',
  });

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

// Session routes (Task 12).

const taskNameSchema = z.string().superRefine((value, ctx) => {
  const error = validateTaskName(value);
  if (error !== null) ctx.addIssue({ code: 'custom', message: error });
});

/** POST /v1/sessions. The first prompt is optional (check T3). */
export const startSessionSchema = z.object({
  projectId: z.string().min(1).max(128),
  task: taskNameSchema,
  branch: z.string().min(1).max(255),
  base: z.enum(['remote', 'local']),
  prompt: z.string().max(100_000).nullable(),
  model: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,127}$/, { error: 'Use a model name such as opus' })
    .nullable(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullable(),
  mode: z.enum(['auto', 'manual']),
  requestId: requestIdSchema,
});

/** POST /v1/sessions/:id/open */
export const openSessionSchema = z.object({
  cols: z.int().min(1).max(500),
  rows: z.int().min(1).max(300),
});

/** DELETE /v1/sessions/:id */
export const removeSessionSchema = z.object({
  confirm: z.literal(true, { error: 'Confirm the removal' }),
});

/** POST /v1/sessions/:id/reveal */
export const revealSessionSchema = z.object({ target: z.enum(['explorer', 'vscode']) });
