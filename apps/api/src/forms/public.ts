// The public form endpoints (spec 0023, 0023-experience.md; 0023-public-surface.md),
// REST under /api/public with no session: the hosted page's read of a live
// form, and its submit. Trust comes only from the address, the Origin (the
// hosted page's own, or one of the sites a form lists for "Your own form",
// whose posts may have to be signed with the form's secret), the rate limits,
// the bot checks and the server side answer check. The order on submit: the
// instance's ceiling, the address and its form, the Origin or the signature,
// the per address, per address in the workspace and per form limits, the
// body's size and shape, the per email limit (a spam sign, never a 429), the
// fill ticket, reCAPTCHA when
// it is on, then the core's spam checks (honeypot, fill time, content score)
// and answer check and one insert. Spam and Needs review answer exactly as
// success does. Answers never say whether an email already exists, never carry
// record data, and never log an answer.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ERROR_MAP, formStrings, SUBMIT_BODY_MAX_BYTES, SubmitBody, type ErrorCode } from '@crm/contracts';
import {
  enterPublicForm,
  getPublicForm,
  isRefusal,
  postingRules,
  submitForm,
  type JobRegistry,
  type PostingRules,
} from '@crm/core';
import type { Database } from '@crm/db';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { commitWrite } from '../hooks.ts';
import { errorFields, log } from '../log.ts';
import { captureFault } from '../monitoring/sentry.ts';
import type { WakeRelay } from '../realtime/wake.ts';
import { FORM_LIMITS, type LimitRule, type PublicLimiter } from '../limits.ts';
import type { CaptchaVerifier } from './recaptcha.ts';
import type { TicketBook } from './ticket.ts';
import { signHandoff } from './handoff.ts';

/** The header a site's server signs its posts in: `sha256=` and the hex HMAC of the body with the form's secret. */
export const SIGNATURE_HEADER = 'x-crm-signature';

/** What the public endpoints need: the database, the jobs, the relay's poke, the checks and the settings. */
export interface PublicFormsDeps {
  readonly db: Database;
  readonly jobs: JobRegistry;
  readonly wakeRelay: WakeRelay;
  readonly captcha: CaptchaVerifier;
  /** The central limiter (`../limits.ts`). */
  readonly limiter: PublicLimiter;
  /** Fill tickets: the server's clock for the minimum fill time. */
  readonly tickets: TicketBook;
  /** The origin hosted pages (and the embed's frame) are served from. */
  readonly publicOrigin: string;
  /** Our own public origins, so a redirect to another workspace's page is never followed (spec 0056, AC-5612). */
  readonly publicOrigins: readonly string[];
  readonly recaptchaSiteKey?: string;
  /** The salt client addresses are hashed with. */
  readonly ipSalt: string;
  /** The key answers are hashed with to find repeats (derived from the salt). */
  readonly answersKey: string;
  /** Signs the hand off to a booking page after a send (AC-1057); `handoffKey` from the session secret. */
  readonly handoffKey?: Buffer;
}

interface Variables {
  requestId: string;
  clientIp: string | undefined;
  origin: string | undefined;
}

const words = formStrings('en');

/** A `{ code, message }` answer at the map's status, with field errors and headers when there are some. */
function answer(
  code: ErrorCode,
  message: string,
  extra: { readonly fields?: Record<string, string>; readonly headers?: Record<string, string> } = {},
): Response {
  return Response.json(
    { code, message, ...(extra.fields === undefined ? {} : { fields: extra.fields }) },
    { status: ERROR_MAP[code].status, ...(extra.headers === undefined ? {} : { headers: extra.headers }) },
  );
}

/** A client address hashed with the salt: what limits and abuse review key on, never the address itself. */
export function hashAddress(salt: string, address: string | undefined): string | undefined {
  return address === undefined ? undefined : createHmac('sha256', salt).update(address).digest('hex').slice(0, 32);
}

const EMAIL_SHAPED = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,63}$/u;

/**
 * The email shaped answers of a submission, normalised for the per email
 * limit (spec 0023: lowercased, trimmed, a `+tag` dropped), at most three.
 */
export function limitEmails(answers: Readonly<Record<string, unknown>>): readonly string[] {
  const found = Object.values(answers).flatMap((value) => {
    if (typeof value !== 'string') return [];
    const email = value.trim().toLowerCase();
    if (!EMAIL_SHAPED.test(email)) return [];
    const at = email.lastIndexOf('@');
    return [`${email.slice(0, at).replace(/\+.*$/u, '')}${email.slice(at)}`];
  });
  return [...new Set(found)].slice(0, 3);
}

/** The signature a site's server sends for `body` with `secret`: `sha256=` and the hex HMAC. */
export function signatureOf(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** Whether `given` is the signature of `body`, compared in constant time. */
function isSigned(secret: string, body: string, given: string | null): boolean {
  if (given === null) return false;
  const expected = Buffer.from(signatureOf(secret, body));
  const actual = Buffer.from(given.trim());
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** The CORS headers for a site the form lists: its own origin echoed, no credentials. */
function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': `content-type, ${SIGNATURE_HEADER}`,
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

/** Answers a refusal from the core, or rethrows anything else to the app's one error handler. */
function refusalAnswer(error: unknown, headers?: Record<string, string>): Response {
  if (!isRefusal(error)) throw error;
  const extra = headers === undefined ? {} : { headers };
  const fields = Object.fromEntries(
    error.refusals.flatMap((refusal) => (refusal.field === undefined ? [] : [[refusal.field, refusal.message]])),
  );
  if (Object.keys(fields).length > 0) return answer('ATTRIBUTE_VALUE_INVALID', words.failed, { ...extra, fields });
  const code = error.refusals[0]?.code ?? 'INTERNAL';
  if (code === 'FORM_CLOSED') return answer('FORM_CLOSED', words.closed, extra);
  return answer('NOT_FOUND', words.notFound, extra);
}

/** Whose post this is, by the form's posting settings: the hosted page, a listed site (signed when it must be), or nobody. */
function postFrom(
  posting: PostingRules,
  publicOrigin: string,
  origin: string | undefined,
  body: string,
  signature: string | null,
): { readonly allowed: boolean; readonly signed: boolean; readonly cors?: string } {
  const signed = isSigned(posting.signingSecret, body, signature);
  if (origin === publicOrigin) return { allowed: true, signed };
  if (origin !== undefined && posting.allowedOrigins.includes(origin)) {
    return { allowed: !posting.requireSignature || signed, signed, cors: origin };
  }
  // A site's server posting with no Origin at all: only with the form's signature.
  return { allowed: origin === undefined && signed, signed };
}

/** How a hosted form's own read is cached: not at all, so a paused or resumed form shows so on the next load. */
export const PUBLIC_FORM_CACHE_CONTROL = 'no-store';

/** Mounts the public form endpoints on the app (`/api` is its base path). */
export function mountPublicForms(app: Hono<{ Variables: Variables }>, deps: PublicFormsDeps): void {
  const { handoffKey } = deps;
  const allowedHosts = new Set([new URL(deps.publicOrigin).hostname]);

  app.get('/public/forms/:publicKey', async (c) => {
    try {
      const { scope, formId } = await enterPublicForm({ db: deps.db }, c.req.param('publicKey'));
      const form = await getPublicForm(scope, {
        formId,
        ...(deps.recaptchaSiteKey === undefined ? {} : { recaptchaSiteKey: deps.recaptchaSiteKey }),
      });
      // Never kept: a pause, a resume or a new version shows on the visitor's next load, not a minute later.
      return c.json(form, 200, { 'cache-control': PUBLIC_FORM_CACHE_CONTROL, 'x-robots-tag': 'noindex' });
    } catch (error) {
      return refusalAnswer(error, { 'cache-control': PUBLIC_FORM_CACHE_CONTROL });
    }
  });

  // A listed site's browser asks first (its own form, posted by our script).
  app.options('/public/forms/:publicKey/submissions', async (c) => {
    const origin = c.get('origin');
    try {
      const { scope, formId } = await enterPublicForm({ db: deps.db }, c.req.param('publicKey'));
      const posting = await postingRules(scope, { formId });
      if (origin === undefined || !posting.allowedOrigins.includes(origin)) return c.body(null, 403);
      return c.body(null, 204, corsHeaders(origin));
    } catch {
      return c.body(null, 404);
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
      const ceiling = deps.limiter('forms:instance', FORM_LIMITS.perInstance);
      if (!ceiling.allowed) {
        return answer('RATE_LIMITED', words.tooMany, { headers: { 'retry-after': String(ceiling.retryAfterSeconds) } });
      }
      let entered: Awaited<ReturnType<typeof enterPublicForm>>;
      let posting: PostingRules;
      try {
        entered = await enterPublicForm({ db: deps.db }, c.req.param('publicKey') ?? '');
        posting = await postingRules(entered.scope, { formId: entered.formId });
      } catch (error) {
        return refusalAnswer(error);
      }
      const { scope, formId } = entered;
      const text = await c.req.text();
      const from = postFrom(posting, deps.publicOrigin, c.get('origin'), text, c.req.header(SIGNATURE_HEADER) ?? null);
      const cors = from.cors === undefined ? undefined : corsHeaders(from.cors);
      const headers = (more: Record<string, string> = {}) => ({ ...(cors ?? {}), ...more });
      if (!from.allowed)
        return answer('FORBIDDEN_ORIGIN', 'This form takes submissions only from its own page and the sites it lists.');
      const ipHash = hashAddress(deps.ipSalt, c.get('clientIp'));
      const address = ipHash ?? 'unknown';
      /** 429 at the first spent limit, else undefined. */
      const limited = (checks: readonly (readonly [string, LimitRule])[]): Response | undefined => {
        for (const [key, limit] of checks) {
          const hit = deps.limiter(key, limit);
          if (!hit.allowed) {
            return answer('RATE_LIMITED', words.tooMany, {
              headers: headers({ 'retry-after': String(hit.retryAfterSeconds) }),
            });
          }
        }
        return undefined;
      };
      const spent = limited([
        [`forms:address:${address}`, FORM_LIMITS.perAddress],
        [`forms:address-in:${scope.workspaceId}:${address}`, FORM_LIMITS.perAddressInWorkspace],
        [`forms:form:${scope.workspaceId}:${formId}`, FORM_LIMITS.perForm],
      ]);
      if (spent !== undefined) return spent;
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return answer('INPUT_INVALID', 'Send the submission as JSON.', { headers: headers() });
      }
      const parsed = SubmitBody.safeParse(raw);
      if (!parsed.success) {
        return answer('INPUT_INVALID', 'This submission is not in the shape a form takes.', { headers: headers() });
      }
      const body = parsed.data;
      // Spent per email limits are a spam sign, not a 429, so nobody can lock a person out of a form.
      const emailOverLimit = limitEmails(body.answers).some(
        (email) =>
          !deps.limiter(`forms:email:${formId}:${hashAddress(deps.ipSalt, email) ?? ''}`, FORM_LIMITS.perEmail).allowed,
      );
      const ticket = deps.tickets.check(`form:${c.req.param('publicKey') ?? ''}`, body.ticket);
      const captcha = await deps.captcha.verify(body.captcha, allowedHosts);
      try {
        // The visitor's idempotency key doubles as the write's mutation id: no browser follows this write's events.
        const outcome = await commitWrite({ wakeRelay: deps.wakeRelay }, { mutationId: body.idempotencyKey }, (hooks) =>
          submitForm(
            scope,
            deps.jobs,
            {
              formId,
              body,
              captcha,
              ticket,
              signed: from.signed,
              emailOverLimit,
              answersKey: deps.answersKey,
              publicOrigins: deps.publicOrigins,
              ...(ipHash === undefined ? {} : { ipHash }),
              ...(handoffKey === undefined ? {} : { signHandoff: (handoff) => signHandoff(handoffKey, handoff) }),
            },
            hooks,
          ),
        );
        log.info('form.submission', {
          requestId: c.get('requestId'),
          formId,
          verdict: outcome.verdict,
          ticket: ticket.kind,
          replayed: outcome.replayed,
        });
        return c.json({ next: outcome.next }, 200, headers());
      } catch (error) {
        if (isRefusal(error)) return refusalAnswer(error, headers());
        log.error('Form submission failed', { requestId: c.get('requestId'), formId, ...errorFields(error) });
        captureFault(error, { requestId: c.get('requestId'), route: '/api/public/forms/:publicKey/submissions' });
        return answer('INTERNAL', words.failed, { headers: headers() });
      }
    },
  );
}
