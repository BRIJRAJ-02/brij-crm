// reCAPTCHA v3 (spec 0023, AC-583): the one place the API calls Google's
// verify endpoint. A token is checked for its action (`form_submit`), its
// hostname (one of the allowed origins) and its score. Google failing to
// answer within 2 seconds, or more than 20 checks in flight in this process,
// is `unavailable`: the submission is stored unchecked, never refused. With
// no secret set (a laptop, a preview), every check is `unavailable`. The
// secret never leaves this module and is never logged.
import type { CaptchaVerdict } from '@crm/core';
import * as z from 'zod';
import { errorFields, log } from '../log.ts';

/** The action the hosted page's token is for. */
export const CAPTCHA_ACTION = 'form_submit';

/** Google's verify endpoint. */
const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/** How long a verify may take before the submission is stored unchecked. */
export const VERIFY_TIMEOUT_MS = 2_000;

/** The most verifies in flight at once in this process (spec 0023, abuse rules). */
export const VERIFY_IN_FLIGHT = 20;

const VerifyAnswer = z.object({
  success: z.boolean(),
  score: z.number().min(0).max(1).optional(),
  action: z.string().optional(),
  hostname: z.string().optional(),
});

/** Checks one token: what the submit path calls. */
export interface CaptchaVerifier {
  verify(token: string | undefined, allowedHosts: ReadonlySet<string>): Promise<CaptchaVerdict>;
}

/** What the verifier needs: the secret (none means every check is unavailable), and the HTTP call (tests pass one). */
export interface CaptchaDeps {
  readonly secret?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** A verifier against Google, bounded in time and in how many run at once. */
export function createCaptchaVerifier(deps: CaptchaDeps): CaptchaVerifier {
  const call = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? VERIFY_TIMEOUT_MS;
  let inFlight = 0;
  return {
    async verify(token, allowedHosts) {
      if (deps.secret === undefined) return { kind: 'unavailable' };
      if (token === undefined || token.trim() === '') return { kind: 'missing' };
      if (inFlight >= VERIFY_IN_FLIGHT) return { kind: 'unavailable' };
      inFlight += 1;
      try {
        const response = await call(VERIFY_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ secret: deps.secret, response: token }).toString(),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return { kind: 'unavailable' };
        const answer = VerifyAnswer.safeParse(await response.json());
        if (!answer.success) return { kind: 'unavailable' };
        const { success, score, action, hostname } = answer.data;
        if (!success || action !== CAPTCHA_ACTION || hostname === undefined || !allowedHosts.has(hostname)) {
          return { kind: 'invalid' };
        }
        return score === undefined ? { kind: 'invalid' } : { kind: 'score', score };
      } catch (error) {
        log.warn('reCAPTCHA verify did not answer', errorFields(error));
        return { kind: 'unavailable' };
      } finally {
        inFlight -= 1;
      }
    },
  };
}
