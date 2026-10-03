// What the sign in pages say when a step is refused (spec 0005): the
// server's sentence, except where the page knows better: the real wait from
// `Retry-After`, the closed sign up said plainly, a wrong code that doesn't
// offer a new one while none can be sent, and Google's refusal codes in our
// own words. Pure, so the rules are tested on their own.
import { isDataError } from '@crm/data';
import { strings } from './strings.ts';

/** A refusal's sentence: the DataError's message, or the thrown value as text. */
const messageOf = (error: unknown): string => (isDataError(error) ? error.message : String(error));

/** Why sending a code was refused (Continue on `/sign-in`, and Google failing to start). */
export function sendRefusal(error: unknown): string {
  if (!isDataError(error)) return messageOf(error);
  if (error.code === 'SIGNUP_CLOSED') return strings.signUpClosed;
  if (error.code === 'RATE_LIMITED' && error.retryAfterSeconds !== undefined) {
    return strings.sendLimited(error.retryAfterSeconds);
  }
  return error.message;
}

/**
 * Why "Send a new code" was refused on `/verify`. A rate limit says only what
 * happened: the wait line under the button counts the server's wait down, so
 * the time isn't said twice (and the Callout's copy never goes stale).
 */
export function resendRefusal(error: unknown): string {
  if (isDataError(error) && error.code === 'RATE_LIMITED' && error.retryAfterSeconds !== undefined) {
    return strings.resendLimited;
  }
  return sendRefusal(error);
}

/** Codes after which the code can't be used again: a new one has to be sent. */
const SPENT = new Set(['TOO_MANY_ATTEMPTS', 'OTP_EXPIRED', 'RATE_LIMITED']);

/** Why a code was refused, and whether it is spent (the boxes turn off until a new code is sent). */
export function verifyRefusal(
  error: unknown,
  isResendWaiting: boolean,
): { readonly message: string; readonly isSpent: boolean } {
  if (!isDataError(error)) return { message: messageOf(error), isSpent: false };
  const isSpent = SPENT.has(error.code);
  if (error.code === 'RATE_LIMITED' && error.retryAfterSeconds !== undefined) {
    return { message: strings.verifyLimited(error.retryAfterSeconds), isSpent };
  }
  // "Check it, or send a new one" offers what the page can't do yet.
  if (error.code === 'INVALID_OTP' && isResendWaiting) return { message: strings.codeWrongWaiting, isSpent };
  return { message: error.message, isSpent };
}

/** Google's refusal codes (`/sign-in?error=`, lowercase from Better Auth) that mean sign up is closed. */
const GOOGLE_SIGN_UP_CLOSED = new Set(['signup_closed', 'signup_disabled', 'unable_to_create_user']);

/** What a refused Google sign in says on `/sign-in`, from the `?error=` code it came back with; never the code itself. */
export function googleRefusal(code: string): string {
  const known = code.toLowerCase();
  if (GOOGLE_SIGN_UP_CLOSED.has(known)) return strings.googleSignUpClosed;
  if (known === 'access_denied') return strings.googleCancelled;
  return strings.googleFailed;
}
