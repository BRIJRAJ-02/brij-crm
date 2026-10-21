// The key an email's preferences link is signed with (the emails lane, core's
// `emails/preferences.ts`). The worker signs the links it draws into optional
// emails and the api checks them on the preferences page, so both derive the
// same 32 bytes, from the secrets a booking's guest links come from:
// BOOKING_LINK_SECRET when it is set, else WORKER_WAKE_SECRET (required on
// both outside local, the same value), through HKDF with this purpose's own
// label, so the key equals neither the secret nor the guest link key. Locally,
// with neither set, a fixed laptop key. Changing the secret stops every
// preferences link already sent; the next email carries a working one.
import { hkdfSync } from 'node:crypto';
import type { EmailLinkKey } from '@crm/core';

/** A laptop's secret, when nothing else is set: never a deployed one (the env check requires the wake secret there). */
const LOCAL_LINK_SECRET = 'local-only-email-link-secret-not-for-deployment';

/** The label that keeps this key apart from anything else derived from the same secret. */
const LABEL = 'crm email preferences link v1';

/** The preferences link key from the environment, as the api and the worker both derive it. */
export function emailLinkKey(env: {
  readonly APP_ENV: string;
  readonly BOOKING_LINK_SECRET?: string | undefined;
  readonly WORKER_WAKE_SECRET?: string | undefined;
}): EmailLinkKey {
  const secret = env.BOOKING_LINK_SECRET ?? env.WORKER_WAKE_SECRET;
  if (secret === undefined && env.APP_ENV !== 'local') {
    throw new Error('Set BOOKING_LINK_SECRET or WORKER_WAKE_SECRET: email preference links need a key outside local.');
  }
  return Buffer.from(hkdfSync('sha256', secret ?? LOCAL_LINK_SECRET, '', LABEL, 32));
}
