// project.json: the per-project config in the data folder (spec section 1, step 5). It is
// written with a temp file and a rename, so a crash never leaves a half-written file.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { isSafeCopyEntry } from '../git/worktrees';
import { renameWithRetry } from '../hooks/install';

export const PROJECT_SCHEMA_VERSION = 1;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_PREFIX_LENGTH = 64;

/**
 * Returns an error text for a branch prefix git could not put in front of a task name, or
 * null when it is valid. An empty prefix is allowed.
 */
export function validateBranchPrefix(prefix: string): string | null {
  if (prefix === '') return null;
  const message = 'Use letters, digits, dots, dashes and slashes, for example orch/.';
  if (prefix.length > MAX_PREFIX_LENGTH) {
    return `Use at most ${String(MAX_PREFIX_LENGTH)} characters.`;
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(prefix)) return message;
  if (prefix.startsWith('/') || prefix.startsWith('-')) return message;
  if (prefix.includes('..') || prefix.includes('//')) return message;
  // Only the last segment may be unfinished; every complete one must be a valid ref part.
  const complete = prefix.split('/').slice(0, -1);
  for (const segment of complete) {
    if (segment.startsWith('.') || segment.endsWith('.lock') || segment.endsWith('.')) {
      return message;
    }
  }
  const last = prefix.split('/').at(-1) ?? '';
  if (last.startsWith('.')) return message;
  return null;
}

export const checkCommandsSchema = z.object({
  test: z.string().nullable(),
  lint: z.string().nullable(),
  typecheck: z.string().nullable(),
});

export const copyListEntrySchema = z.string().min(1).max(260).refine(isSafeCopyEntry, {
  error: 'Use a path inside the repository, without .., and outside .git and .claude/worktrees.',
});

export const branchPrefixSchema = z.string().superRefine((value, ctx) => {
  const error = validateBranchPrefix(value);
  if (error !== null) ctx.addIssue({ code: 'custom', message: error });
});

export const projectConfigSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z
    .string()
    .regex(SAFE_ID)
    .refine((id) => !id.includes('..')),
  name: z.string().min(1),
  path: z.string().min(1),
  defaultBranch: z.string(),
  remotes: z.array(z.object({ name: z.string(), url: z.string() })),
  provider: z.enum(['github', 'gitlab']).nullable(),
  checkCommands: checkCommandsSchema,
  copyList: z.array(copyListEntrySchema),
  branchPrefix: branchPrefixSchema,
  lastStart: z.object({
    model: z.string().nullable(),
    effort: z.string().nullable(),
    mode: z.enum(['auto', 'manual']),
  }),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

/** Reads and validates project.json; throws when it is missing, not JSON or invalid. */
export async function readProjectConfig(file: string): Promise<ProjectConfig> {
  const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
  return projectConfigSchema.parse(raw);
}

/** Validates and writes project.json through a temp file and a rename. */
export async function writeProjectConfig(file: string, config: ProjectConfig): Promise<void> {
  const valid = projectConfigSchema.parse(config);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(valid, null, 2)}\n`, 'utf8');
    await renameWithRetry(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}
