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
//   GET  /api/public/handles/:handle             ?after&q: a link page and a page of its blocks (spec 0051)
//   POST /api/public/handles/:handle/press       a press on a block, the id as text (a beacon), always 204
//   GET  /api/public/handles/:handle/contact.vcf  the link page's contact card as a vCard (spec 0051)
//   GET  /api/public/handles/:handle/:slug       the page a handle address names, by its public key
//   GET  /api/public/booking/:publicKey/picture  a personal page's host picture, from our origin (23 Oct 2026)
//   GET  /api/public/profiles/:handle/picture    a profile's picture, likewise (`picture.ts` fetches both)
//   GET  /api/public/profiles/:handle/offer      whether the address is free to claim (25 Oct 2026)
//
// A slots read from a recognised visitor with a calendar also reads their
// busy times (at most 3 seconds, failing open) and answers which slots clash
// and which are Best (spec 0028, AC-723 to AC-726), never the busy times.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isMachine, utcDay, visitorId } from '../analytics/visitor.ts';
import {
  errorStatus,
  HANDLE_PATTERN,
  PublicBookInput,
  PublicCancelInput,
  PublicChatInput,
  PublicGuestsInput,
  PublicMoveInput,
  PublicMoveSlotsQuery,
  PROFILE_LIMITS,
  PROFILE_PAGE_SIZE,
  type PublicHandleOffer,
  PublicProfileQuery,
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
  countPageView,
  cancelBooking,
  readHandoffPrefill,
  chatTurn,
  enterBookingByToken,
  guestTarget,
  moveBooking,
  readMoveSlots,
  removeGuest,
  enterBookingAddress,
  enterBookingPage,
  countItemPress,
  countProfileView,
  enterContactCard,
  enterLinkPage,
  findHandleOwner,
  getPublicBookingPage,
  readAddressedPage,
  readHandleOffer,
  readLinkPage,
  readPagePicture,
  readContactCard,
  readProfilePicture,
  writeVcard,
  isPageHost,
  type AccountPicture,
  type AccountPictureReader,
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
import { inputProblems, toApiError, type SchemaIssue } from '../errors.ts';
import { errorFields, log } from '../log.ts';
import type { WakeRelay } from '../realtime/wake.ts';
import type { TicketBook } from '../forms/ticket.ts';
import { handoffForPage } from '../forms/handoff.ts';
import { BOOKING_LIMITS, botReason, looksLikeBot, type LimitRule, type PublicLimiter } from './limits.ts';
import { pictureResponse, type PictureFetch } from './picture.ts';
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

/** The largest guest change body read: a name, an email, a few short fields. */
export const BOOKING_BODY_LIMIT_BYTES = 16 * 1024;
/** The largest booking body read: the visitor's details and up to 20 answers to the page's questions (spec 0057), as a form's submit. */
export const BOOK_BODY_LIMIT_BYTES = 64 * 1024;
/** The largest chat turn read: 40 lines of 500 characters, each character at most 6 bytes as JSON (AC-1520). */
export const CHAT_BODY_LIMIT_BYTES = 128 * 1024;

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
  /**
   * A host's account picture (23 Oct 2026): `pictureOf` reads it through the identity login (a failure reads as
   * none), and `fetch` gets it from Google's picture hosts (`picture.ts`).
   */
  readonly pictures: { readonly pictureOf: AccountPictureReader; readonly fetch: PictureFetch };
  /** Knowing the visitor (spec 0028): sign in, the member door, and the guest leg where calendar sync is on. */
  readonly visitor?: VisitorDeps & {
    /** Signs a guest connect's state (derived from the calendar token key). */
    readonly stateKey?: Buffer;
    readonly appUrl: string;
    /** Outside local the cookies are Secure. */
    readonly secure: boolean;
  };
  /**
   * Counting page views (spec 0047, AC-1625): the visitor id key, and a way to keep the process alive for the
   * count, which never holds up the answer. Absent, nothing is counted.
   */
  readonly views?: { readonly visitorKey: Buffer; readonly keepAlive: (work: Promise<unknown>) => void };
}

/** What a booking refused by the bot checks answers: it names something the visitor can do. */
export const BOT_REFUSED = 'We couldn’t take that booking. Check your details and try again.';
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

/** No picture here: 404, never cached. */
const noPicture = (): Response => answer('NOT_FOUND', 'There’s no picture here.');

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

  /**
   * Answers a person's picture: only its current version (`?v=`, so a stale or made up one is never fetched and
   * never cached under a new owner), else 404 when there is none or it can't be had.
   */
  const servePicture = async (
    c: Context<{ Variables: Variables }>,
    picture: AccountPicture | undefined,
  ): Promise<Response> => {
    // The whole query, exactly: anything added would miss the edge's copy and cost a fetch of Google each time.
    if (picture === undefined || new URL(c.req.url).search !== `?v=${picture.version}`) return noPicture();
    const fetched = await services.pictures.fetch(picture.url);
    if (fetched.ok) return pictureResponse(fetched);
    // Why, never the URL: it names the account.
    log.warn('booking.picture.missed', { requestId: c.get('requestId'), reason: fetched.reason });
    return noPicture();
  };

  // A personal page's host picture (23 Oct 2026): through the same door and liveness as its facts; a team page has none.
  app.get('/public/booking/:publicKey/picture', async (c) => {
    const key = c.req.param('publicKey');
    // A key that can't be one never reaches the limiter's keys.
    if (!PUBLIC_KEY.test(key)) return noPicture();
    const refused = limited([
      [`booking:picture:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.picturesPerAddress],
      [`booking:picture-page:${key}`, BOOKING_LIMITS.picturesPerTarget],
    ]);
    if (refused !== undefined) return refused;
    try {
      const entry = await enterBookingPage({ db }, key);
      return await servePicture(c, await readPagePicture(entry, services.pictures));
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  // A profile's picture, by a current or old handle. Under `profiles`: `/handles/:handle/:slug` is a page's address.
  app.get('/public/profiles/:handle/picture', async (c) => {
    const handle = c.req.param('handle');
    if (!HANDLE_PATTERN.test(handle)) return noPicture();
    const refused = limited([
      [`booking:picture:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.picturesPerAddress],
      [`booking:picture-handle:${handle}`, BOOKING_LIMITS.picturesPerTarget],
    ]);
    if (refused !== undefined) return refused;
    try {
      return await servePicture(c, readProfilePicture(await findHandleOwner({ db }, handle)));
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  /** The signed in person's id on this request, or undefined: no session, or one that couldn't be read. */
  const signedInAs = async (c: Context<{ Variables: Variables }>): Promise<string | undefined> => {
    const auth = services.visitor?.auth;
    // No cookie, no session: most visitors never cost a session read.
    if (auth === undefined || (c.req.header('cookie') ?? '') === '') return undefined;
    try {
      return (await auth.session(c.req.raw.headers, c.get('clientIp')))?.user.id;
    } catch {
      return undefined;
    }
  };

  /**
   * Today's visitor id on a link page, or undefined for a machine, with no counters, or for a read another site made
   * (an image or a script there would otherwise count its own visitors as views; spec 0051, AC-5124).
   */
  const profileVisitor = (c: Context<{ Variables: Variables }>, ownerUserId: string): string | undefined => {
    const userAgent = c.req.header('user-agent');
    if (services.views === undefined || userAgent === undefined || isMachine(userAgent)) return undefined;
    const site = c.req.header('sec-fetch-site');
    if (site !== undefined && site !== 'same-origin') return undefined;
    return visitorId(services.views.visitorKey, {
      day: utcDay(services.now?.() ?? new Date()),
      ip: c.get('clientIp'),
      userAgent,
      place: `profile:${ownerUserId}`,
    });
  };

  /** Counts a link page view in the background, unless it is the owner's own read. */
  const countView = (c: Context<{ Variables: Variables }>, ownerUserId: string): void => {
    const visitor = profileVisitor(c, ownerUserId);
    if (visitor === undefined || services.views === undefined) return;
    // Past 600 a minute for one page, reads are answered but not counted (AC-5126).
    if (!limiter(`profile:view-owner:${ownerUserId}`, BOOKING_LIMITS.viewsPerHandle).allowed) return;
    const counted = signedInAs(c)
      .then((userId) => (userId === ownerUserId ? undefined : countProfileView({ db }, ownerUserId, visitor)))
      .catch((error: unknown) => {
        log.warn('profile.view.failed', { requestId: c.get('requestId'), ...errorFields(error) });
      });
    services.views.keepAlive(counted);
  };

  // A press on a link page's block (spec 0051, AC-5125, AC-5126): the block's public id as text, sent by
  // `navigator.sendBeacon` so the visitor's navigation never waits. Always 204, whatever happened: a counter never
  // says whether a handle or an id exists. Limited per address and per handle; a machine's press is dropped.
  // A press body is one id: anything longer is no press, and is never read.
  app.use(
    '/public/handles/:handle/press',
    bodyLimit({ maxSize: 256, onError: (c) => c.body(null, 204, { 'cache-control': 'no-store' }) }),
  );
  app.post('/public/handles/:handle/press', async (c) => {
    const handle = c.req.param('handle');
    const silent = () => c.body(null, 204, { 'cache-control': 'no-store' });
    if (!HANDLE_PATTERN.test(handle)) return silent();
    // A machine's press never spends a person's budget: dropped before the limits.
    const userAgent = c.req.header('user-agent');
    if (services.views === undefined || userAgent === undefined || isMachine(userAgent)) return silent();
    // The handle's budget is per address it is reached by: an old handle has its own (noted for the spec).
    const over = limited([
      [`profile:press:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.pressesPerAddress],
      [`profile:press-handle:${handle}`, BOOKING_LIMITS.pressesPerHandle],
    ]);
    if (over !== undefined) return silent();
    const item = (await c.req.text().catch(() => '')).trim().slice(0, 64);
    // The visitor is keyed on the handle's place; the core reads the owner and checks the block is theirs and live.
    const visitor = visitorId(services.views.visitorKey, {
      day: utcDay(services.now?.() ?? new Date()),
      ip: c.get('clientIp'),
      userAgent,
      place: `press:${handle}`,
    });
    const counted = signedInAs(c)
      .then((userId) =>
        countItemPress({ db }, handle, item, visitor, userId === undefined ? {} : { signedInAs: userId }),
      )
      .catch((error: unknown) => {
        log.warn('profile.press.failed', { requestId: c.get('requestId'), ...errorFields(error) });
      });
    services.views.keepAlive(counted);
    return silent();
  });

  // Whether an address is free to claim (25 Oct 2026). Under `profiles` beside the picture, never under
  // `/handles/:handle/…`, where `offer` would shadow a page whose slug is "offer". The answer is one of two words:
  // a handle somebody holds, a word kept for Timefix and a word no handle could be all read `absent`. That is not
  // a secret kept (RESERVED_HANDLES ships in the browser, and a handle somebody holds answers with their profile
  // anyway); it is so that the offer is only ever made for an address that is genuinely free to take.
  app.get('/public/profiles/:handle/offer', async (c) => {
    const handle = c.req.param('handle').toLowerCase();
    // The instance's own ceiling first, as a form submission does: nothing below runs in a flood, whatever
    // addresses it comes from.
    const refused = limited([
      ['booking:offer:instance', BOOKING_LIMITS.offersPerInstance],
      [`booking:offer:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.offersPerAddress],
    ]);
    if (refused !== undefined) return refused;
    try {
      // The answer is the one word: the handle came from the asker, so it is never echoed back.
      return ok({ status: await readHandleOffer({ db }, handle) } satisfies PublicHandleOffer);
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  // A handle address (22 Oct 2026): the person by a current or old handle, and their link page's blocks (spec 0051),
  // through the door's definers only. A search reads every live block (at most 60) and answers the matches flat.
  app.get('/public/handles/:handle', async (c) => {
    const refused = limited([[`booking:read:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.readsPerAddress]]);
    if (refused !== undefined) return refused;
    const query = PublicProfileQuery.safeParse({
      after: c.req.query('after'),
      q: c.req.query('q'),
    });
    if (!query.success) return answer('INPUT_INVALID', 'That page of blocks isn’t right.');
    const [position, id] = query.data.after?.split('.') ?? [];
    const search = query.data.q === undefined || query.data.q === '' ? undefined : query.data.q;
    try {
      const found = await enterLinkPage({ db }, c.req.param('handle'), {
        ...(search !== undefined || position === undefined || id === undefined
          ? {}
          : { after: { position: Number(position), id } }),
        // One more than a page, so the answer knows there is more; every live block for a search.
        max: search === undefined ? PROFILE_PAGE_SIZE + 1 : PROFILE_LIMITS.items + 1,
      });
      const page = await readLinkPage(found, search === undefined ? {} : { search });
      // One view per page load (its first page, with no `q` at all: a cleared search sends an empty one), never a
      // machine's or the owner's own (AC-5124),
      // counted after the answer is made and never holding it up.
      if (c.req.query('q') === undefined && position === undefined) countView(c, found.owner.userId);
      return ok(page);
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  // A link page's contact card as a vCard 3.0 (spec 0051, AC-5114, AC-5115): a plain download, so Save contact is a
  // plain link that works with no script and from a QR code. Before `/:slug`, which a dotted name never is. A handle
  // no one holds and one with no card answer the same 404. The picture is embedded only when the person has one and
  // hasn't hidden it, and a picture that won't fetch leaves it out rather than failing the card.
  app.get('/public/handles/:handle/contact.vcf', async (c) => {
    const handle = c.req.param('handle');
    if (!HANDLE_PATTERN.test(handle)) return answer('NOT_FOUND', 'There’s no contact card here.');
    // Per address only: a handle wide limit would let a few addresses switch off a person's Save contact for everyone.
    const refused = limited([[`booking:vcard:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.vcardsPerAddress]]);
    if (refused !== undefined) return refused;
    try {
      const contact = readContactCard(await enterContactCard({ db }, handle));
      // The handle's own budget bounds the fetches of Google: past it, the card goes without its picture.
      const fetchesPicture =
        contact.picture !== undefined &&
        limited([[`booking:vcard-handle:${contact.handle}`, BOOKING_LIMITS.vcardsPerHandle]]) === undefined;
      const fetched =
        contact.picture === undefined || !fetchesPicture
          ? undefined
          : await services.pictures.fetch(contact.picture.url, { types: ['image/jpeg', 'image/png'] });
      if (fetched?.ok === false) {
        log.warn('booking.vcard.picture_missed', { requestId: c.get('requestId'), reason: fetched.reason });
      }
      // The page the card came from, so a saved contact still leads back to everything else on it (AC-5115).
      const body = writeVcard(
        contact.card,
        fetched?.ok === true ? fetched : undefined,
        `${services.ics.publicOrigin}/${encodeURIComponent(contact.handle)}`,
      );
      return new Response(body, {
        headers: {
          'content-type': 'text/vcard; charset=utf-8',
          'content-disposition': `attachment; filename="${contact.handle}.vcf"`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'",
          'x-robots-tag': 'noindex',
        },
      });
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  app.get('/public/handles/:handle/:slug', async (c) => {
    const refused = limited([[`booking:read:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.readsPerAddress]]);
    if (refused !== undefined) return refused;
    try {
      const entry = await enterBookingAddress({ db }, c.req.param('handle'), c.req.param('slug'));
      return ok(await readAddressedPage(entry));
    } catch (error) {
      return refusalAnswer(error);
    }
  });

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

  /** The refusal for a body its schema didn't take: up to ten issues on their fields, the first one's sentence leading. */
  const invalid = (issues: readonly SchemaIssue[]) => {
    const { message, issues: listed } = inputProblems(issues, { limit: 10, leadWithField: true });
    return answer('INPUT_INVALID', message, { data: { issues: listed } });
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
      return ok(await getPublicBookingPage(entry, services.pictures));
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
      const visitor: PublicPrefill = handoff === undefined ? {} : await readHandoffPrefill(entry, handoff.submissionId);
      // The page's own questions a form answered (spec 0057, AC-5713) ride along: the same stored submission, same token.
      const prefill: PublicPrefill = {
        ...(visitor.name === undefined ? {} : { name: visitor.name }),
        ...(visitor.email === undefined ? {} : { email: visitor.email }),
        ...(visitor.answers === undefined ? {} : { answers: visitor.answers }),
        ...(visitor.skip === undefined ? {} : { skip: visitor.skip }),
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
      // One view per page load (the page asks this once, never in the editor's preview), never a host's own.
      const userAgent = c.req.header('user-agent');
      if (services.views !== undefined && isHost !== true && !isMachine(userAgent) && userAgent !== undefined) {
        const counted = countPageView(
          entry,
          visitorId(services.views.visitorKey, {
            day: utcDay(services.now?.() ?? new Date()),
            ip: c.get('clientIp'),
            userAgent,
            place: entry.pageId,
          }),
        ).catch((error: unknown) => {
          log.warn('booking.view.failed', { requestId: c.get('requestId'), ...errorFields(error) });
        });
        services.views.keepAlive(counted);
      }
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
    '/public/booking/:publicKey/chat',
    bodyLimit({
      maxSize: CHAT_BODY_LIMIT_BYTES,
      onError: () => answer('PAYLOAD_TOO_LARGE', 'This chat is too long. Start again.'),
    }),
  );

  // One chat turn (spec 0042): limited per address and page; a turn that books counts as a booking too. What the
  // visitor typed is never logged (AC-1521).
  app.post('/public/booking/:publicKey/chat', async (c) => {
    const address = addressKey(c.get('clientIp'));
    const key = c.req.param('publicKey');
    // A turn reads the host's calendar as a slots read does, so it counts as one too.
    const refused = limited([
      [`booking:chat:${address}`, BOOKING_LIMITS.chatPerAddress],
      [`booking:chat-page:${key}`, BOOKING_LIMITS.chatPerPage],
      [`booking:read:${address}`, BOOKING_LIMITS.readsPerAddress],
      [`booking:read-page:${key}`, BOOKING_LIMITS.readsPerPage],
    ]);
    if (refused !== undefined) return refused;
    const read = await jsonOf(c);
    if (read === undefined) return answer('INPUT_INVALID', 'The request could not be read.');
    const input = PublicChatInput.safeParse(read.body);
    if (!input.success) return invalid(input.error.issues);
    try {
      const entry = await enterBookingPage({ db }, key);
      // The booking limits and the form's bot checks apply only to a turn about to book.
      let bookRefused: Response | undefined;
      const turn = await chatTurn(entry, deps, input.data, [outboxHook()], {
        mayBook: () => {
          bookRefused = limited([
            [`booking:book:${address}`, BOOKING_LIMITS.booksPerAddress],
            [`booking:book-page:${key}`, BOOKING_LIMITS.booksPerPage],
          ]);
          if (bookRefused !== undefined) return false;
          const ticket = services.tickets?.check(`booking:${key}`, input.data.ticket);
          const elapsed = ticket?.kind === 'valid' ? ticket.elapsedMs : undefined;
          const now = (services.now?.() ?? new Date()).getTime();
          const isBot = looksLikeBot({ startedAt: input.data.startedAt ?? now }, now, elapsed);
          if (isBot) log.warn('booking.chat.bot_refused', { requestId: c.get('requestId') });
          return !isBot;
        },
      });
      if (bookRefused !== undefined) return bookRefused;
      if (turn.bookedNew) wakeRelay();
      return ok(turn.reply);
    } catch (error) {
      if (!toApiError(error).expected) {
        log.error('booking.chat.failed', { requestId: c.get('requestId'), ...errorFields(error) });
      }
      return refusalAnswer(error);
    }
  });

  app.use(
    '/public/booking/:publicKey/book',
    bodyLimit({
      maxSize: BOOK_BODY_LIMIT_BYTES,
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
    if (!input.success) return invalid(input.error.issues);
    const ticket = services.tickets?.check(`booking:${key}`, input.data.ticket);
    const elapsed = ticket?.kind === 'valid' ? ticket.elapsedMs : undefined;
    const bot = botReason(input.data, (services.now?.() ?? new Date()).getTime(), elapsed);
    if (bot !== undefined) {
      // A person can land here too (autofill filled the honeypot, 25 Oct 2026): the reason says which check it was.
      log.warn('booking.bot_refused', { requestId: c.get('requestId'), reason: bot, ticket: ticket?.kind ?? 'none' });
      return answer('INPUT_INVALID', BOT_REFUSED);
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
