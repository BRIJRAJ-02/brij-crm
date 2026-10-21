// What a refusal from Better Auth's routes looks like on the wire: the same
// `{ code, message }` every other API error has. Our own refusals in its
// hooks already carry codes from the shared map (`SIGNUP_CLOSED`,
// `RATE_LIMITED`, `INPUT_INVALID`); its own keep their codes (`INVALID_OTP`,
// `OTP_EXPIRED`, `TOO_MANY_ATTEMPTS`) with a plain sentence; its rate limiter
// becomes `RATE_LIMITED` with `Retry-After`; and a fault is `INTERNAL`,
// logged, never detailed.
import { type ErrorCode, errorStatus, retryAfterSeconds } from '@crm/contracts';
import * as z from 'zod';
import { log } from '../log.ts';
import { captureFault } from '../monitoring/sentry.ts';

const Refusal = z.object({ code: z.string().optional(), message: z.string().optional() });

/** Plain sentences for Better Auth's own codes the sign in screens show. */
const MESSAGES: Readonly<Record<string, string>> = {
  INVALID_OTP: 'That code isn’t right. Try again, or send a new one.',
  OTP_EXPIRED: 'That code has expired. Send a new one.',
  TOO_MANY_ATTEMPTS: 'Too many wrong tries for this code. Send a new one.',
};

/**
 * The two factor plugin's codes, as ours (spec 0033, AC-882): a wrong app or
 * backup code, a second step that ran out or had too many wrong codes, and
 * the account locked for a while.
 */
const TWO_FACTOR_CODES: Readonly<Record<string, { readonly code: ErrorCode; readonly message: string }>> = {
  INVALID_CODE: { code: 'CODE_INVALID', message: 'That code didn’t work. Try the newest code in your app.' },
  INVALID_BACKUP_CODE: { code: 'CODE_INVALID', message: 'That backup code didn’t work. Each one works once.' },
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: {
    code: 'SIGN_IN_EXPIRED',
    message: 'Too many wrong codes for this sign in. Sign in again.',
  },
  INVALID_TWO_FACTOR_COOKIE: { code: 'SIGN_IN_EXPIRED', message: 'This sign in has expired. Sign in again.' },
  TOTP_ALREADY_ENABLED: { code: 'INPUT_INVALID', message: 'Two factor sign in is already on.' },
  TWO_FACTOR_NOT_ENABLED: { code: 'INPUT_INVALID', message: 'Two factor sign in is off.' },
};

/** What a locked second step says (AC-882). */
const LOCKED_MESSAGE = 'Too many wrong codes. Wait 15 minutes, then try again.';

/** The code a refusal without one gets, by its status. */
const BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  400: 'INPUT_INVALID',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN_ORIGIN',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
};

function json(body: { code: string; message: string }, status: number, headers: Headers): Response {
  const next = new Headers(headers);
  next.delete('content-length');
  next.delete('x-retry-after');
  next.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers: next });
}

/** Rewrites an error answer from Better Auth into the shared shape. Success passes through untouched. */
export async function authErrorResponse(response: Response, route = ''): Promise<Response> {
  if (response.status < 400) return response;
  const read: unknown = await response
    .clone()
    .json()
    .catch(() => undefined);
  const refusal = Refusal.safeParse(read);
  const { code, message } = refusal.success ? refusal.data : {};

  if (response.status === 429) {
    const headers = new Headers(response.headers);
    const wait = response.headers.get('retry-after') ?? response.headers.get('x-retry-after');
    headers.set('retry-after', wait ?? String(retryAfterSeconds('RATE_LIMITED')));
    const locked = code === 'ACCOUNT_TEMPORARILY_LOCKED' ? LOCKED_MESSAGE : undefined;
    return json(
      { code: 'RATE_LIMITED', message: locked ?? message ?? 'Too many tries. Wait a moment, then try again.' },
      errorStatus('RATE_LIMITED'),
      headers,
    );
  }
  if (response.status >= 500) {
    log.error('Sign in route failed', { status: response.status, code });
    // Better Auth caught the error itself (its logger has the detail); the report names the route and status.
    captureFault(new Error(`Sign in route answered ${String(response.status)}`), { route: `auth ${route}` });
    return json({ code: 'INTERNAL', message: 'Something went wrong. Try again.' }, 500, response.headers);
  }
  const ours = code === undefined ? undefined : TWO_FACTOR_CODES[code];
  if (ours !== undefined) return json(ours, errorStatus(ours.code), response.headers);
  const answered = code ?? BY_STATUS[response.status] ?? 'INPUT_INVALID';
  return json(
    { code: answered, message: MESSAGES[answered] ?? message ?? 'This request was refused.' },
    response.status,
    response.headers,
  );
}
