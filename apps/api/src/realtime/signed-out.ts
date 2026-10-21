// Cutting a person's live connections when one of their sessions is signed
// out from another device (spec 0033, AC-891 and AC-892). The api has no key
// to Centrifugo's server API; the worker does (the relay's). So after the
// session rows are gone, the api POSTs, with no body, to the worker's internal
// port at `/internal/signed-out/<user id>`, carrying the same shared secret as
// the relay's wake call, and the worker asks Centrifugo to close that user's
// connections with code 4501. Every tab of theirs then checks its own session:
// the signed out one goes to sign in, the others reconnect. Both halves live
// here, the api's notice and the worker's reading of its path.
import { SIGNED_OUT_DISCONNECT_CODE } from '@crm/contracts/codes';
import { errorFields } from '../log.ts';
import { WAKE_HEADER } from './wake.ts';

/** The worker's path prefix the api posts a signed out user to. */
export const SIGNED_OUT_PATH = '/internal/signed-out/';

/** What Centrifugo closes the connections with: the terminal "signed out" code. */
export const SIGNED_OUT = { code: SIGNED_OUT_DISCONNECT_CODE, reason: 'signed out' } as const;

/** Tells the worker to cut a user's live connections. Never throws; resolves once the worker answered or gave up. */
export type SignedOutNotice = (userId: string) => Promise<void>;

/** A notice that does nothing: tests, and a laptop without `WORKER_INTERNAL_URL`. */
export const NO_SIGNED_OUT: SignedOutNotice = () => Promise.resolve();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** How long the worker may take to answer. */
const NOTICE_TIMEOUT_MS = 2_000;

export interface SignedOutNoticeOptions {
  /** The worker's internal base URL (`WORKER_INTERNAL_URL`). */
  readonly url: string;
  /** `WORKER_WAKE_SECRET`; unset only locally. */
  readonly secret: string | undefined;
  readonly log: { warn(message: string, fields?: Record<string, unknown>): void };
  readonly timeoutMs?: number;
}

/** The api's half: one POST per signed out user, logged (never thrown) when it fails. */
export function createSignedOutNotice(options: SignedOutNoticeOptions): SignedOutNotice {
  const base = options.url.replace(/\/+$/, '');
  const headers: Record<string, string> = options.secret === undefined ? {} : { [WAKE_HEADER]: options.secret };
  return async (userId) => {
    if (!UUID.test(userId)) return;
    try {
      const response = await fetch(`${base}${SIGNED_OUT_PATH}${userId}`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(options.timeoutMs ?? NOTICE_TIMEOUT_MS),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`The worker answered ${String(response.status)}.`);
    } catch (error) {
      // The ended session still can't make a call; its tab finds out at its next one.
      options.log.warn('Cutting a signed out user’s live connections failed', errorFields(error));
    }
  };
}

/** The worker's half: the user id a signed out path names, or undefined when it names none. */
export function signedOutUser(path: string): string | undefined {
  if (!path.startsWith(SIGNED_OUT_PATH)) return undefined;
  const id = path.slice(SIGNED_OUT_PATH.length);
  return UUID.test(id) ? id : undefined;
}
