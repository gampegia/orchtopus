// Turns a hook envelope into an event of the log, for the hook route and the spool import alike.
import { resolve, sep } from 'node:path';
import type { HookReceivedPayload, StatuslineReceivedPayload } from '../../shared/events';
import type { EnvelopeValue, HookEnvelope } from '../../shared/hook-envelope';
import type { Db } from '../store/db';
import type { NewEvent } from '../store/event-rows';
import { getSession, listSessions } from '../store/projections';

/** Case-insensitive on Windows, separators unified, no trailing separator. */
function normalizePath(path: string): string {
  const resolved = resolve(path).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function contains(folder: string, path: string): boolean {
  return path === folder || path.startsWith(folder + sep);
}

/**
 * The Orchtopus session an envelope belongs to: the one with this Claude session id, else the
 * one whose worktree contains the envelope's cwd (hooks such as SessionStart fire before the
 * adapter knows the id). With nested worktrees the innermost wins. Null when none fits.
 */
export function matchSession(db: Db, envelope: HookEnvelope): string | null {
  const sessions = listSessions(db);
  if (envelope.sessionId !== null) {
    const byId = sessions.find((s) => s.claudeSessionId === envelope.sessionId);
    if (byId) return byId.id;
  }
  if (envelope.cwd === null) return null;
  const cwd = normalizePath(envelope.cwd);
  let best: { id: string; length: number } | null = null;
  for (const session of sessions) {
    const folder = normalizePath(session.worktreePath);
    if (contains(folder, cwd) && (best === null || folder.length > best.length)) {
      best = { id: session.id, length: folder.length };
    }
  }
  return best?.id ?? null;
}

function numberOrNull(value: EnvelopeValue | undefined): number | null {
  return typeof value === 'number' ? value : null;
}

function statuslinePayload(fields: Record<string, EnvelopeValue>): StatuslineReceivedPayload {
  const payload: StatuslineReceivedPayload = {};
  // Absent keys stay absent, so a status line without them does not reset stored values.
  if ('contextPct' in fields) payload.contextPct = numberOrNull(fields['contextPct']);
  const limitKeys = ['fiveHourPct', 'fiveHourResetsAt', 'sevenDayPct', 'sevenDayResetsAt'];
  if (limitKeys.some((key) => key in fields)) {
    payload.rateLimits = Object.fromEntries(
      limitKeys.map((key) => [key, numberOrNull(fields[key])]),
    );
  }
  if ('model' in fields) {
    payload.model = typeof fields['model'] === 'string' ? fields['model'] : null;
  }
  return payload;
}

/** The event for an envelope; its id is the envelope id, so a second delivery is a duplicate. */
export function envelopeToEvent(db: Db, envelope: HookEnvelope): NewEvent {
  const sessionId = matchSession(db, envelope);
  const session = sessionId === null ? undefined : getSession(db, sessionId);
  const base = {
    id: envelope.id,
    at: envelope.at,
    ...(session ? { sessionId: session.id, projectId: session.projectId } : {}),
  };
  if (envelope.mode === 'statusline') {
    return { ...base, type: 'statusline.received', payload: statuslinePayload(envelope.fields) };
  }
  const payload: HookReceivedPayload = {
    hookEventName: envelope.hook,
    data: { claudeSessionId: envelope.sessionId, fields: envelope.fields },
  };
  return { ...base, type: 'hook.received', payload };
}
