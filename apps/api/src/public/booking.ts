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
//   GET  /api/public/booking/manage/:token/slots ?from&to&tz: where the booking could move
//   POST /api/public/booking/manage/:token/move  moves it (milestone 2)
//   POST /api/public/booking/manage/:token/guests  invites more people
//   POST /api/public/booking/manage/:token/guests/remove  takes one off
//   POST /api/public/booking/manage/:token/cancel  cancels it, with an optional reason
//   GET  /api/public/booking/:publicKey/viewer   who the visitor is (spec 0028)
//   GET  /api/public/booking/:publicKey/connect  ?return: a guest connects Google for this visit
//   GET  /api/public/booking/connect/callback    Google's answer: the guest's sealed cookie
//   POST /api/public/booking/connect/forget      drops the guest's calendar
//
// A slots read from a recognised visitor with a calendar also reads their
// busy times (at most 3 seconds, failing open) and answers which slots clash
// and which are Best (spec 0028, AC-723 to AC-726), never the busy times.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  errorStatus,
  PublicBookInput,
  PublicCancelInput,
  PublicGuestsInput,
  PublicMoveInput,
  PublicMoveSlotsQuery,
  PublicRemoveGuestInput,
  type PublicPrefill,
  PublicSlotsQuery,
  type ErrorCode,
  type PublicSlots,
  type PublicViewerAnswer,
  type SlotsOverlay,
} from '@crm/contracts';
import {
  BEST_CLEAR_MS,
  isProviderError,
  outboxHook,
  overlay,
  signValue,
  verifyValue,
  type BookingCalendar,
  type BusyInterval,
  type BusyReader,
} from '@crm/core';
import {
  addGuests,
  bookPublicSlot,
  cancelBooking,
  readHandoffPrefill,
  enterBookingByToken,
  guestTarget,
  moveBooking,
  readMoveSlots,
  removeGuest,
  enterBookingPage,
  getPublicBookingPage,
  isPageHost,
  type BookingEntry,
  managedBookingIcs,
  readManagedBooking,
  readPublicSlots,
  type IcsOrigin,
} from '@crm/core/public';
import type { ManageLinkKey } from '@crm/core';
import type { Database } from '@crm/db';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { toApiError } from '../errors.ts';
import { errorFields, log } from '../log.ts';
import type { WakeRelay } from '../realtime/wake.ts';
import type { TicketBook } from '../forms/ticket.ts';
import { handoffForPage } from '../forms/handoff.ts';
import { BOOKING_LIMITS, looksLikeBot, type LimitRule, type PublicLimiter } from './limits.ts';
import {
  findVisitor,
  GUEST_CALLBACK_PATH,
  GUEST_CONNECT_PATH,
  cookieName,
  GUEST_COOKIE,
  GUEST_COOKIE_PATH,
  GUEST_STATE_COOKIE,
  openGuest,
  sealGuest,
  type FoundVisitor,
  type VisitorDeps,
} from './visitor.ts';

/** The largest booking body read: a name, an email, a few short fields. */
export const BOOKING_BODY_LIMIT_BYTES = 16 * 1024;

/** What the public booking routes serve with. */
export interface PublicBookingServices {
  readonly db: Database;
  readonly calendar: BookingCalendar & { readonly busy: BusyReader & { readonly fresh?: BusyReader } };
  readonly limiter: PublicLimiter;
  /** Fill tickets (spec 0023): the server's clock for the minimum fill time, when the page sends one. */
  readonly tickets?: TicketBook;
  readonly wakeRelay: WakeRelay;
  readonly now?: () => Date;
  /** The key every booking's guest page token derives from (`booking-link.ts`). */
  readonly linkKey: ManageLinkKey;
  /** Reads a form's hand off (spec 0023 AC-1058): the prefill and the submission a booking links to. */
  readonly handoffKey?: Buffer;
  /** Where calendar files say they come from: the app's origin and the sending address. */
  readonly ics: IcsOrigin;
  /** Knowing the visitor (spec 0028): sign in, the member door, and the guest leg where calendar sync is on. */
  readonly visitor?: VisitorDeps & {
    /** Signs a guest connect's state (derived from the calendar token key). */
    readonly stateKey?: Buffer;
    readonly appUrl: string;
    /** Outside local the cookies are Secure. */
    readonly secure: boolean;
  };
}

/** The guest state's version. */
const GUEST_STATE_VERSION = 'gs1';
/** How long a guest may take at Google's consent screen. */
const GUEST_STATE_SECONDS = 10 * 60;
/** The longest a visitor's busy times may take before the page shows every time (AC-726). */
export const VISITOR_BUSY_TIMEOUT_MS = 3000;

/** What the page is told after a guest connect. */
export type GuestConnectResult = 'connected' | 'denied' | 'scope' | 'off' | 'failed';

/** A public key as the door takes it. */
const PUBLIC_KEY = /^[A-Za-z0-9_-]{16}$/;

/**
 * The booking page path a guest returns to, or undefined: this page's own
 * address, with at most a plain query, never another site or path.
 */
export function returnPath(publicKey: string, given: string | undefined): string | undefined {
  if (given === undefined || given.length > 512 || !PUBLIC_KEY.test(publicKey)) return undefined;
  const match = /^\/b\/([A-Za-z0-9_-]{16})(\?[A-Za-z0-9=&%._~+:-]*)?$/.exec(given);
  return match?.[1] === publicKey ? given : undefined;
}

/** The return path with what happened in `?calendar=`, on the app's origin. */
function backTo(appUrl: string, path: string, result: GuestConnectResult): string {
  const url = new URL(path, new URL(appUrl).origin);
  url.searchParams.set('calendar', result);
  return url.toString();
}

/** A promise's answer, or `fallback` once `ms` pass. */
async function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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

/** A JSON answer, never cached (slots change by the minute; a page can be paused; a visitor's overlay is theirs). */
function ok(body: unknown, setCookies: readonly string[] = []): Response {
  const headers = new Headers({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });
  for (const cookie of setCookies) headers.append('set-cookie', cookie);
  return Response.json(body, { headers });
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
  const deps = {
    calendar,
    linkKey: services.linkKey,
    ...(services.now === undefined ? {} : { now: services.now }),
    log,
  };

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

  /** The request's visitor on this page: nobody without the visitor services, or when finding them fails. */
  const visitorOf = (c: Context<{ Variables: Variables }>, entry: BookingEntry): Promise<FoundVisitor> => {
    const visitor = services.visitor;
    if (visitor === undefined) return Promise.resolve({ setCookies: [] });
    const nobody: FoundVisitor = { setCookies: [] };
    return findVisitor(visitor, {
      headers: c.req.raw.headers,
      clientIp: c.get('clientIp'),
      guestCookie: getCookie(c, cookieName(GUEST_COOKIE, visitor.secure)),
      isHost: (userId) => isPageHost(entry, userId),
      now: services.now?.() ?? new Date(),
    }).catch((error: unknown) => {
      // The visitor is a nicety: the page works for nobody in particular.
      log.warn('booking.visitor.failed', { requestId: c.get('requestId'), ...errorFields(error) });
      return nobody;
    });
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

  // The guest's changes (milestone 2): the token is the only key. Limited per address before the token is looked up,
  // then per booking (by its id: the token is a credential and never becomes a limiter key).
  app.use(
    '/public/booking/manage/:token/*',
    bodyLimit({
      maxSize: BOOKING_BODY_LIMIT_BYTES,
      onError: () => answer('PAYLOAD_TOO_LARGE', 'This request is larger than a change needs.'),
    }),
  );

  /** The guest's entry for a change: their token's booking, or the refusal to answer with. */
  const changeEntry = async (c: Context<{ Variables: Variables }>) => {
    const refused = limited([[`booking:manage:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.managePerAddress]]);
    if (refused !== undefined) return { refused };
    const entry = await enterBookingByToken({ db }, c.req.param('token') ?? '');
    const busy = limited([[`booking:change:${entry.bookingId}`, BOOKING_LIMITS.managePerBooking]]);
    return busy === undefined ? { entry } : { refused: busy };
  };

  /** A change's body read as JSON, or the refusal. */
  const jsonOf = async (c: Context<{ Variables: Variables }>): Promise<{ readonly body: unknown } | undefined> => {
    try {
      return { body: await c.req.json() };
    } catch {
      return undefined;
    }
  };

  /** The refusal for a body its schema didn't take: the first issue, and up to ten with their paths. */
  const invalid = (issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[]) => {
    const listed = issues.slice(0, 10).map((issue) => ({ path: issue.path.map(String), message: issue.message }));
    return answer('INPUT_INVALID', listed[0]?.message ?? 'Some of the input is invalid.', { data: { issues: listed } });
  };

  app.get('/public/booking/manage/:token/slots', async (c) => {
    const refused = limited([[`booking:manage:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.managePerAddress]]);
    if (refused !== undefined) return refused;
    const query = PublicMoveSlotsQuery.safeParse(c.req.query());
    if (!query.success) return invalid(query.error.issues);
    try {
      const entry = await enterBookingByToken({ db }, c.req.param('token'));
      return ok(
        await readMoveSlots(guestTarget(entry), deps, {
          from: new Date(query.data.from),
          to: new Date(query.data.to),
        }),
      );
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  app.post('/public/booking/manage/:token/move', async (c) => {
    const read = await jsonOf(c);
    if (read === undefined) return answer('INPUT_INVALID', 'The request could not be read.');
    const input = PublicMoveInput.safeParse(read.body);
    if (!input.success) return invalid(input.error.issues);
    try {
      const found = await changeEntry(c);
      if ('refused' in found) return found.refused;
      const { moved } = await moveBooking(guestTarget(found.entry), deps, { start: new Date(input.data.start) });
      // The emails it queued: wake the worker.
      if (moved) wakeRelay();
      return ok({ booking: await readManagedBooking(found.entry, services.now?.() ?? new Date()) });
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  app.post('/public/booking/manage/:token/guests', async (c) => {
    const read = await jsonOf(c);
    if (read === undefined) return answer('INPUT_INVALID', 'The request could not be read.');
    const input = PublicGuestsInput.safeParse(read.body);
    if (!input.success) return invalid(input.error.issues);
    try {
      const found = await changeEntry(c);
      if ('refused' in found) return found.refused;
      const added = await addGuests(guestTarget(found.entry), deps, { emails: input.data.emails });
      if (added.added > 0) wakeRelay();
      return ok({ added: added.added, guests: [...added.guests] });
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  app.post('/public/booking/manage/:token/guests/remove', async (c) => {
    const read = await jsonOf(c);
    if (read === undefined) return answer('INPUT_INVALID', 'The request could not be read.');
    const input = PublicRemoveGuestInput.safeParse(read.body);
    if (!input.success) return invalid(input.error.issues);
    try {
      const found = await changeEntry(c);
      if ('refused' in found) return found.refused;
      const left = await removeGuest(guestTarget(found.entry), deps, { email: input.data.email });
      return ok({ guests: [...left.guests] });
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  app.post('/public/booking/manage/:token/cancel', async (c) => {
    const read = await jsonOf(c);
    if (read === undefined) return answer('INPUT_INVALID', 'The request could not be read.');
    const input = PublicCancelInput.safeParse(read.body);
    if (!input.success) return invalid(input.error.issues);
    try {
      const found = await changeEntry(c);
      if ('refused' in found) return found.refused;
      const { cancelled } = await cancelBooking(guestTarget(found.entry), deps, { reason: input.data.reason });
      if (cancelled) wakeRelay();
      return ok({ booking: await readManagedBooking(found.entry, services.now?.() ?? new Date()) });
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  // The guest connect's two fixed addresses (before the page routes, so `connect` is never read as a public key).
  app.get('/public/booking/connect/callback', async (c) => {
    const visitor = services.visitor;
    const appUrl = visitor?.appUrl ?? services.ics.appOrigin;
    if (limited([[`booking:connect:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.readsPerAddress]]) !== undefined) {
      return c.redirect(new URL('/', new URL(appUrl).origin).toString());
    }
    const secure = visitor?.secure ?? false;
    const stateCookie = cookieName(GUEST_STATE_COOKIE, secure);
    const nonce = getCookie(c, stateCookie);
    // Single use: whatever happens next, this browser's state is spent.
    deleteCookie(c, stateCookie, { path: GUEST_CONNECT_PATH, secure });
    const payload =
      visitor?.stateKey === undefined
        ? undefined
        : verifyValue(visitor.stateKey, GUEST_STATE_VERSION, c.req.query('state'));
    const back = typeof payload?.r === 'string' ? payload.r : undefined;
    const key = back === undefined ? undefined : /^\/b\/([A-Za-z0-9_-]{16})/.exec(back)?.[1];
    const path = key === undefined ? undefined : returnPath(key, back);
    if (path === undefined) return c.redirect(new URL('/', new URL(appUrl).origin).toString());
    const guest = visitor?.guest;
    if (visitor === undefined || guest === undefined) return c.redirect(backTo(appUrl, path, 'off'));
    const sameBrowser =
      nonce !== undefined &&
      typeof payload?.n === 'string' &&
      payload.n.length === nonce.length &&
      timingSafeEqual(Buffer.from(payload.n), Buffer.from(nonce));
    if (!sameBrowser) {
      log.warn('booking.guest_connect.refused', { requestId: c.get('requestId'), reason: 'state' });
      return c.redirect(backTo(appUrl, path, 'failed'));
    }
    // The visitor said no on Google's screen.
    if (c.req.query('error') !== undefined) return c.redirect(backTo(appUrl, path, 'denied'));
    const code = c.req.query('code');
    if (code === undefined || code.length > 2048) return c.redirect(backTo(appUrl, path, 'failed'));
    try {
      const grant = await guest.calendar.exchange(code, guestRedirectUri(appUrl));
      const now = services.now?.() ?? new Date();
      const sealed = sealGuest(guest.keys, grant, now);
      if (sealed === undefined) {
        log.warn('booking.guest_connect.failed', { requestId: c.get('requestId'), code: 'COOKIE_TOO_LARGE' });
        return c.redirect(backTo(appUrl, path, 'failed'));
      }
      setCookie(c, cookieName(GUEST_COOKIE, visitor.secure), sealed.value, {
        path: GUEST_COOKIE_PATH,
        httpOnly: true,
        sameSite: 'Lax',
        secure: visitor.secure,
        maxAge: sealed.maxAge,
      });
      return c.redirect(backTo(appUrl, path, 'connected'));
    } catch (error) {
      if (!isProviderError(error)) throw error;
      log.warn('booking.guest_connect.failed', { requestId: c.get('requestId'), code: error.code });
      return c.redirect(backTo(appUrl, path, error.code === 'CALENDAR_SCOPE_DECLINED' ? 'scope' : 'failed'));
    }
  });

  app.post('/public/booking/connect/forget', async (c) => {
    const refused = limited([[`booking:connect:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.readsPerAddress]]);
    if (refused !== undefined) return refused;
    const visitor = services.visitor;
    const guest = visitor?.guest;
    const guestCookie = cookieName(GUEST_COOKIE, visitor?.secure ?? false);
    const grant =
      guest === undefined
        ? undefined
        : openGuest(guest.keys, getCookie(c, guestCookie), services.now?.() ?? new Date());
    deleteCookie(c, guestCookie, { path: GUEST_COOKIE_PATH, secure: visitor?.secure ?? false });
    // Best effort, and never awaited past its own timeout: the token dies within the hour anyway.
    if (guest !== undefined && grant !== undefined) await guest.calendar.revoke(grant.accessToken);
    return c.json({}, 200, { 'cache-control': 'no-store' });
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

  /** A form's hand off for this page, or undefined: signed by us, unexpired, and naming this very page. */
  const handoffFor = (entry: BookingEntry, token: string | undefined) =>
    handoffForPage(services.handoffKey, token, entry.pageId, services.now?.() ?? new Date());

  // The name and email a form handed over (AC-1058): only from a token we signed for this page, never plain parameters.
  app.get('/public/booking/:publicKey/prefill', async (c) => {
    const address = addressKey(c.get('clientIp'));
    const key = c.req.param('publicKey');
    const refused = limited([[`booking:read:${address}`, BOOKING_LIMITS.readsPerAddress]]);
    if (refused !== undefined) return refused;
    try {
      const entry = await enterBookingPage({ db }, key);
      const handoff = handoffFor(entry, c.req.query('p'));
      // The name and email come from the stored submission, never from the link.
      const visitor = handoff === undefined ? {} : await readHandoffPrefill(entry, handoff.submissionId);
      const prefill: PublicPrefill = {
        ...(visitor.name === undefined ? {} : { name: visitor.name }),
        ...(visitor.email === undefined ? {} : { email: visitor.email }),
      };
      return ok(prefill);
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  // A form's hand off on a slots read (spec 0043, AC-1609): the hosts its routing chose; a bad token is just ignored.
  const routedLink = (entry: BookingEntry, token: string | undefined) => {
    const handoff = handoffFor(entry, token);
    return handoff === undefined ? undefined : { submissionId: handoff.submissionId };
  };

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
      const { from, to, tz } = query.data;
      // Knowing the visitor and reading their busy times share one budget, and never fail the host's slots.
      const deadline = performance.now() + VISITOR_BUSY_TIMEOUT_MS;
      const found = within(visitorOf(c, entry), VISITOR_BUSY_TIMEOUT_MS, { setCookies: [] });
      // The visitor's busy times, with room for the Best rule's clear 15 minutes, read beside the host's.
      const busy = found.then(({ visitor }) =>
        visitor?.busy === undefined
          ? undefined
          : within(
              visitor
                .busy(
                  new Date(Date.parse(from) - BEST_CLEAR_MS).toISOString(),
                  new Date(Date.parse(to) + BEST_CLEAR_MS).toISOString(),
                )
                .catch((error: unknown) => {
                  log.warn('booking.visitor_busy.failed', { requestId: c.get('requestId'), ...errorFields(error) });
                  return 'unreachable' as const;
                }),
              Math.max(0, deadline - performance.now()),
              'unreachable' as const,
            ),
      );
      const [slots, { setCookies }, visitorBusy] = await Promise.all([
        readPublicSlots(entry, deps, query.data, routedLink(entry, query.data.p)),
        found,
        busy,
      ]);
      return ok(withOverlay(slots, visitorBusy, tz), setCookies);
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  app.get('/public/booking/:publicKey/viewer', async (c) => {
    const address = addressKey(c.get('clientIp'));
    const key = c.req.param('publicKey');
    const refused = limited([
      [`booking:read:${address}`, BOOKING_LIMITS.readsPerAddress],
      [`booking:read-page:${key}`, BOOKING_LIMITS.readsPerPage],
    ]);
    if (refused !== undefined) return refused;
    try {
      const entry = await enterBookingPage({ db }, key);
      const { visitor, setCookies, isHost } = await visitorOf(c, entry);
      const body: PublicViewerAnswer = {
        ...(visitor === undefined ? {} : { viewer: visitor.viewer }),
        isHost: isHost === true,
        canConnect: services.visitor?.guest !== undefined && services.visitor.stateKey !== undefined,
      };
      return ok(body, setCookies);
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  app.get('/public/booking/:publicKey/connect', async (c) => {
    const key = c.req.param('publicKey');
    const back = returnPath(key, c.req.query('return'));
    const appUrl = services.visitor?.appUrl ?? services.ics.appOrigin;
    if (back === undefined) return c.redirect(new URL('/', new URL(appUrl).origin).toString());
    const refused = limited([[`booking:connect:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.readsPerAddress]]);
    if (refused !== undefined) return c.redirect(backTo(appUrl, back, 'failed'));
    const visitor = services.visitor;
    const guest = visitor?.guest;
    if (visitor === undefined || guest === undefined || visitor.stateKey === undefined) {
      return c.redirect(backTo(appUrl, back, 'off'));
    }
    try {
      await enterBookingPage({ db }, key);
    } catch (error) {
      if (!toApiError(error).expected) throw error;
      return c.redirect(backTo(appUrl, back, 'failed'));
    }
    const nonce = randomBytes(18).toString('base64url');
    const state = signValue(visitor.stateKey, GUEST_STATE_VERSION, { r: back, n: nonce }, GUEST_STATE_SECONDS);
    setCookie(c, cookieName(GUEST_STATE_COOKIE, visitor.secure), nonce, {
      path: GUEST_CONNECT_PATH,
      httpOnly: true,
      sameSite: 'Lax',
      secure: visitor.secure,
      maxAge: GUEST_STATE_SECONDS,
    });
    return c.redirect(guest.calendar.authorizeUrl(state, guestRedirectUri(appUrl)));
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
    const ticket = services.tickets?.check(`booking:${key}`, input.data.ticket);
    const elapsed = ticket?.kind === 'valid' ? ticket.elapsedMs : undefined;
    if (looksLikeBot(input.data, (services.now?.() ?? new Date()).getTime(), elapsed)) {
      log.warn('booking.bot_refused', { requestId: c.get('requestId') });
      return answer('INPUT_INVALID', 'We couldn’t take that booking. Try again in a moment.');
    }
    try {
      const entry = await enterBookingPage({ db }, key);
      const handoff = handoffFor(entry, input.data.prefill);
      const booked = await bookPublicSlot(
        entry,
        deps,
        input.data,
        [outboxHook()],
        handoff === undefined ? undefined : { submissionId: handoff.submissionId },
      );
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

/** Where Google sends a guest back: `<APP_URL>/api/public/booking/connect/callback`. */
export function guestRedirectUri(appUrl: string): string {
  return new URL(GUEST_CALLBACK_PATH, new URL(appUrl).origin).toString();
}

/** The slots with the visitor's overlay, when they have a calendar and the host's could be read. */
function withOverlay(
  slots: PublicSlots,
  busy: readonly BusyInterval[] | 'unreachable' | undefined,
  zone: string,
): PublicSlots {
  if (busy === undefined || slots.calendar === 'unreachable') return slots;
  if (busy === 'unreachable') return { ...slots, viewer: { calendar: 'unreachable', clashes: [], best: [] } };
  const { clashes, best } = overlay(slots.slots, busy, zone);
  const viewer: SlotsOverlay = { calendar: 'ok', clashes: [...clashes], best: [...best] };
  return { ...slots, viewer };
}
