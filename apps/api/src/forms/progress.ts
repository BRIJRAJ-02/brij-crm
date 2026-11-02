// The public endpoints for save and resume, and the analytics beacon (spec
// 0063, AC-6319, AC-6320, AC-6330), REST under /api/public with no session.
//
// Every one of them passes the same bot checks a submit does (AC-6330), in
// the same order:
//
//  1. the instance's own ceiling, so nothing below runs in a flood,
//  2. the form's address and whether it is live (`enterPublicForm`),
//  3. the body's size cap, at the route,
//  4. the honeypot (`company_url`): a filled one is answered as success and
//     stored as nothing at all, so a bot learns nothing from the difference,
//  5. the signed fill ticket, on our clock not the visitor's,
//  6. the per address, per address in workspace and per form rate limits,
//  7. the server's own answer check, question by question, in the core.
//
// The resume link carries one opaque token and nothing else (AC-6330): never
// an answer, an email or a name. The token is 32 random bytes, only its
// SHA-256 is stored, it is good for 30 days, and it is deleted on submit.
//
// The beacon stores no cookie, no address and no lasting visitor id
// (AC-6320): a visit is known only by the daily keyed hash of spec 0047,
// which this file mints from the address and the user agent and keeps
// neither, and which means something different tomorrow on purpose.
import {
  countFormEvent,
  enterPublicForm,
  isRefusal,
  savePartial,
  sendResumeLink,
  type JobRegistry,
} from '@crm/core';
import {
  ERROR_MAP,
  formStrings,
  FormEventBody,
  PartialBody,
  PartialEmailBody,
  SUBMIT_BODY_MAX_BYTES,
  type ErrorCode,
} from '@crm/contracts';
import type { Database } from '@crm/db';
import type { Context, Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { bodyLimit } from 'hono/body-limit';
import { isMachine, utcDay, visitorId } from '../analytics/visitor.ts';
import { commitWrite } from '../hooks.ts';
import { errorFields, log } from '../log.ts';
import { captureFault } from '../monitoring/sentry.ts';
import type { WakeRelay } from '../realtime/wake.ts';
import { FORM_EVENT_LIMITS, PARTIAL_LIMITS, type LimitRule, type PublicLimiter } from '../limits.ts';
import { hashAddress } from './public.ts';
import type { TicketBook } from './ticket.ts';

/**
 * These writes touch only `form_partials` and `form_visits`, neither of which
 * puts a row in the outbox, so no browser is ever waiting to skip an echo of
 * them. Each still needs a mutation id for `commitWrite`, and a fresh one is
 * the honest answer: it can never collide with a mutation a browser is
 * following.
 */
/** The beacon's own body cap: a few hundred bytes of JSON, never a submission's 64 KB. */
const EVENT_BODY_MAX_BYTES = 2_048;

/** What these endpoints need. */
export interface FormProgressDeps {
  readonly db: Database;
  readonly jobs: JobRegistry;
  readonly wakeRelay: WakeRelay;
  /** The central limiter (`../limits.ts`). */
  readonly limiter: PublicLimiter;
  /** Fill tickets: the server's clock for the minimum fill time. */
  readonly tickets: TicketBook;
  /** The origin hosted pages are served from, which a resume link is built on. */
  readonly publicOrigin: string;
  /** The salt client addresses are hashed with. */
  readonly ipSalt: string;
  /** The key daily visitor ids are made with (spec 0047); without it, nothing is counted. */
  readonly visitorKey?: Buffer;
  readonly now?: () => Date;
}

interface Variables {
  requestId: string;
  clientIp: string | undefined;
  origin: string | undefined;
}

const words = formStrings('en');

/** A `{ code, message }` answer at the map's status, with headers when there are some. */
function answer(code: ErrorCode, message: string, headers?: Record<string, string>): Response {
  return Response.json({ code, message }, { status: ERROR_MAP[code].status, ...(headers === undefined ? {} : { headers }) });
}

/** Answers a refusal from the core as its code says, or rethrows anything else to the app's one error handler. */
function refusalAnswer(error: unknown): Response {
  if (!isRefusal(error)) throw error;
  const code = error.refusals[0]?.code ?? 'INTERNAL';
  const message = error.refusals[0]?.message ?? words.failed;
  if (code === 'FORM_CLOSED') return answer('FORM_CLOSED', words.closed);
  if (code === 'FORBIDDEN') return answer('FORBIDDEN', message);
  return answer('NOT_FOUND', message);
}

/**
 * Mounts the three progress endpoints on the app (`/api` is its base path):
 * `PUT /public/forms/:publicKey/partials`,
 * `POST /public/forms/:publicKey/partials/email` and
 * `POST /public/forms/:publicKey/events`.
 */
export function mountFormProgress(app: Hono<{ Variables: Variables }>, deps: FormProgressDeps): void {
  const now = deps.now ?? (() => new Date());

  /** The visitor's hashed address, for the limits, and 'unknown' when there is none. */
  const addressOf = (c: Context<{ Variables: Variables }>): string =>
    hashAddress(deps.ipSalt, c.get('clientIp')) ?? 'unknown';

  /** 429 at the first spent limit, else undefined. */
  const limited = (checks: readonly (readonly [string, LimitRule])[]): Response | undefined => {
    for (const [key, limit] of checks) {
      const hit = deps.limiter(key, limit);
      if (!hit.allowed) {
        return answer('RATE_LIMITED', words.tooMany, { 'retry-after': String(hit.retryAfterSeconds) });
      }
    }
    return undefined;
  };

  app.put(
    '/public/forms/:publicKey/partials',
    bodyLimit({
      maxSize: SUBMIT_BODY_MAX_BYTES,
      onError: () => answer('PAYLOAD_TOO_LARGE', 'That is larger than the 64 KB a form accepts.'),
    }),
    async (c: Context<{ Variables: Variables }>) => {
      const key = c.req.param('publicKey') ?? '';
      const ceiling = deps.limiter('forms:partials:instance', PARTIAL_LIMITS.perInstance);
      if (!ceiling.allowed) {
        return answer('RATE_LIMITED', words.tooMany, { 'retry-after': String(ceiling.retryAfterSeconds) });
      }
      let entered: Awaited<ReturnType<typeof enterPublicForm>>;
      try {
        entered = await enterPublicForm({ db: deps.db }, key);
      } catch (error) {
        return refusalAnswer(error);
      }
      const { scope, formId } = entered;
      const parsed = PartialBody.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success) return answer('INPUT_INVALID', 'That is not the shape a save takes.');
      const body = parsed.data;
      // The honeypot, before any limit is spent or any row written: a bot is told it worked and nothing happens.
      if (body.company_url !== undefined && body.company_url.trim() !== '') {
        return c.json({ resumeToken: 'x'.repeat(43), expiresAt: now().toISOString() }, 200);
      }
      // The signed fill ticket, on our clock. A save with no ticket at all is a script, not a visitor.
      const ticket = deps.tickets.check(`form:${key}`, body.ticket);
      if (ticket.kind !== 'valid') return answer('INPUT_INVALID', 'Reload the form and try again.');
      const address = addressOf(c);
      const spent = limited([
        [`forms:partial:${address}`, PARTIAL_LIMITS.perAddress],
        [`forms:partial-in:${scope.workspaceId}:${address}`, PARTIAL_LIMITS.perAddressInWorkspace],
        [`forms:partial-form:${scope.workspaceId}:${formId}`, PARTIAL_LIMITS.perForm],
      ]);
      if (spent !== undefined) return spent;
      const ipHash = hashAddress(deps.ipSalt, c.get('clientIp'));
      try {
        const saved = await commitWrite({ wakeRelay: deps.wakeRelay }, { mutationId: randomUUID() }, () =>
          savePartial(scope, {
            formId,
            answers: body.answers,
            ...(body.stepId === undefined ? {} : { stepId: body.stepId }),
            ...(body.resumeToken === undefined ? {} : { resumeToken: body.resumeToken }),
            ...(ipHash === undefined ? {} : { ipHash }),
          }),
        );
        // Never logged: the token is the whole secret. Only that a save happened, and for which form.
        log.info('form.partial.saved', { requestId: c.get('requestId'), formId });
        return c.json(saved, 200, { 'cache-control': 'no-store' });
      } catch (error) {
        if (isRefusal(error)) return refusalAnswer(error);
        log.error('Saving a partial failed', { requestId: c.get('requestId'), formId, ...errorFields(error) });
        captureFault(error, { requestId: c.get('requestId'), route: '/api/public/forms/:publicKey/partials' });
        return answer('INTERNAL', words.failed);
      }
    },
  );

  app.post(
    '/public/forms/:publicKey/partials/email',
    bodyLimit({
      maxSize: EVENT_BODY_MAX_BYTES,
      onError: () => answer('PAYLOAD_TOO_LARGE', 'That is larger than this takes.'),
    }),
    async (c: Context<{ Variables: Variables }>) => {
      const key = c.req.param('publicKey') ?? '';
      const ceiling = deps.limiter('forms:partials:instance', PARTIAL_LIMITS.perInstance);
      if (!ceiling.allowed) {
        return answer('RATE_LIMITED', words.tooMany, { 'retry-after': String(ceiling.retryAfterSeconds) });
      }
      let entered: Awaited<ReturnType<typeof enterPublicForm>>;
      try {
        entered = await enterPublicForm({ db: deps.db }, key);
      } catch (error) {
        return refusalAnswer(error);
      }
      const { scope, formId } = entered;
      const parsed = PartialEmailBody.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success) return answer('INPUT_INVALID', 'That is not the shape this takes.');
      const body = parsed.data;
      // 202 either way for the honeypot: a bot can't tell a swallowed request from a sent email.
      if (body.company_url !== undefined && body.company_url.trim() !== '') return c.body(null, 202);
      const ticket = deps.tickets.check(`form:${key}`, body.ticket);
      if (ticket.kind !== 'valid') return answer('INPUT_INVALID', 'Reload the form and try again.');
      const address = addressOf(c);
      const spent = limited([
        [`forms:resume-mail:${address}`, PARTIAL_LIMITS.emailPerAddress],
        [`forms:resume-mail-form:${scope.workspaceId}:${formId}`, PARTIAL_LIMITS.emailPerForm],
      ]);
      if (spent !== undefined) return spent;
      try {
        // One core call does the whole thing: the address is the one already saved in this form's own email
        // answer, and the link it builds carries the token and nothing else (AC-6330). The API never holds a
        // transaction of its own.
        const sent = await commitWrite({ wakeRelay: deps.wakeRelay }, { mutationId: randomUUID() }, () =>
          sendResumeLink(scope, { formId, resumeToken: body.resumeToken, publicOrigin: deps.publicOrigin }),
        );
        if (!sent.sent) {
          return answer('INPUT_INVALID', 'Add your email address to the form first, then ask again.');
        }
        log.info('form.partial.emailed', { requestId: c.get('requestId'), formId });
        return c.body(null, 202);
      } catch (error) {
        if (isRefusal(error)) return refusalAnswer(error);
        log.error('Emailing a resume link failed', { requestId: c.get('requestId'), formId, ...errorFields(error) });
        captureFault(error, { requestId: c.get('requestId'), route: '/api/public/forms/:publicKey/partials/email' });
        return answer('INTERNAL', words.failed);
      }
    },
  );

  app.post(
    '/public/forms/:publicKey/events',
    bodyLimit({ maxSize: EVENT_BODY_MAX_BYTES, onError: () => new Response(null, { status: 204 }) }),
    async (c: Context<{ Variables: Variables }>) => {
      // Lossy by design (AC-6321's "204 always"): every path below answers 204, so a blocked, flooded or
      // malformed beacon never shows a visitor an error and never tells a bot whether it was counted.
      const silent = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
      const key = c.req.param('publicKey') ?? '';
      const { visitorKey } = deps;
      const userAgent = c.req.header('user-agent');
      // A machine's visit is never counted (spec 0047's rule), and without a visitor key nothing is counted at all.
      if (visitorKey === undefined || userAgent === undefined || isMachine(userAgent)) return silent();
      if (!deps.limiter('forms:events:instance', FORM_EVENT_LIMITS.perInstance).allowed) return silent();
      const parsed = FormEventBody.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success) return silent();
      const body = parsed.data;
      if (body.company_url !== undefined && body.company_url.trim() !== '') return silent();
      const ticket = deps.tickets.check(`form:${key}`, body.ticket);
      if (ticket.kind !== 'valid') return silent();
      const address = addressOf(c);
      if (!deps.limiter(`forms:event:${address}`, FORM_EVENT_LIMITS.perAddress).allowed) return silent();
      try {
        const { scope, formId } = await enterPublicForm({ db: deps.db }, key);
        if (!deps.limiter(`forms:event-form:${scope.workspaceId}:${formId}`, FORM_EVENT_LIMITS.perForm).allowed) {
          return silent();
        }
        await commitWrite({ wakeRelay: deps.wakeRelay }, { mutationId: randomUUID() }, () =>
          countFormEvent(scope, {
            formId,
            // The daily keyed hash, and nothing else about the visitor: the address and the user agent go into
            // the HMAC and neither is kept (AC-6320). The same browser tomorrow is someone new.
            visitor: visitorId(visitorKey, {
              day: utcDay(now()),
              ip: c.get('clientIp'),
              userAgent,
              place: `form:${formId}`,
            }),
            kind: body.kind,
            ...(body.questionId === undefined ? {} : { questionId: body.questionId }),
            ...(body.source === undefined ? {} : { source: sourceOf(body.source) }),
          }),
        );
      } catch {
        // Counted or not, the visitor's fill is never affected: analytics are lossy by design.
      }
      return silent();
    },
  );
}

/**
 * What the page said about where the visitor came from, as the two parts
 * `normaliseSource` takes. The page sends `utm:<word>` or the referrer; the
 * server normalises it again, so the stored value is always the server's.
 */
function sourceOf(given: string): { readonly utmSource?: string; readonly referrer?: string } {
  const trimmed = given.trim();
  if (trimmed.startsWith('utm:')) return { utmSource: trimmed.slice(4) };
  return { referrer: trimmed };
}
