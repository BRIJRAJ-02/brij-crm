// Connecting a calendar (spec 0024, AC-597): the two browser addresses of the
// OAuth dance, as Hono routes beside the RPC, since the browser navigates
// them. Adapted from an earlier scheduling build's connect leg, entirely
// outside sign in, writing only calendar connections.
//
// `GET /api/calendar/google/start?workspace=<slug>` lets in a signed in active
// member of the workspace (the access door), then sends them to Google with a
// `state` signed for 10 minutes that carries the workspace, the member and a
// nonce; the nonce also goes into an http only cookie on this path. The
// callback takes the state only with that same cookie, and clears it, so a
// state is good once, in the browser that started it, and a link someone else
// crafted with their own code never connects their calendar to your account.
// It checks the session is still that member, exchanges the code (outside any
// transaction), stores the sealed tokens and queues the first sync
// (`connectCalendar`, through `commitWrite`, which wakes the worker), and
// sends the member back to Settings › Calendar with what happened in
// `?calendar=`: `connected`, `denied`, `scope` (a permission was unticked),
// `limit`, `off` or `failed`. Nothing the provider said is shown or logged.
// `?then=welcome` on the start (spec 0036, AC-1217) sends them back to first
// run's calendar step instead: the one other place known, carried inside the
// signed state, so the callback never takes a return address from the query.
//
// `POST /api/calendar/google/notify` (milestone 2, AC-602) is where Google
// posts a change notice for a push channel: no session and no Origin, so the
// origin check lets this one path by, and the channel's own token is the
// only key (`takeCalendarNotice`). It answers 200 with no body whatever the
// notice was, so a caller learns nothing, and a notice that queued a sync
// pokes the worker. A channel sent more than 120 a minute is told to wait.
// Each notice leaves one `calendar.notice` line: the calendar, account and
// workspace it matched (our ids) and what it did, or why it was refused,
// never its token or channel id.
//
// A workspace deleted between the start and the callback is refused there
// too: the door refuses it at the callback, and `connectCalendar` checks it
// again inside its own transaction, since the code exchange takes a moment.
//
// Outlook (milestone 4, AC-1006, AC-1008) has the same three addresses under
// `/api/calendar/microsoft/`: the connect leg is the same, through Microsoft's
// consent screen, and the state names the provider, so a state started for one
// can't finish the other. Its notify address first answers Graph's validation
// request (`?validationToken=`, echoed as plain text), then takes notices from
// a JSON body: each is checked by its subscription id and `clientState` (the
// channel's token), and a lifecycle notice marks the subscription for renewal.
// It answers 202 whatever the notices were.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  connectCalendar,
  isProviderError,
  isRefusal,
  signValue,
  takeCalendarNotice,
  verifyValue,
  type NoticeResult,
} from '@crm/core';
import type { Database } from '@crm/db';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Auth, AuthSession } from '../auth/auth.ts';
import { commitWrite } from '../hooks.ts';
import { errorFields, log } from '../log.ts';
import type { Analytics } from '../monitoring/posthog.ts';
import type { PublicLimiter } from '../public/limits.ts';
import type { WakeRelay } from '../realtime/wake.ts';
import type { CalendarServices, ConnectProvider } from './services.ts';

/** The cookie holding the nonce of a connect under way. */
export const STATE_COOKIE = 'crm_calendar_state';

/** Notices one caller may post a minute. */
export const NOTICE_LIMIT = { max: 120, windowMs: 60_000 } as const;

/**
 * Graph's notice posts from one address in a minute, before any is parsed: generous, since Microsoft sends every
 * tenant's notices from a few addresses (a post refused here is retried by Graph), but a ceiling on forged posts.
 */
export const NOTIFY_POST_LIMIT = { max: 1_200, windowMs: 60_000 } as const;

/** A Graph subscription id: a GUID. Anything else is refused before the database is asked. */
const SUBSCRIPTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The state's version: a later scheme reads its own. */
const STATE_VERSION = 'cs1';

/** How long a connect may take at Google's consent screen. */
const STATE_SECONDS = 10 * 60;

/** The scope the member door hands back, as `connectCalendar` takes it. */
type DoorScope = Parameters<typeof connectCalendar>[0];

/** What Settings › Calendar is told happened. */
export type ConnectResult = 'connected' | 'denied' | 'scope' | 'limit' | 'off' | 'failed';

/** Where a connect comes back to: Settings › Calendar (the default), or first run's calendar step (spec 0036). */
export type ConnectReturn = 'settings' | 'welcome';

/** The return place a query or a signed state names: `welcome` only when it says exactly that. */
function returnOf(value: unknown): ConnectReturn {
  return value === 'welcome' ? 'welcome' : 'settings';
}

/** What the connect routes need. */
export interface CalendarRouteDeps {
  /**
   * The member door (`enterWorkspace` with the app's database, identity and
   * rules), as the RPC's `member` base uses it: a signed in person's scope in
   * the workspace at `slug`, or a refusal.
   */
  readonly enter: (session: AuthSession, slug: string) => Promise<DoorScope>;
  readonly auth: Auth;
  readonly wakeRelay: WakeRelay;
  readonly analytics: Analytics;
  readonly calendar: CalendarServices | undefined;
  /** The app's database: a notice reads its channel as the system in the workspace its token names. */
  readonly db: Database;
  /** Counts notices per caller. */
  readonly limiter: PublicLimiter;
  readonly appUrl: string;
  /** Outside local the cookie is Secure. */
  readonly secure: boolean;
}

type RouteContext = Context<{
  Variables: { clientIp: string | undefined; requestId: string; origin: string | undefined };
}>;

/** A workspace address as the door takes it: anything else sends nobody anywhere. */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Notices one Graph post may carry that are read; the rest are dropped (Graph batches far fewer). */
const NOTICES_MAX = 50;

/** The longest validation token echoed back. */
const VALIDATION_MAX = 1024;

/** Google's resource states and Graph's lifecycle events a log line names; anything else reads `other`. */
const NOTICE_STATES: ReadonlySet<string> = new Set([
  'sync',
  'exists',
  'not_exists',
  'reauthorizationRequired',
  'subscriptionRemoved',
  'missed',
]);

/**
 * One notice's `calendar.notice` line: the calendar, account and workspace it matched (our ids) and what it did, or
 * why it was refused (at warn). Never its token, its channel id or anything else the caller chose.
 */
function logNotice(
  requestId: string,
  provider: ConnectProvider,
  state: string | undefined,
  result: NoticeResult,
): void {
  const fields = {
    requestId,
    provider,
    ...(state === undefined ? {} : { state: NOTICE_STATES.has(state) ? state : 'other' }),
    ...result,
  };
  if (result.outcome === 'refused') log.warn('calendar.notice', fields);
  else log.info('calendar.notice', fields);
}

/** The page in the app a connect for `slug` comes back to, before what happened is added. */
function returnPath(slug: string, then: ConnectReturn): string {
  return then === 'welcome' ? `/welcome?step=calendar&workspace=${slug}` : `/w/${slug}/settings/calendar`;
}

/** The calendar settings page of a workspace (or first run's calendar step), with what happened. */
function settingsUrl(
  appUrl: string,
  slug: string | undefined,
  result: ConnectResult,
  then: ConnectReturn = 'settings',
): string {
  const url = new URL(slug === undefined ? '/' : returnPath(slug, then), new URL(appUrl).origin);
  url.searchParams.set('calendar', result);
  return url.toString();
}

/** The signed in member of `slug`, through the access door, or undefined (signed out, or not a member there). */
async function memberIn(
  deps: CalendarRouteDeps,
  c: RouteContext,
  slug: string,
): Promise<{ readonly scope: DoorScope; readonly userId: string } | undefined> {
  const session = await deps.auth.session(c.req.raw.headers, c.get('clientIp'));
  if (session === undefined) return undefined;
  for (const cookie of session.setCookies) c.header('set-cookie', cookie, { append: true });
  try {
    const scope = await deps.enter(session, slug);
    if (scope.access.principal.kind !== 'member') return undefined;
    return { scope, userId: session.user.id };
  } catch (error) {
    if (isRefusal(error)) return undefined;
    throw error;
  }
}

/** The connect routes' two handlers. */
export function createCalendarRoutes(deps: CalendarRouteDeps) {
  return {
    /** `GET /api/calendar/<provider>/start?workspace=<slug>`. */
    async start(c: RouteContext, provider: ConnectProvider = 'google'): Promise<Response> {
      const slug = c.req.query('workspace');
      const then = returnOf(c.req.query('then'));
      if (slug === undefined || !SLUG.test(slug)) return c.redirect(settingsUrl(deps.appUrl, undefined, 'failed'));
      const adapter = deps.calendar?.providers[provider];
      if (deps.calendar === undefined || adapter === undefined) {
        return c.redirect(settingsUrl(deps.appUrl, slug, 'off', then));
      }
      const member = await memberIn(deps, c, slug);
      if (member === undefined) {
        const signIn = new URL('/sign-in', new URL(deps.appUrl).origin);
        signIn.searchParams.set('redirect', returnPath(slug, then));
        return c.redirect(signIn.toString());
      }
      const nonce = randomBytes(18).toString('base64url');
      const memberId = member.scope.actor.id ?? '';
      const payload = { w: slug, m: memberId, n: nonce, p: provider, ...(then === 'welcome' ? { t: then } : {}) };
      const state = signValue(deps.calendar.stateKey, STATE_VERSION, payload, STATE_SECONDS);
      setCookie(c, STATE_COOKIE, nonce, {
        path: '/api/calendar/',
        httpOnly: true,
        sameSite: 'Lax',
        secure: deps.secure,
        maxAge: STATE_SECONDS,
      });
      return c.redirect(adapter.authorizeUrl(state, deps.calendar.redirectUris[provider]));
    },

    /**
     * `POST /api/calendar/microsoft/notify`: Graph's validation request, or its change and lifecycle notices
     * (AC-1008), by each notice's subscription id and client state alone.
     */
    async notifyMicrosoft(c: RouteContext): Promise<Response> {
      const validation = c.req.query('validationToken');
      // Outlook off: nothing here answers, not even the echo.
      if (deps.calendar?.providers.microsoft === undefined) return c.body(null, validation === undefined ? 202 : 404);
      if (validation !== undefined) {
        // Graph waits for the token back as plain text before it makes the subscription. Never sniffed as a page:
        // it is text a stranger chose, echoed on the app's origin.
        if (validation.length > VALIDATION_MAX || !/^[\x20-\x7e]*$/.test(validation)) return c.body(null, 400);
        return c.text(validation, 200, {
          'content-type': 'text/plain; charset=utf-8',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'",
        });
      }
      if (!deps.limiter(`calendar-notify-post:${c.get('clientIp') ?? 'unknown'}`, NOTIFY_POST_LIMIT).allowed)
        return c.body(null, 429);
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.body(null, 202);
      }
      const notices = Array.isArray((body as { value?: unknown } | null)?.value)
        ? (body as { value: unknown[] }).value.slice(0, NOTICES_MAX)
        : [];
      let queued = false;
      let refused = 0;
      for (const notice of notices) {
        if (typeof notice !== 'object' || notice === null) continue;
        const { subscriptionId, clientState, lifecycleEvent } = notice as Record<string, unknown>;
        if (typeof subscriptionId !== 'string' || !SUBSCRIPTION_ID.test(subscriptionId)) {
          refused += 1;
          continue;
        }
        if (!deps.limiter(`calendar-notice:${subscriptionId.slice(0, 64)}`, NOTICE_LIMIT).allowed) continue;
        const state = typeof lifecycleEvent === 'string' ? lifecycleEvent : 'exists';
        const result = await takeCalendarNotice(deps.db, {
          channelId: subscriptionId,
          token: typeof clientState === 'string' ? clientState : undefined,
          state,
        });
        // Refused ones are counted, so a forged post is one line; a matched notice gets its own.
        if (result.outcome === 'refused') {
          refused += 1;
          continue;
        }
        if (result.outcome === 'queued') queued = true;
        logNotice(c.get('requestId'), 'microsoft', state, result);
      }
      // One line a post, however many of its notices were refused.
      if (refused > 0) {
        log.warn('calendar.notice', {
          requestId: c.get('requestId'),
          provider: 'microsoft',
          outcome: 'refused',
          count: refused,
        });
      }
      if (queued) deps.wakeRelay();
      return c.body(null, 202);
    },

    /** `POST /api/calendar/google/notify`: Google's change notice, by its headers alone. */
    async notify(c: RouteContext): Promise<Response> {
      // Per channel, not per caller: every real notice comes from a handful of Google's addresses.
      const channel = (c.req.header('x-goog-channel-id') ?? '').slice(0, 64);
      if (!deps.limiter(`calendar-notice:${channel}`, NOTICE_LIMIT).allowed) return c.body(null, 429);
      if (deps.calendar === undefined) return c.body(null, 200);
      const state = c.req.header('x-goog-resource-state');
      const result = await takeCalendarNotice(deps.db, {
        channelId: c.req.header('x-goog-channel-id'),
        token: c.req.header('x-goog-channel-token'),
        state,
      });
      logNotice(c.get('requestId'), 'google', state, result);
      if (result.outcome === 'queued') deps.wakeRelay();
      return c.body(null, 200);
    },

    /** `GET /api/calendar/<provider>/callback?code=…&state=…` (or `error=…`). */
    async callback(c: RouteContext, provider: ConnectProvider = 'google'): Promise<Response> {
      const nonce = getCookie(c, STATE_COOKIE);
      // Single use: whatever happens next, this browser's state is spent.
      deleteCookie(c, STATE_COOKIE, { path: '/api/calendar/', secure: deps.secure });
      const calendar = deps.calendar;
      const payload =
        calendar === undefined ? undefined : verifyValue(calendar.stateKey, STATE_VERSION, c.req.query('state'));
      const slug = typeof payload?.w === 'string' && SLUG.test(payload.w) ? payload.w : undefined;
      // Only the signed state says where to go back to: never the callback's own query.
      const then = returnOf(payload?.t);
      const sameBrowser =
        nonce !== undefined &&
        typeof payload?.n === 'string' &&
        payload.n.length === nonce.length &&
        timingSafeEqual(Buffer.from(payload.n), Buffer.from(nonce));
      const adapter = calendar?.providers[provider];
      if (calendar === undefined || adapter === undefined)
        return c.redirect(settingsUrl(deps.appUrl, slug, 'off', then));
      // A state from before Outlook names no provider: it was Google's.
      const statedProvider = typeof payload?.p === 'string' ? payload.p : 'google';
      if (
        payload === undefined ||
        slug === undefined ||
        !sameBrowser ||
        typeof payload.m !== 'string' ||
        statedProvider !== provider
      ) {
        log.warn('calendar.connect.refused', { requestId: c.get('requestId'), reason: 'state' });
        return c.redirect(settingsUrl(deps.appUrl, slug, 'failed', then));
      }
      // The member said no on Google's screen.
      if (c.req.query('error') !== undefined) return c.redirect(settingsUrl(deps.appUrl, slug, 'denied', then));
      const code = c.req.query('code');
      if (code === undefined || code.length > 2048) return c.redirect(settingsUrl(deps.appUrl, slug, 'failed', then));
      const member = await memberIn(deps, c, slug);
      // Signed out meanwhile, or now someone else: the state was for the member who started.
      if (member === undefined || member.scope.actor.id !== payload.m) {
        log.warn('calendar.connect.refused', { requestId: c.get('requestId'), reason: 'member' });
        return c.redirect(settingsUrl(deps.appUrl, slug, 'failed', then));
      }
      let result: ConnectResult = 'connected';
      try {
        const exchanged = await adapter.exchangeCode(code, calendar.redirectUris[provider]);
        const connected = await commitWrite(
          { wakeRelay: deps.wakeRelay, analytics: deps.analytics, user: { id: member.userId } },
          { mutationId: crypto.randomUUID() },
          (hooks) => connectCalendar(member.scope, { provider, exchanged, tokenKey: calendar.tokenKey }, hooks),
        );
        // Which account this connect made (or reconnected), so its first sync and channels read alongside it.
        log.info('calendar.connect.connected', {
          requestId: c.get('requestId'),
          provider,
          workspaceId: member.scope.workspaceId,
          connectionId: connected.id,
        });
      } catch (error) {
        if (isProviderError(error)) {
          result = error.code === 'CALENDAR_SCOPE_DECLINED' ? 'scope' : 'failed';
          log.warn('calendar.connect.failed', { requestId: c.get('requestId'), code: error.code });
        } else if (isRefusal(error) && error.refusal.code === 'LIMIT_REACHED') {
          result = 'limit';
        } else if (isRefusal(error) && error.refusal.code === 'NOT_FOUND') {
          // The workspace was deleted while the member was at the consent screen: nothing was stored.
          log.warn('calendar.connect.refused', { requestId: c.get('requestId'), reason: 'workspace' });
          result = 'failed';
        } else {
          log.error('calendar.connect.failed', { requestId: c.get('requestId'), ...errorFields(error) });
          result = 'failed';
        }
      }
      return c.redirect(settingsUrl(deps.appUrl, slug, result, then));
    },
  };
}
