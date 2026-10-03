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

const Refusal = z.object({ code: z.string().optional(), message: z.string().optional() });

/** Plain sentences for Better Auth's own codes the sign in screens show. */
const MESSAGES: Readonly<Record<string, string>> = {
  INVALID_OTP: "That code isn't right. Check it, or send a new one.",
  OTP_EXPIRED: 'That code has expired. Send a new one.',
  TOO_MANY_ATTEMPTS: 'Too many wrong tries for this code. Send a new one.',
};

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
export async function authErrorResponse(response: Response): Promise<Response> {
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
    return json(
      { code: 'RATE_LIMITED', message: message ?? 'Too many tries. Wait a moment, then try again.' },
      errorStatus('RATE_LIMITED'),
      headers,
    );
  }
  if (response.status >= 500) {
    log.error('Sign in route failed', { status: response.status, code });
    return json({ code: 'INTERNAL', message: 'Something went wrong on our side.' }, 500, response.headers);
  }
  const answered = code ?? BY_STATUS[response.status] ?? 'INPUT_INVALID';
  return json(
    { code: answered, message: MESSAGES[answered] ?? message ?? 'This request was refused.' },
    response.status,
    response.headers,
  );
}
