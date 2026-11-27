// Logged, idempotent, resumable actions (spec section 8).
// An action is logged before its first step runs. Each finished step is logged with its result,
// so after a crash the same action id continues at the first step that has no result yet.
import { randomUUID } from 'node:crypto';
import type { ActionKind } from '../../shared/events';
import type { Store } from './event-log';
import { getAction, listPendingActions, type ActionRecord } from './projections';

export type { ActionKind } from '../../shared/events';
export type { ActionRecord, ActionStatus, ActionStepRecord } from './projections';

export interface ActionRunner {
  /**
   * Starts an action, or another attempt of a pending one with the same id.
   * A finished or failed action is returned as stored and nothing is logged.
   */
  begin(kind: ActionKind, params: unknown, actionId?: string): ActionRecord;
  /** Runs a step once. A step already recorded returns its stored result without running. */
  step<T>(actionId: string, name: string, run: () => Promise<T>): Promise<T>;
  finish(actionId: string, result: unknown): ActionRecord;
  fail(actionId: string, error: string): ActionRecord;
  pending(): ActionRecord[];
  get(actionId: string): ActionRecord | undefined;
}

export function createActionRunner(store: Store, clock: () => string): ActionRunner {
  const load = (actionId: string): ActionRecord => {
    const record = getAction(store.db, actionId);
    if (!record) throw new Error(`unknown action ${actionId}`);
    return record;
  };

  const loadPending = (actionId: string): ActionRecord => {
    const record = load(actionId);
    if (record.status !== 'pending') {
      throw new Error(`action ${actionId} is not pending (${record.status})`);
    }
    return record;
  };

  return {
    begin(kind, params, actionId = randomUUID()) {
      const existing = getAction(store.db, actionId);
      if (existing && existing.status !== 'pending') return existing;
      const attempt = (existing?.attempts ?? 0) + 1;
      store.append({
        id: `action:${actionId}:started:${String(attempt)}`,
        type: 'action.started',
        at: clock(),
        payload: { actionId, kind, params },
      });
      return load(actionId);
    },

    async step<T>(actionId: string, name: string, run: () => Promise<T>): Promise<T> {
      const done = load(actionId).steps.find((s) => s.name === name);
      if (done) return done.result as T;
      loadPending(actionId);
      const result = await run();
      store.append({
        id: `action:${actionId}:step:${name}`,
        type: 'action.step',
        at: clock(),
        payload: { actionId, name, result },
      });
      // Return the stored form, so a resumed run sees exactly what a first run saw.
      const stored = load(actionId).steps.find((s) => s.name === name);
      return stored?.result as T;
    },

    finish(actionId, result) {
      loadPending(actionId);
      store.append({
        id: `action:${actionId}:finished`,
        type: 'action.finished',
        at: clock(),
        payload: { actionId, result },
      });
      return load(actionId);
    },

    fail(actionId, error) {
      loadPending(actionId);
      store.append({
        id: `action:${actionId}:failed`,
        type: 'action.failed',
        at: clock(),
        payload: { actionId, error },
      });
      return load(actionId);
    },

    pending: () => listPendingActions(store.db),
    get: (actionId) => getAction(store.db, actionId),
  };
}
