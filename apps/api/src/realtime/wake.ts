// The relay's wake up call (spec 0005, change events). The worker's relay goes
// dormant while nothing is written, so Neon's compute can sleep (see
// `relay.ts`). After a write that may have stored outbox rows commits, the
// write procedure calls `context.wakeRelay()`: the api POSTs, with no body, to
// the worker's internal port at `/internal/outbox-wake`, carrying a shared
// secret. Both halves of that call live here: the api's poke and the worker's
// check of it.
//
// The poke never slows or fails the write: it returns at once, keeps at most
// one call in flight and one queued (a burst of writes becomes two calls),
// gives up after a second, and logs a failure at most once a minute. A lost
// poke only delays delivery until the next poke from any write.
import { createHash, timingSafeEqual } from 'node:crypto';
import { errorFields } from '../log.ts';

/** The worker's path the api pokes. */
export const WAKE_PATH = '/internal/outbox-wake';

/** The header the shared secret (`WORKER_WAKE_SECRET`) travels in. */
export const WAKE_HEADER = 'x-crm-wake';

/** Pokes the worker's relay after a write commits. Returns at once and never throws. */
export type WakeRelay = () => void;

/** A poke that does nothing: tests, and a laptop without `WORKER_INTERNAL_URL`. */
export const NO_WAKE: WakeRelay = () => undefined;

/** How long a poke may take before it counts as failed. */
const WAKE_TIMEOUT_MS = 1_000;

/** The least time between two logged failures. */
const WARN_EVERY_MS = 60_000;

export interface RelayWakeOptions {
  /** The worker's internal base URL (`WORKER_INTERNAL_URL`), like `http://worker.railway.internal:8080`. */
  readonly url: string;
  /** The shared secret; unset only locally, where the worker then takes a poke without one. */
  readonly secret: string | undefined;
  readonly log: { warn(message: string, fields?: Record<string, unknown>): void };
  /** How long one poke may take (default 1 second). */
  readonly timeoutMs?: number;
}

/**
 * The api's poke: coalesced (one in flight, one queued), fire and forget.
 * The request carries no data at all, only the secret: the worker drains
 * whatever is waiting, so a poke can't steer it.
 */
export function createRelayWake(options: RelayWakeOptions): WakeRelay {
  const endpoint = `${options.url.replace(/\/+$/, '')}${WAKE_PATH}`;
  const timeoutMs = options.timeoutMs ?? WAKE_TIMEOUT_MS;
  const headers: Record<string, string> = options.secret === undefined ? {} : { [WAKE_HEADER]: options.secret };
  let inFlight = false;
  let queued = false;
  let lastWarned = Number.NEGATIVE_INFINITY;
  let failedSinceWarned = 0;

  const failed = (error: unknown) => {
    failedSinceWarned += 1;
    const now = Date.now();
    if (now - lastWarned < WARN_EVERY_MS) return;
    options.log.warn('Waking the relay failed; changes publish on the next poke that gets through', {
      failures: failedSinceWarned,
      ...errorFields(error),
    });
    lastWarned = now;
    failedSinceWarned = 0;
  };

  const poke: WakeRelay = () => {
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    let request: Promise<Response>;
    try {
      request = fetch(endpoint, { method: 'POST', headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      // fetch throws at once only on a malformed request; the write still stands.
      inFlight = false;
      failed(error);
      return;
    }
    void request
      .then(async (response) => {
        await response.body?.cancel();
        if (!response.ok) throw new Error(`The worker answered ${String(response.status)}.`);
      })
      .catch(failed)
      .finally(() => {
        inFlight = false;
        if (!queued) return;
        queued = false;
        poke();
      });
  };
  return poke;
}

// Hashing both sides first gives equal lengths for timingSafeEqual, so the
// comparison takes the same time whatever was sent, including its length.
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * The worker's check of a poke: true when it carries the secret. With no
 * secret configured (only allowed locally, `WorkerEnv` refuses it elsewhere)
 * any poke is taken: the worst it can do is wake the relay.
 */
export function createWakeCheck(secret: string | undefined): (presented: string | undefined) => boolean {
  if (secret === undefined) return () => true;
  const expected = digest(secret);
  return (presented) => presented !== undefined && timingSafeEqual(digest(presented), expected);
}
