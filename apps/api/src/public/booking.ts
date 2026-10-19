// The public booking endpoints (spec 0025), outside the RPC router: no session,
// only a page's public key. Each request enters through core's booking door
// (`enterBookingPage`), which gives the `booking` actor write on People and
// Companies of that one workspace and nothing else. Same origin only (no CORS
// headers; a write's Origin is checked by the app before it gets here), rate
// limited per client address and per page, and a booking passes the bot checks.
//
//   GET  /api/public/booking/:publicKey          the page's facts
//   GET  /api/public/booking/:publicKey/slots    ?from&to&duration&tz
//   POST /api/public/booking/:publicKey/book     a visitor's booking, with the guest page's token
//   GET  /api/public/booking/manage/:token       the guest page's booking
//   GET  /api/public/booking/manage/:token/ics   the booking as a calendar file (Add to calendar)
import { createHash } from 'node:crypto';
import { errorStatus, PublicBookInput, PublicSlotsQuery, type ErrorCode } from '@crm/contracts';
import { outboxHook, type BookingCalendar, type BusyReader } from '@crm/core';
import {
  bookPublicSlot,
  enterBookingByToken,
  enterBookingPage,
  getPublicBookingPage,
  managedBookingIcs,
  readManagedBooking,
  readPublicSlots,
  type IcsOrigin,
} from '@crm/core/public';
import type { Database } from '@crm/db';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { toApiError } from '../errors.ts';
import { errorFields, log } from '../log.ts';
import type { WakeRelay } from '../realtime/wake.ts';
import { BOOKING_LIMITS, looksLikeBot, type LimitRule, type PublicLimiter } from './limits.ts';

/** The largest booking body read: a name, an email, a few short fields. */
export const BOOKING_BODY_LIMIT_BYTES = 16 * 1024;

/** What the public booking routes serve with. */
export interface PublicBookingServices {
  readonly db: Database;
  readonly calendar: BookingCalendar & { readonly busy: BusyReader & { readonly fresh?: BusyReader } };
  readonly limiter: PublicLimiter;
  readonly wakeRelay: WakeRelay;
  readonly now?: () => Date;
  /** Where calendar files say they come from: the app's origin and the sending address. */
  readonly ics: IcsOrigin;
}

interface Variables {
  requestId: string;
  clientIp: string | undefined;
  origin: string | undefined;
}

/** A `{ code, message }` answer at the code's status, never cached. */
function answer(
  code: ErrorCode,
  message: string,
  extra: Readonly<Record<string, unknown>> = {},
  headers: Readonly<Record<string, string>> = {},
) {
  return Response.json(
    { code, message, ...extra },
    { status: errorStatus(code), headers: { 'cache-control': 'no-store', ...headers } },
  );
}

/** A refusal as its code and sentence (with its refusals); anything else rethrown for the app's 500. */
function refusalAnswer(error: unknown): Response {
  const mapped = toApiError(error);
  if (!mapped.expected) throw error;
  const { code, message, data } = mapped.error;
  return answer(code, message, data === undefined ? {} : { data });
}

/** A JSON answer, never cached (slots change by the minute; a page can be paused). */
function ok(body: unknown): Response {
  return Response.json(body, { headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}

/** The client address as a short hash: limits key on it, and no raw address is kept. */
function addressKey(clientIp: string | undefined): string {
  return createHash('sha256')
    .update(clientIp ?? 'unknown')
    .digest('base64url')
    .slice(0, 22);
}

/** Mounts the public booking routes on the app (its base path is `/api`). */
export function mountPublicBooking(app: Hono<{ Variables: Variables }>, services: PublicBookingServices): void {
  const { db, calendar, limiter, wakeRelay } = services;
  const deps = { calendar, ...(services.now === undefined ? {} : { now: services.now }), log };

  /** Answers 429 when any of the limits is spent, else undefined. */
  const limited = (checks: readonly (readonly [string, LimitRule])[]): Response | undefined => {
    for (const [key, rule] of checks) {
      const decision = limiter(key, rule);
      if (!decision.allowed) {
        return answer(
          'RATE_LIMITED',
          'Too many requests. Wait a moment and try again.',
          {},
          { 'retry-after': String(decision.retryAfterSeconds) },
        );
      }
    }
    return undefined;
  };

  // The guest page (before the page routes, so `manage` is never read as a public key).
  app.get('/public/booking/manage/:token', async (c) => {
    const refused = limited([[`booking:manage:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.managePerAddress]]);
    if (refused !== undefined) return refused;
    try {
      const entry = await enterBookingByToken({ db }, c.req.param('token'));
      return ok(await readManagedBooking(entry, services.now?.() ?? new Date()));
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  app.get('/public/booking/manage/:token/ics', async (c) => {
    const refused = limited([[`booking:manage:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.managePerAddress]]);
    if (refused !== undefined) return refused;
    try {
      const token = c.req.param('token');
      const entry = await enterBookingByToken({ db }, token);
      const body = await managedBookingIcs(entry, token, services.ics, services.now?.() ?? new Date());
      return new Response(body, {
        headers: {
          'content-type': 'text/calendar; charset=utf-8',
          'content-disposition': 'attachment; filename="booking.ics"',
          'cache-control': 'no-store',
        },
      });
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  app.get('/public/booking/:publicKey', async (c) => {
    const address = addressKey(c.get('clientIp'));
    const key = c.req.param('publicKey');
    const refused = limited([
      [`booking:read:${address}`, BOOKING_LIMITS.readsPerAddress],
      [`booking:read-page:${key}`, BOOKING_LIMITS.readsPerPage],
    ]);
    if (refused !== undefined) return refused;
    try {
      const entry = await enterBookingPage({ db }, key);
      return ok(await getPublicBookingPage(entry));
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  app.get('/public/booking/:publicKey/slots', async (c) => {
    const address = addressKey(c.get('clientIp'));
    const key = c.req.param('publicKey');
    const refused = limited([
      [`booking:read:${address}`, BOOKING_LIMITS.readsPerAddress],
      [`booking:read-page:${key}`, BOOKING_LIMITS.readsPerPage],
    ]);
    if (refused !== undefined) return refused;
    const query = PublicSlotsQuery.safeParse(c.req.query());
    if (!query.success)
      return answer('INPUT_INVALID', query.error.issues[0]?.message ?? 'The request could not be read.');
    try {
      const entry = await enterBookingPage({ db }, key);
      return ok(await readPublicSlots(entry, deps, query.data));
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  app.use(
    '/public/booking/:publicKey/book',
    bodyLimit({
      maxSize: BOOKING_BODY_LIMIT_BYTES,
      onError: () => answer('PAYLOAD_TOO_LARGE', 'This request is larger than a booking needs.'),
    }),
  );

  app.post('/public/booking/:publicKey/book', async (c) => {
    const address = addressKey(c.get('clientIp'));
    const key = c.req.param('publicKey');
    const refused = limited([
      [`booking:book:${address}`, BOOKING_LIMITS.booksPerAddress],
      [`booking:book-page:${key}`, BOOKING_LIMITS.booksPerPage],
    ]);
    if (refused !== undefined) return refused;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return answer('INPUT_INVALID', 'The request could not be read.');
    }
    const input = PublicBookInput.safeParse(body);
    if (!input.success) {
      const issues = input.error.issues
        .slice(0, 10)
        .map((issue) => ({ path: issue.path.map(String), message: issue.message }));
      return answer('INPUT_INVALID', issues[0]?.message ?? 'Some of the input is invalid.', { data: { issues } });
    }
    if (looksLikeBot(input.data, (services.now?.() ?? new Date()).getTime())) {
      log.warn('booking.bot_refused', { requestId: c.get('requestId') });
      return answer('INPUT_INVALID', 'We couldn’t take that booking. Try again in a moment.');
    }
    try {
      const entry = await enterBookingPage({ db }, key);
      const booked = await bookPublicSlot(entry, deps, input.data, [outboxHook()]);
      // The records it made reach screens live: wake the relay once the write committed.
      if (!booked.replayed) wakeRelay();
      return ok({ booking: booked.booking, manageToken: booked.manageToken });
    } catch (error) {
      if (!toApiError(error).expected) {
        log.error('booking.failed', { requestId: c.get('requestId'), ...errorFields(error) });
      }
      return refusalAnswer(error);
    }
  });
}
