// The public form endpoints (spec 0023, 0023-public-surface.md, milestone 1),
// REST under /api/public with no session: the hosted page's read of a live
// form, and its submit. Trust comes only from the public key, the Origin (the
// hosted page's origin for now; sites arrive with milestone 3), the rate
// limits, the bot checks and the server side answer check. The order on
// submit: key and status, Origin, the cheap limits, the body's size and shape,
// then reCAPTCHA, then the core's honeypot, timing and answer check, and one
// insert. Answers never say whether an email already exists, never carry
// record data, and never log an answer.
import { createHmac } from 'node:crypto';
import { ERROR_MAP, formStrings, SUBMIT_BODY_MAX_BYTES, SubmitBody, type ErrorCode } from '@crm/contracts';
import { compilePattern, enterPublicForm, getPublicForm, isRefusal, submitForm, type JobRegistry } from '@crm/core';
import type { Database } from '@crm/db';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { commitWrite } from '../hooks.ts';
import { errorFields, log } from '../log.ts';
import { captureFault } from '../monitoring/sentry.ts';
import type { WakeRelay } from '../realtime/wake.ts';
import { emailsIn, FORM_LIMITS, type RateLimiter } from './limits.ts';
import type { CaptchaVerifier } from './recaptcha.ts';

/** What the public endpoints need: the database, the jobs, the relay's poke, the checks and the settings. */
export interface PublicFormsDeps {
  readonly db: Database;
  readonly jobs: JobRegistry;
  readonly wakeRelay: WakeRelay;
  readonly captcha: CaptchaVerifier;
  readonly limiter: RateLimiter;
  /** The origin hosted pages are served from: submits from anywhere else are refused (milestone 1). */
  readonly publicOrigin: string;
  readonly recaptchaSiteKey?: string;
  /** The salt client addresses are hashed with. */
  readonly ipSalt: string;
}

interface Variables {
  requestId: string;
  clientIp: string | undefined;
  origin: string | undefined;
}

/** A `{ code, message }` answer at the map's status, with field errors when there are some. */
function answer(code: ErrorCode, message: string, fields?: Record<string, string>): Response {
  return Response.json(
    { code, message, ...(fields === undefined ? {} : { fields }) },
    { status: ERROR_MAP[code].status },
  );
}

/** A client address hashed with the salt: what limits and abuse review key on, never the address itself. */
export function hashAddress(salt: string, address: string | undefined): string | undefined {
  return address === undefined ? undefined : createHmac('sha256', salt).update(address).digest('hex').slice(0, 32);
}

/** Answers a refusal from the core, or rethrows anything else to the app's one error handler. */
function refusalAnswer(error: unknown, language: Parameters<typeof formStrings>[0] = 'en'): Response {
  if (!isRefusal(error)) throw error;
  const { refusals } = error;
  const fields = Object.fromEntries(
    refusals.flatMap((refusal) => (refusal.field === undefined ? [] : [[refusal.field, refusal.message]])),
  );
  if (Object.keys(fields).length > 0) {
    return answer('ATTRIBUTE_VALUE_INVALID', formStrings(language).fixErrors, fields);
  }
  const [first] = refusals;
  const code = first?.code ?? 'INTERNAL';
  if (code === 'FORM_CLOSED') return answer('FORM_CLOSED', formStrings(language).closed);
  if (code === 'FORM_CHANGED') return answer('FORM_CHANGED', first?.message ?? '');
  return answer('NOT_FOUND', formStrings(language).notFound);
}

/** Mounts the public form endpoints on the app (`/api` is its base path). */
export function mountPublicForms(app: Hono<{ Variables: Variables }>, deps: PublicFormsDeps): void {
  const allowedHosts = new Set([new URL(deps.publicOrigin).hostname]);

  app.get('/public/forms/:publicKey', async (c) => {
    try {
      const { scope, formId } = await enterPublicForm({ db: deps.db }, c.req.param('publicKey'));
      const form = await getPublicForm(scope, {
        formId,
        ...(deps.recaptchaSiteKey === undefined ? {} : { recaptchaSiteKey: deps.recaptchaSiteKey }),
      });
      // A minute at most: a paused form or a new version shows within it.
      return c.json(form, 200, { 'cache-control': 'public, max-age=60', 'x-robots-tag': 'noindex' });
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  app.post(
    '/public/forms/:publicKey/submissions',
    bodyLimit({
      maxSize: SUBMIT_BODY_MAX_BYTES,
      onError: () => answer('PAYLOAD_TOO_LARGE', 'This submission is larger than the 64 KB a form accepts.'),
    }),
    async (c: Context<{ Variables: Variables }>) => {
      // The instance's own ceiling first: nothing below runs in a flood.
      if (!deps.limiter.hit('instance', FORM_LIMITS.perInstance)) {
        return answer('RATE_LIMITED', formStrings('en').tooMany);
      }
      if (c.get('origin') !== deps.publicOrigin) {
        return answer('FORBIDDEN_ORIGIN', 'This form takes submissions only from its own page.');
      }
      let entered: Awaited<ReturnType<typeof enterPublicForm>>;
      try {
        entered = await enterPublicForm({ db: deps.db }, c.req.param('publicKey') ?? '');
      } catch (error) {
        return refusalAnswer(error);
      }
      const { scope, formId } = entered;
      const ipHash = hashAddress(deps.ipSalt, c.get('clientIp'));
      const address = ipHash ?? 'unknown';
      if (
        !deps.limiter.hit(`form:${formId}:${address}`, FORM_LIMITS.perFormAddress) ||
        !deps.limiter.hit(`workspace:${scope.workspaceId}:${address}`, FORM_LIMITS.perWorkspaceAddress)
      ) {
        return answer('RATE_LIMITED', formStrings('en').tooMany);
      }
      let raw: unknown;
      try {
        raw = JSON.parse(await c.req.text());
      } catch {
        return answer('INPUT_INVALID', 'Send the submission as JSON.');
      }
      const parsed = SubmitBody.safeParse(raw);
      if (!parsed.success) return answer('INPUT_INVALID', 'This submission is not in the shape a form takes.');
      const body = parsed.data;
      for (const email of emailsIn(body.answers)) {
        const key = hashAddress(deps.ipSalt, email) ?? email;
        if (!deps.limiter.hit(`email:${formId}:${key}`, FORM_LIMITS.perFormEmail)) {
          return answer('RATE_LIMITED', formStrings('en').tooMany);
        }
      }
      const captcha = await deps.captcha.verify(body.captcha, allowedHosts);
      try {
        // The visitor's idempotency key doubles as the write's mutation id: no browser follows this write's events.
        const outcome = await commitWrite({ wakeRelay: deps.wakeRelay }, { mutationId: body.idempotencyKey }, (hooks) =>
          submitForm(
            scope,
            deps.jobs,
            { formId, body, captcha, pattern: compilePattern, ...(ipHash === undefined ? {} : { ipHash }) },
            hooks,
          ),
        );
        log.info('form.submission', {
          requestId: c.get('requestId'),
          formId,
          verdict: outcome.verdict,
          replayed: outcome.replayed,
        });
        return c.json({ next: outcome.next }, 200);
      } catch (error) {
        if (isRefusal(error)) return refusalAnswer(error);
        log.error('Form submission failed', { requestId: c.get('requestId'), formId, ...errorFields(error) });
        captureFault(error, { requestId: c.get('requestId'), route: '/api/public/forms/:publicKey/submissions' });
        return answer('INTERNAL', 'Something went wrong. Try again.');
      }
    },
  );
}
