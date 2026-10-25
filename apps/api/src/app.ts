import { createHmac, randomUUID } from 'node:crypto';
import { type ErrorCode, errorStatus, installPlainErrors } from '@crm/contracts';
import {
  connectedCalendar,
  createCalendarEvents,
  createBusyCache,
  createHomeMetricsCache,
  enterWorkspace,
  jobKinds,
  NO_CALENDAR,
  servedPicture,
  twoFactorRequiredBy,
  type BookingCalendar,
  type JobRegistry,
  type RuleSource,
} from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import type { AnyRouter } from '@orpc/server';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createActivityNoter } from './analytics/activity.ts';
import { visitorKey } from './analytics/visitor.ts';
import { createAllowlist } from './auth/allowlist.ts';
import { AUTH_BASE_PATH, AUTH_ROUTES, type Auth } from './auth/auth.ts';
import { doorSession } from './auth/door-session.ts';
import { createCalendarRoutes } from './calendar/routes.ts';
import { createFreeDomains } from './calendar/free-domains.ts';
import {
  createCalendarServices,
  GOOGLE_NOTIFY_PATH,
  MICROSOFT_NOTIFY_PATH,
  type CalendarServices,
} from './calendar/services.ts';
import { backgroundHooks } from './hooks.ts';
import { createEdgeGuard, type Geo } from './edge.ts';
import { mountExports } from './forms/exports.ts';
import { handoffKey } from './forms/handoff.ts';
import { hashAddress, mountPublicForms } from './forms/public.ts';
import { createCaptchaVerifier, type CaptchaVerifier } from './forms/recaptcha.ts';
import { createTicketBook, mountTickets } from './forms/ticket.ts';
import { bookingLinkKey } from './booking-link.ts';
import { LOCAL_FORMS_IP_SALT, releaseOf, wakesOnUse, type ApiEnv } from './env.ts';
import { createReadGate } from './gate.ts';
import { errorFields, log } from './log.ts';
import type { Mailer } from './mail/mailer.ts';
import { type Analytics, NO_ANALYTICS } from './monitoring/posthog.ts';
import { captureFault, nameRequest, withRequestScope } from './monitoring/sentry.ts';
import { mountPublicBooking } from './public/booking.ts';
import { mountSiteHits, SITE_HIT_PATH } from './public/site.ts';
import {
  createPictureFetch,
  pictureResponse,
  PRIVATE_PICTURE_CACHE_CONTROL,
  type PictureFetch,
} from './public/picture.ts';
import { createOutsideFetch, type OutsideFetch } from './public/outside.ts';
import { EMAIL_UNSUBSCRIBE_PATH, mountEmailPreferences } from './public/email-preferences.ts';
import { emailLinkKey } from './email-link.ts';
import { guestKeys } from './public/visitor.ts';
import { createMemoryLimiter, type PublicLimiter } from './limits.ts';
import { NO_SIGNED_OUT, type SignedOutNotice } from './realtime/signed-out.ts';
import { createRealtimeTokens } from './realtime/tokens.ts';
import { NO_WAKE, OVERDUE_WAKE_MS, throttleWake, type WakeRelay } from './realtime/wake.ts';
import { operatorList } from './orpc.ts';
import { router as appRouter } from './router.ts';
import { createRpcHandler } from './rpc.ts';
import type { RequestTiming } from './timing.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The address in a sender (`CRM <sign-in@example.com>` or a bare address), for a calendar file's organizer. */
function senderAddress(sender: string | undefined): string | undefined {
  if (sender === undefined) return undefined;
  return /<([^>]+)>/.exec(sender)?.[1] ?? sender;
}

/** Where `system.testFault` answers, when it is switched on. */
const TEST_FAULT_PATH = '/api/rpc/system/testFault';

/**
 * A path as the RPC router may read it: decoded, repeated slashes as one, no trailing slash. So every
 * spelling of the test fault's address (`/testFault/`, `//testFault`, `test%46ault`) is caught as one.
 */
export function routedPath(path: string): string {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Not valid percent encoding: the router can't read it as the test fault either.
  }
  return decoded.replace(/\/{2,}/g, '/').replace(/(.)\/+$/, '$1');
}

/** The most a calendar provider's notice post may carry (Graph sends at most a few dozen small notices). */
const NOTIFY_BODY_LIMIT_BYTES = 256 * 1024;

/** The largest RPC request body the API reads. */
export const RPC_BODY_LIMIT_BYTES = 1024 * 1024;

/** The largest body a sign in route reads: an email, a code, a provider name. */
export const AUTH_BODY_LIMIT_BYTES = 64 * 1024;

interface AppVariables {
  requestId: string;
  clientIp: string | undefined;
  /** Where the edge saw the request come from, on a trusted request only (spec 0033). */
  geo?: Geo;
  /** The browser's Origin, as the edge guard reads it (see `EdgeGuard.origin`). */
  origin: string | undefined;
}

/** A `{ code, message }` answer at the status the error map gives the code. */
function errorResponse(code: ErrorCode, message: string): Response {
  return Response.json({ code, message }, { status: errorStatus(code) });
}

/** A person's own picture: 60 reads a minute each, in this process. */
const MY_PICTURE_LIMIT = { max: 60, windowMs: 60_000 } as const;

/** Work after the answer on a long running server: nothing holds it, and it runs on (it never rejects). */
const RUNS_ON = (work: Promise<unknown>): void => {
  void work.catch(() => undefined);
};

/** A path as logs and error reports may hold it: a guest's manage token (their key to a booking) stands as `:token`. */
export function redactedPath(path: string): string {
  return path.replace(/(\/public\/booking\/manage\/)[^/]+/, '$1:token');
}

/** The route an error report names: a sign in route by its Better Auth path (`auth /sign-in/email-otp`), else the path. */
export function routeOf(path: string): string {
  return path.startsWith(`${AUTH_BASE_PATH}/`) ? `auth ${path.slice(AUTH_BASE_PATH.length)}` : redactedPath(path);
}

/** What the API serves with: the tenant database, global identity, sign in, and the relay's wake up call. */
export interface AppServices {
  readonly db: Database;
  readonly identity: IdentityStore;
  readonly auth: Auth;
  readonly wakeRelay: WakeRelay;
  /**
   * The wake every signed in request sends (spec 0008): `wakeRelay` at most
   * once a minute for this process unless given (tests pass their own).
   */
  readonly wakeOnUse?: WakeRelay;
  /** The wake a read of an overdue job sends: `wakeRelay` at most every 10 seconds for this process unless given. */
  readonly wakeOverdue?: WakeRelay;
  /**
   * Keeps the process alive until work a request started after answering
   * settles (Vercel's `waitUntil`, spec 0045). Absent, as on a long running
   * server, the work simply runs on.
   */
  readonly keepAlive?: (work: Promise<unknown>) => void;
  /**
   * Where the door reads object, field and record rules (spec 0009), always
   * named: the server passes `APP_RULES` (rules.ts, none until #24), the same
   * source its worker re-enters members with; tests and the local test server
   * (`test/rules-server.ts`) inject theirs.
   */
  readonly rules: RuleSource;
  /**
   * The load harness's request timing (spec 0011, AC-202), made by the server
   * only with `LOAD_TIMING=on` (local only) and handed to its pools too: each
   * `/api/rpc` answer then carries `Server-Timing`. Absent, none is sent.
   */
  readonly timing?: RequestTiming;
  /**
   * Product events (spec 0010, milestone 3): PostHog where `POSTHOG_KEY` is
   * set, else none. Absent (tests that don't look at events), nothing is sent.
   */
  readonly analytics?: Analytics;
  /** The job kinds this API knows (spec 0008): the environment's (`jobKinds`) unless a test passes its own. */
  readonly jobs?: JobRegistry;
  /**
   * Calendar sync (spec 0024): the environment's (`CALENDAR_SYNC=on`, Google
   * on the real network) unless a test passes its own (the fake provider).
   */
  readonly calendar?: CalendarServices;
  /** The public forms' reCAPTCHA check (spec 0023): Google with `RECAPTCHA_SECRET_KEY` unless a test passes one. */
  readonly captcha?: CaptchaVerifier;
  /** The public forms' and fill tickets' rate limits (spec 0023): the central limiter unless a test passes its own. */
  readonly formLimits?: PublicLimiter;
  /**
   * The calendar calls booking pages make (spec 0025): busy times and the
   * booking's event, over spec 0024's connections when calendar sync is on,
   * none (`NO_CALENDAR`) when it is off; tests pass a fake. Busy answers are
   * kept 60 seconds per member and range.
   */
  readonly bookingCalendar?: BookingCalendar;
  /** The public booking routes' limiter (spec 0025, AC-643): this process's memory unless a test passes its own. */
  readonly bookingLimiter?: PublicLimiter;
  /** The email preferences routes' limiter (the emails lane): this process's memory unless a test passes its own. */
  readonly emailPreferenceLimiter?: PublicLimiter;
  /** Fetches a host's account picture from Google's picture hosts (23 Oct 2026): the real one unless a test passes its own. */
  readonly pictureFetch?: PictureFetch;
  /** The clock the public booking routes read, for tests. */
  readonly now?: () => Date;
  /** Where invitation emails go (spec 0031): the server's mailer; absent, every send fails and is reported unsent. */
  readonly mailer?: Mailer;
  /**
   * The one read of an address somebody typed (spec 0055, AC-5531). Built here with the import's own bounds: five
   * seconds and 1 MB, which is a page of links with room to spare. A test passes its own.
   */
  readonly outsideFetch?: OutsideFetch;
  /**
   * Cuts a person's live connections when one of their sessions is signed
   * out elsewhere (spec 0033): the worker's notice where `WORKER_INTERNAL_URL`
   * is set, else nothing (tests pass their own to see it called).
   */
  readonly signedOut?: SignedOutNotice;
}

/** The import's bounds (spec 0055, AC-5525): a page of links, read once. */
const IMPORT_TIMEOUT_MS = 5000;
const IMPORT_MAX_BYTES = 1024 * 1024;

/** A mailer that sends nothing and says so: an app built without one reports every invitation unsent. */
const NO_MAILER: Mailer = {
  transport: 'mailpit',
  send: () => Promise.reject(new Error('No mailer was given to this app.')),
};

/** The API. `router` is the app's own unless a test passes one. */
/** The one public link page write: a block's press, `/api/public/handles/<handle>/press`. */
const LINK_PAGE_PRESS = /^\/api\/public\/handles\/[a-z0-9-]+\/press$/;

export function createApp({
  services,
  env,
  router = appRouter,
}: {
  services: AppServices;
  env: ApiEnv;
  router?: AnyRouter;
}) {
  // Every schema without a message of its own answers in plain words (the RPC contract, the public routes, sign in).
  installPlainErrors();
  const { db, identity, auth, wakeRelay, rules, timing, analytics = NO_ANALYTICS } = services;
  const mailer = services.mailer ?? NO_MAILER;
  const outsideFetch =
    services.outsideFetch ?? createOutsideFetch({ timeoutMs: IMPORT_TIMEOUT_MS, maxBytes: IMPORT_MAX_BYTES });
  // Who may start a workspace of their own (spec 0031, owner decision 3): the addresses sign up lets in by the list.
  const signupAllowlist = createAllowlist(env.APP_ENV, env.SIGNUP_ALLOWLIST);
  const signedOut = services.signedOut ?? NO_SIGNED_OUT;
  // The job kinds (spec 0008): the test kind only locally and in previews.
  const jobs = services.jobs ?? jobKinds({ environment: env.APP_ENV });
  const rpc = createRpcHandler(router);
  const edge = createEdgeGuard({ secret: env.EDGE_SECRET, environment: env.APP_ENV });
  const allowedOrigins = new Set([new URL(env.APP_URL).origin, ...(env.TRUSTED_ORIGINS ?? [])]);
  // One per app, so its counts are this process's: at most 6 heavy reads per workspace at once.
  const readGate = createReadGate();
  // One per app too: every signed in request wakes the worker, at most once a minute per process (spec 0008).
  // Off in production until the owner turns the worker's jobs on (WORKER_WAKE_ON_USE).
  const wakeOnUse = services.wakeOnUse ?? (wakesOnUse(env) ? throttleWake(wakeRelay) : NO_WAKE);
  const wakeOverdue = services.wakeOverdue ?? throttleWake(wakeRelay, OVERDUE_WAKE_MS);
  const keepAlive = services.keepAlive ?? RUNS_ON;
  // The operator console (spec 0047): its super admins, the days people use the app, and the visitor id key.
  const operators = operatorList(env.OPERATOR_EMAILS);
  const noteActivity = createActivityNoter({
    note: (userId) => identity.noteActivity(userId),
    keepAlive,
    onError: (error) => log.warn('activity.note.failed', errorFields(error)),
  });
  // Centrifugo's tokens, where live updates are on (spec 0005).
  const realtime =
    env.CENTRIFUGO_TOKEN_SECRET === undefined
      ? undefined
      : createRealtimeTokens({ secret: env.CENTRIFUGO_TOKEN_SECRET });
  // The monitoring test fault (spec 0010, AC-168): off, its address answers exactly as one that doesn't exist.
  const testFault = env.MONITORING_TEST_FAULT === 'on';
  // Calendar sync (spec 0024): off unless switched on, so the app boots without its settings.
  const calendar =
    services.calendar ?? (env.calendar === undefined ? undefined : createCalendarServices(env.calendar, env.APP_URL));
  // The free email domains, loaded once: calendar sync's own list when it is on.
  const isFreeDomain = calendar?.isFreeDomain ?? createFreeDomains();
  // Home's metrics (spec 0041): each workspace's figures, kept a minute in this process.
  const homeMetrics = createHomeMetricsCache();
  // Free and busy and the event writes (spec 0024): one service, so a member's change forgets its kept answers.
  const calendarEvents =
    calendar === undefined
      ? undefined
      : createCalendarEvents({
          db,
          providers: calendar.providers,
          tokenKey: calendar.tokenKey,
          // The booking's meeting row stores its `meetings` event like any background write; the relay polls it.
          hooks: backgroundHooks(),
          isFreeDomain: calendar.isFreeDomain,
        });
  // Where a booking's event goes: the host's connected calendar, or nowhere without sync (public and member routes).
  const booking =
    services.bookingCalendar ??
    (calendar === undefined || calendarEvents === undefined
      ? NO_CALENDAR
      : connectedCalendar({
          db,
          providers: calendar.providers,
          tokenKey: calendar.tokenKey,
          hooks: backgroundHooks(),
          isFreeDomain: calendar.isFreeDomain,
          events: calendarEvents,
        }));
  // Account pictures from Google's picture hosts (23 Oct 2026), for the public pages and the person's own.
  const pictureFetch = services.pictureFetch ?? createPictureFetch();
  // The key every booking's guest page token derives from, shared with the worker's emails.
  const linkKey = bookingLinkKey(env);
  const calendarRoutes = createCalendarRoutes({
    // The same door the RPC's `member` base opens (orpc.ts), with the same rules.
    enter: (session, slug) =>
      enterWorkspace({ db, identity, log, rules }, { userId: session.user.id, slug, session: doorSession(session) }),
    auth,
    wakeRelay,
    analytics,
    calendar,
    db,
    limiter: createMemoryLimiter(),
    appUrl: env.APP_URL,
    secure: env.APP_ENV !== 'local',
  });

  const app = new Hono<{ Variables: AppVariables }>().basePath('/api');

  // Every request gets its own id, never one the caller chose; logs carry it.
  app.use('*', async (c, next) => {
    const requestId = randomUUID();
    c.set('requestId', requestId);
    // Its own monitoring scope too, so an error report names this request (and its user and workspace) only.
    await withRequestScope(requestId, next);
    c.header('x-request-id', requestId);
  });

  // Only requests through Vercel's middleware reach the API (see edge.ts). The
  // client IP is read here, from the request the guard saw, and nowhere else.
  app.use('*', async (c, next) => {
    if (!edge.admit(c.req.raw)) {
      return errorResponse('EDGE_REQUIRED', 'This API is reachable only through the app.');
    }
    c.set('clientIp', edge.clientIp(c.req.raw));
    c.set('geo', edge.geo(c.req.raw));
    c.set('origin', edge.origin(c.req.raw));
    return next();
  });

  // Liveness: the process is up. Readiness: it can reach Postgres.
  // The release is the deployed commit (or `local`): the web deploy waits until it matches its own.
  const release = releaseOf(env);
  app.get('/health', (c) => c.json({ status: 'ok', release }));
  app.get('/health/ready', async (c) => {
    try {
      await db.checkHealth();
      return c.json({ status: 'ok' });
    } catch (error) {
      log.warn('Readiness check failed', { requestId: c.get('requestId'), ...errorFields(error) });
      return c.json({ status: 'unavailable' }, 503);
    }
  });

  // The public form endpoints (spec 0023) check their own origin (the hosted page's), and need no session.
  const formsOrigin = new URL(env.FORMS_PUBLIC_ORIGIN ?? env.APP_URL).origin;
  // The public booking pages may be served from their own origin (BOOKING_PUBLIC_ORIGIN): their writes come from there.
  const bookingOrigin = new URL(env.BOOKING_PUBLIC_ORIGIN ?? env.APP_URL).origin;
  // The app and API share one origin, so a write from anywhere else is refused.
  app.use('*', async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    // The forms' public writes check the hosted page's own origin; booking's stay on the app's (spec 0025).
    if (c.req.path.startsWith('/api/public/forms/')) return next();
    // The marketing site's beacon checks its own origins, SITE_ORIGINS (spec 0047, AC-1627).
    if (c.req.path === SITE_HIT_PATH && c.req.method === 'POST') return next();
    // Google's change notices carry no Origin: the channel's own token is their key (spec 0024, milestone 2).
    if (c.req.path === GOOGLE_NOTIFY_PATH && c.req.method === 'POST') return next();
    // A mail service's one click unsubscribe (RFC 8058) carries no Origin: the link's signed token is its only key.
    if (c.req.path === EMAIL_UNSUBSCRIBE_PATH && c.req.method === 'POST') return next();
    // Graph's notices and its validation request likewise: the client state is their key (milestone 4, AC-1008).
    if (c.req.path === MICROSOFT_NOTIFY_PATH && c.req.method === 'POST') return next();
    const origin = c.get('origin');
    // A public booking page's own writes (book, chat, the guest page's changes) from the booking origin.
    if (origin === bookingOrigin && c.req.path.startsWith('/api/public/booking/')) return next();
    // A link page's press beacon (spec 0051, AC-5125), from the public origin the page is served on; that one route.
    if (origin === bookingOrigin && LINK_PAGE_PRESS.test(c.req.path) && c.req.method === 'POST') return next();
    if (!origin || !allowedOrigins.has(origin)) {
      return errorResponse('FORBIDDEN_ORIGIN', 'This request came from an origin the API does not accept.');
    }
    return next();
  });

  app.use(
    '/rpc/*',
    bodyLimit({
      maxSize: RPC_BODY_LIMIT_BYTES,
      onError: () => errorResponse('PAYLOAD_TOO_LARGE', 'This request is larger than the 1 MB the API accepts.'),
    }),
  );

  app.all('/rpc/*', async (c) => {
    if (!testFault && routedPath(c.req.path) === TEST_FAULT_PATH) return c.notFound();
    if (timing === undefined) return answerRpc(c);
    return timing.timed(() => answerRpc(c));
  });

  async function answerRpc(c: Context<{ Variables: AppVariables }>): Promise<Response> {
    const { matched, response } = await rpc.handle(c.req.raw, {
      prefix: '/api/rpc',
      context: {
        db,
        identity,
        auth,
        wakeRelay,
        wakeOnUse,
        wakeOverdue,
        keepAlive,
        analytics,
        environment: env.APP_ENV,
        requestId: c.get('requestId'),
        clientIp: c.get('clientIp'),
        headers: c.req.raw.headers,
        readGate,
        realtime,
        testFault,
        jobs,
        calendar,
        calendarEvents,
        isFreeDomain,
        bookingCalendar: booking,
        homeMetrics,
        bookingLinkKey: linkKey,
        rules,
        mailer,
        outsideFetch,
        appUrl: env.APP_URL,
        // Only the limiter's one call, so a member handler holds nothing else of global identity at run time.
        limiter: { consumeRateLimit: (key, rule, cost) => identity.consumeRateLimit(key, rule, cost) },
        mayStartWorkspace: (email) => signupAllowlist.allows(email),
        // Only the directory's one write, so a member handler holds nothing else of global identity at run time.
        directory: {
          dropMembership: (userId, workspaceId, memberId) => identity.dropMembership(userId, workspaceId, memberId),
          renameWorkspace: (workspaceId, name) => identity.renameWorkspace(workspaceId, name),
          setWorkspaceDeleted: (workspaceId, deleted) => identity.setWorkspaceDeleted(workspaceId, deleted),
        },
        signedOut,
        requiredBy: (userId) => twoFactorRequiredBy({ db, identity }, userId),
        operators,
        noteActivity,
        // Only these three calls, by ids, for the workspace security settings and the Members column (spec 0033).
        factors: {
          secondFactorUsers: (userIds) => identity.secondFactorUsers(userIds),
          sessionVerification: (userId, sessionId) => identity.sessionVerification(userId, sessionId),
          markSessionVerified: (userId, sessionId, verifiedWith) =>
            identity.markSessionVerified(userId, sessionId, verifiedWith),
        },
        // Only whether a person has Google linked, by their own user id, for Profile's Sync Google photo.
        googleLinked: (userId) => identity.hasGoogleAccount(userId),
      },
    });
    return matched ? c.newResponse(response.body, response) : c.notFound();
  }

  // Connecting a calendar (spec 0024): the browser navigates both, so they are plain routes beside the RPC.
  app.get('/calendar/google/start', (c) => calendarRoutes.start(c));
  app.get('/calendar/google/callback', (c) => calendarRoutes.callback(c));
  // Notices are small: a post past 256 KB is refused before it is read.
  for (const path of ['/calendar/google/notify', '/calendar/microsoft/notify'])
    app.use(path, bodyLimit({ maxSize: NOTIFY_BODY_LIMIT_BYTES, onError: (c) => c.body(null, 413) }));
  app.post('/calendar/google/notify', (c) => calendarRoutes.notify(c));
  // Outlook (milestone 4): the same connect leg, and Graph's notices.
  app.get('/calendar/microsoft/start', (c) => calendarRoutes.start(c, 'microsoft'));
  app.get('/calendar/microsoft/callback', (c) => calendarRoutes.callback(c, 'microsoft'));
  app.post('/calendar/microsoft/notify', (c) => calendarRoutes.notifyMicrosoft(c));

  // The central limits module (`limits.ts`): one limiter per surface, so a flood on one never evicts another's
  // windows; ticket uses (a day long) count apart from everything. The fill tickets forms and booking share.
  const formLimiter = services.formLimits ?? createMemoryLimiter();
  const ipSalt = env.FORMS_IP_SALT ?? LOCAL_FORMS_IP_SALT;
  // Daily visitor ids for the console's counts (spec 0047, AC-1626), keyed from the same secret under their own label.
  const visitors = visitorKey(ipSalt);
  const tickets = createTicketBook({ salt: ipSalt, limiter: createMemoryLimiter() });
  mountTickets(app, {
    tickets,
    limiter: createMemoryLimiter(),
    addressOf: (c) => hashAddress(ipSalt, c.get('clientIp')) ?? 'unknown',
  });
  // An export's download (spec 0023): the session and the same member door, with the same rules, only for its
  // starter.
  mountExports(app, {
    auth,
    enter: (session, slug) =>
      enterWorkspace({ db, identity, log, rules }, { userId: session.user.id, slug, session: doorSession(session) }),
  });
  // The form to booking hand off (spec 0023 AC-1057): one key, signing on the form's side and reading on the page's.
  const formsHandoffKey = handoffKey(env.BETTER_AUTH_SECRET);
  mountPublicForms(app, {
    db,
    jobs,
    wakeRelay,
    captcha:
      services.captcha ??
      createCaptchaVerifier(env.RECAPTCHA_SECRET_KEY === undefined ? {} : { secret: env.RECAPTCHA_SECRET_KEY }),
    limiter: formLimiter,
    tickets,
    publicOrigin: formsOrigin,
    ipSalt,
    answersKey: createHmac('sha256', ipSalt).update('crm-answers-hash-v1').digest('hex'),
    handoffKey: formsHandoffKey,
    ...(env.RECAPTCHA_SITE_KEY === undefined ? {} : { recaptchaSiteKey: env.RECAPTCHA_SITE_KEY }),
  });

  // Better Auth's own routes: only the ones sign in uses (`AUTH_ROUTES`), matched on the path as sent, so
  // an encoded or padded path never reaches a route we didn't list.
  app.use('/auth/*', async (c, next) => {
    const route = new URL(c.req.url).pathname.slice(AUTH_BASE_PATH.length);
    if (!AUTH_ROUTES.has(route)) return errorResponse('NOT_FOUND', 'There is nothing at this address.');
    // The request's trace, by its sign in route (spec 0010, AC-170): one we listed, never a path as sent.
    nameRequest(routeOf(`${AUTH_BASE_PATH}${route}`));
    return next();
  });

  app.use(
    '/auth/*',
    bodyLimit({
      maxSize: AUTH_BODY_LIMIT_BYTES,
      onError: () => errorResponse('PAYLOAD_TOO_LARGE', 'This request is larger than the 64 KB sign in accepts.'),
    }),
  );

  // It sees only the client IP the edge guard trusted.
  app.on(['GET', 'POST'], '/auth/*', (c) => auth.handle(c.req.raw, c.get('clientIp'), c.get('origin'), c.get('geo')));

  // Hosts' and signed in visitors' busy times, each kept for its minute.
  const bookingBusy = createBusyCache(booking.busy);
  // Booking pages' public routes (spec 0025): a page's public key, no session; writes passed the Origin check above.
  // An email's preferences link (the emails lane): its signed token, no session; reads, changes, one click unsubscribe.
  mountEmailPreferences(app, {
    db,
    linkKey: emailLinkKey(env),
    limiter: services.emailPreferenceLimiter ?? createMemoryLimiter(),
    ...(services.now === undefined ? {} : { now: services.now }),
  });
  mountPublicBooking(app, {
    db,
    handoffKey: formsHandoffKey,
    calendar: {
      busy: bookingBusy,
      events: booking.events,
      ...(booking.existing === undefined ? {} : { existing: booking.existing }),
    },
    linkKey,
    limiter: services.bookingLimiter ?? createMemoryLimiter(),
    tickets,
    ics: {
      appOrigin: new URL(env.APP_URL).origin,
      publicOrigin: bookingOrigin,
      organizerEmail: senderAddress(env.MAIL_FROM) ?? `bookings@${new URL(env.APP_URL).hostname}`,
      organizerName: 'Bookings',
    },
    wakeRelay,
    pictures: {
      // Only the one read of schema auth, so a public route holds nothing else of global identity. A failure is no
      // picture: the page's facts never fail for it.
      pictureOf: (userId) =>
        identity.userImage(userId).catch((error: unknown) => {
          log.warn('booking.picture.unread', errorFields(error));
          return undefined;
        }),
      fetch: pictureFetch,
    },
    ...(services.now === undefined ? {} : { now: services.now }),
    // Knowing the visitor (spec 0028): their session through the member door, or a guest's own Google for the visit.
    visitor: {
      auth,
      workspacesOf: (userId) => identity.workspacesOf(userId),
      enter: (session, slug) =>
        enterWorkspace({ db, identity, log, rules }, { userId: session.user.id, slug, session: doorSession(session) }),
      memberBusy: bookingBusy,
      ...(calendar === undefined
        ? {}
        : {
            guest: { calendar: calendar.guest, keys: guestKeys(calendar.tokenKey) },
            stateKey: calendar.guestStateKey,
          }),
      appUrl: env.APP_URL,
      secure: env.APP_ENV !== 'local',
    },
    // Page views for the console (spec 0047, AC-1625), counted after the answer.
    views: { visitorKey: visitors, keepAlive },
  });

  // The marketing site's beacon (spec 0047, AC-1627): only from SITE_ORIGINS, 60 a minute per address.
  mountSiteHits(app, {
    record: (visit) => identity.recordSiteVisit(visit),
    origins: new Set((env.SITE_ORIGINS ?? []).map((origin) => new URL(origin).origin)),
    limiter: createMemoryLimiter(),
    visitorKey: visitors,
    keepAlive,
    ...(services.now === undefined ? {} : { now: services.now }),
  });

  // The signed in person's own picture (23 Oct 2026), for Settings › Profile: Google's, from our own origin (the
  // app's policy loads nothing from Google), only its current version, kept in their browser alone.
  const myPictureLimiter = createMemoryLimiter();
  app.get('/me/picture', async (c) => {
    const session = await auth.session(c.req.raw.headers, c.get('clientIp'));
    if (session === undefined) return errorResponse('UNAUTHENTICATED', 'Sign in to continue.');
    const picture = servedPicture(session.user.id, session.user.image);
    if (picture === undefined || c.req.query('v') !== picture.version) {
      return errorResponse('NOT_FOUND', 'There’s no picture here.');
    }
    const decision = myPictureLimiter(`me-picture:${session.user.id}`, MY_PICTURE_LIMIT);
    if (!decision.allowed) return errorResponse('RATE_LIMITED', 'Too many requests. Wait a moment and try again.');
    const fetched = await pictureFetch(picture.url);
    if (!fetched.ok) {
      log.warn('me.picture.missed', { requestId: c.get('requestId'), reason: fetched.reason });
      return errorResponse('NOT_FOUND', 'There’s no picture here.');
    }
    const answered = pictureResponse(fetched, PRIVATE_PICTURE_CACHE_CONTROL);
    for (const cookie of session.setCookies) answered.headers.append('set-cookie', cookie);
    return answered;
  });

  app.notFound(() => errorResponse('NOT_FOUND', 'There is nothing at this address.'));
  app.onError((error, c) => {
    log.error('Unhandled error', {
      requestId: c.get('requestId'),
      path: redactedPath(c.req.path),
      ...errorFields(error),
    });
    captureFault(error, { requestId: c.get('requestId'), route: routeOf(c.req.path) });
    return errorResponse('INTERNAL', 'Something went wrong. Try again.');
  });

  return app;
}
