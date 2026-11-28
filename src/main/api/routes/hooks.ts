// POST /v1/hooks/events: envelopes from the hook helper (spec section 5). A new envelope is
// appended to the log and handed to the envelope listener (the state tracker, Task 11); a known
// id answers 200 and changes nothing, so a helper that retries or also spooled is harmless.
import { parseEnvelope, type HookEnvelope } from '../../../shared/hook-envelope';
import { envelopeToEvent } from '../../hooks/envelope-event';
import type { Store } from '../../store/event-log';
import { HttpError, type RouteTable } from '../router';

export type EnvelopeListener = (envelope: HookEnvelope) => void;

let listener: EnvelopeListener | null = null;

/** Sets the function that sees every new envelope; null removes it. */
export function setEnvelopeListener(fn: EnvelopeListener | null): void {
  listener = fn;
}

export function createHookRoutes(deps: {
  store: Store;
  log?: (message: string) => void;
}): RouteTable {
  return {
    'POST /v1/hooks/events': (req) => {
      const envelope = parseEnvelope(req.body);
      if (envelope === null) throw new HttpError(422, 'Not a valid hook envelope');
      const { duplicate } = deps.store.append(envelopeToEvent(deps.store.db, envelope));
      if (!duplicate) {
        try {
          listener?.(envelope);
        } catch (error) {
          // The event is stored; a failing listener must not make the helper spool it again.
          deps.log?.(
            `Envelope listener failed: ${error instanceof Error ? error.message : 'error'}`,
          );
        }
      }
      return Promise.resolve({ status: duplicate ? 200 : 202 });
    },
  };
}
