// The envelope the hook helper sends to the local API (or appends to the spool) for every hook
// and status line call. Shared by the helper bundle and the app, so it imports nothing: the
// helper must start fast and must not pull in zod.
//
// Only the fields the app needs are kept. Prompt text, tool input and transcript paths never
// enter an envelope.

export type EnvelopeMode = 'hook' | 'statusline';

export type EnvelopeValue = string | number | boolean | null;

export interface HookEnvelope {
  v: 1;
  /** Made by the helper; becomes the event id, so a spooled envelope is imported once. */
  id: string;
  at: string;
  mode: EnvelopeMode;
  /** Hook event name (`SessionStart`, `Stop`, …) or `statusline`. */
  hook: string;
  /** Claude Code's session id, when the input carried one. */
  sessionId: string | null;
  cwd: string | null;
  fields: Record<string, EnvelopeValue>;
}

/** Fields kept from a hook input, copied as they are when they are plain values. */
export const HOOK_FIELDS = [
  'source',
  'tool_name',
  'notification_type',
  'reason',
  'stop_hook_active',
  'permission_mode',
  // Set by the PR block (Task 7): the matched command kind.
  'blocked',
] as const;

/** Fields kept from a status line input, under the names the app uses. */
export const STATUSLINE_FIELDS = [
  'contextPct',
  'fiveHourPct',
  'fiveHourResetsAt',
  'sevenDayPct',
  'sevenDayResetsAt',
  'model',
] as const;

const KEPT_FIELDS: ReadonlySet<string> = new Set<string>([...HOOK_FIELDS, ...STATUSLINE_FIELDS]);

/**
 * Caps that keep one spool line and one API body small. They count characters, not bytes: a
 * long non-ASCII cwd can make a line a few KiB, which is fine (see spool-append.ts).
 */
export const MAX_ID_LENGTH = 64;
export const MAX_HOOK_LENGTH = 64;
export const MAX_SESSION_ID_LENGTH = 128;
export const MAX_CWD_LENGTH = 1024;
export const MAX_FIELD_LENGTH = 256;

const ID_PATTERN = /^[A-Za-z0-9-]+$/;
/** A hook event name as an envelope carries it. */
export const HOOK_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isShortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function optionalString(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  return isShortString(value, max) ? value : undefined;
}

/** A plain value as kept in `fields`; undefined when the value is not one. */
export function envelopeValue(value: unknown): EnvelopeValue | undefined {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.length <= MAX_FIELD_LENGTH ? value : undefined;
  return undefined;
}

/**
 * Checks an envelope from the API body or a spool line. Returns null when it is not one.
 * Unknown or non-plain fields are dropped, so nothing outside the kept list reaches the log.
 */
export function parseEnvelope(value: unknown): HookEnvelope | null {
  if (!isRecord(value) || value['v'] !== 1) return null;
  const { id, at, mode, hook } = value;
  if (!isShortString(id, MAX_ID_LENGTH) || !ID_PATTERN.test(id)) return null;
  if (!isTimestamp(at)) return null;
  if (mode !== 'hook' && mode !== 'statusline') return null;
  if (!isShortString(hook, MAX_HOOK_LENGTH) || !HOOK_PATTERN.test(hook)) return null;
  const sessionId = optionalString(value['sessionId'], MAX_SESSION_ID_LENGTH);
  const cwd = optionalString(value['cwd'], MAX_CWD_LENGTH);
  if (sessionId === undefined || cwd === undefined) return null;
  const rawFields = value['fields'];
  if (!isRecord(rawFields)) return null;
  const fields: Record<string, EnvelopeValue> = {};
  for (const [key, raw] of Object.entries(rawFields)) {
    if (!KEPT_FIELDS.has(key)) continue;
    const kept = envelopeValue(raw);
    if (kept !== undefined) fields[key] = kept;
  }
  return { v: 1, id, at, mode, hook, sessionId, cwd, fields };
}
