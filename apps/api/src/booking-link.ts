// The key a booking's guest page token derives from (spec 0025, milestone 2,
// core's `booking/tokens.ts`). The api mints tokens and the worker writes the
// same links into emails, so both derive the same 32 bytes: from
// BOOKING_LINK_SECRET when it is set, else from WORKER_WAKE_SECRET (required
// on both outside local, the same value), each through HKDF with this
// purpose's own label, so the key never equals the secret it came from.
// Locally, with neither set, a fixed laptop key. Changing the secret it comes
// from stops every guest link already sent.
import { hkdfSync } from 'node:crypto';
import type { ManageLinkKey } from '@crm/core';

/** A laptop's secret, when nothing else is set: never a deployed one (the env check requires the wake secret there). */
const LOCAL_LINK_SECRET = 'local-only-booking-link-secret-not-for-deployment';

/** The label that keeps this key apart from anything else derived from the same secret. */
const LABEL = 'crm booking manage link v1';

/** The guest page key from the environment, as the api and the worker both derive it. */
export function bookingLinkKey(env: {
  readonly APP_ENV: string;
  readonly BOOKING_LINK_SECRET?: string | undefined;
  readonly WORKER_WAKE_SECRET?: string | undefined;
}): ManageLinkKey {
  const secret = env.BOOKING_LINK_SECRET ?? env.WORKER_WAKE_SECRET;
  if (secret === undefined && env.APP_ENV !== 'local') {
    throw new Error('Set BOOKING_LINK_SECRET or WORKER_WAKE_SECRET: booking links need a key outside local.');
  }
  return Buffer.from(hkdfSync('sha256', secret ?? LOCAL_LINK_SECRET, '', LABEL, 32));
}
