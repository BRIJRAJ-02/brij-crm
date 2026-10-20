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
//
// `POST /api/calendar/google/notify` (milestone 2, AC-602) is where Google
// posts a change notice for a push channel: no session and no Origin, so the
// origin check lets this one path by, and the channel's own token is the
// only key (`takeCalendarNotice`). It answers 200 with no body whatever the
// notice was, so a caller learns nothing, and a notice that queued a sync
// pokes the worker. A channel sent more than 120 a minute is told to wait.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { connectCalendar, isProviderError, isRefusal, signValue, takeCalendarNotice, verifyValue } from '@crm/core';
import type { Database } from '@crm/db';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Auth } from '../auth/auth.ts';
import { commitWrite } from '../hooks.ts';
import { errorFields, log } from '../log.ts';
import type { Analytics } from '../monitoring/posthog.ts';
import type { PublicLimiter } from '../public/limits.ts';
import type { WakeRelay } from '../realtime/wake.ts';
import type { CalendarServices } from './services.ts';

/** The cookie holding the nonce of a connect under way. */
export const STATE_COOKIE = 'crm_calendar_state';

/** Notices one caller may post a minute. */
export const NOTICE_LIMIT = { max: 120, windowMs: 60_000 } as const;

/** The state's version: a later scheme reads its own. */
const STATE_VERSION = 'cs1';

/** How long a connect may take at Google's consent screen. */
const STATE_SECONDS = 10 * 60;

/** The scope the member door hands back, as `connectCalendar` takes it. */
type DoorScope = Parameters<typeof connectCalendar>[0];

/** What Settings › Calendar is told happened. */
export type ConnectResult = 'connected' | 'denied' | 'scope' | 'limit' | 'off' | 'failed';

/** What the connect routes need. */
export interface CalendarRouteDeps {
  /**
   * The member door (`enterWorkspace` with the app's database, identity and
   * rules), as the RPC's `member` base uses it: a signed in person's scope in
   * the workspace at `slug`, or a refusal.
   */
  readonly enter: (userId: string, slug: string) => Promise<DoorScope>;
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

/** The calendar settings page of a workspace, with what happened. */
function settingsUrl(appUrl: string, slug: string | undefined, result: ConnectResult): string {
  const path = slug === undefined ? '/' : `/w/${slug}/settings/calendar`;
  const url = new URL(path, new URL(appUrl).origin);
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
    const scope = await deps.enter(session.user.id, slug);
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
    /** `GET /api/calendar/google/start?workspace=<slug>`. */
    async start(c: RouteContext): Promise<Response> {
      const slug = c.req.query('workspace');
      if (slug === undefined || !SLUG.test(slug)) return c.redirect(settingsUrl(deps.appUrl, undefined, 'failed'));
      if (deps.calendar === undefined) return c.redirect(settingsUrl(deps.appUrl, slug, 'off'));
      const member = await memberIn(deps, c, slug);
      if (member === undefined) {
        const signIn = new URL('/sign-in', new URL(deps.appUrl).origin);
        signIn.searchParams.set('redirect', `/w/${slug}/settings/calendar`);
        return c.redirect(signIn.toString());
      }
      const nonce = randomBytes(18).toString('base64url');
      const memberId = member.scope.actor.id ?? '';
      const state = signValue(deps.calendar.stateKey, STATE_VERSION, { w: slug, m: memberId, n: nonce }, STATE_SECONDS);
      setCookie(c, STATE_COOKIE, nonce, {
        path: '/api/calendar/',
        httpOnly: true,
        sameSite: 'Lax',
        secure: deps.secure,
        maxAge: STATE_SECONDS,
      });
      return c.redirect(deps.calendar.providers.google.authorizeUrl(state, deps.calendar.redirectUri));
    },

    /** `POST /api/calendar/google/notify`: Google's change notice, by its headers alone. */
    async notify(c: RouteContext): Promise<Response> {
      // Per channel, not per caller: every real notice comes from a handful of Google's addresses.
      const channel = (c.req.header('x-goog-channel-id') ?? '').slice(0, 64);
      if (!deps.limiter(`calendar-notice:${channel}`, NOTICE_LIMIT).allowed) return c.body(null, 429);
      if (deps.calendar === undefined) return c.body(null, 200);
      const outcome = await takeCalendarNotice(deps.db, {
        channelId: c.req.header('x-goog-channel-id'),
        token: c.req.header('x-goog-channel-token'),
        state: c.req.header('x-goog-resource-state'),
      });
      if (outcome === 'queued') deps.wakeRelay();
      else if (outcome === 'refused') log.warn('calendar.notice.refused', { requestId: c.get('requestId') });
      return c.body(null, 200);
    },

    /** `GET /api/calendar/google/callback?code=…&state=…` (or `error=…`). */
    async callback(c: RouteContext): Promise<Response> {
      const nonce = getCookie(c, STATE_COOKIE);
      // Single use: whatever happens next, this browser's state is spent.
      deleteCookie(c, STATE_COOKIE, { path: '/api/calendar/', secure: deps.secure });
      const calendar = deps.calendar;
      const payload =
        calendar === undefined ? undefined : verifyValue(calendar.stateKey, STATE_VERSION, c.req.query('state'));
      const slug = typeof payload?.w === 'string' && SLUG.test(payload.w) ? payload.w : undefined;
      const sameBrowser =
        nonce !== undefined &&
        typeof payload?.n === 'string' &&
        payload.n.length === nonce.length &&
        timingSafeEqual(Buffer.from(payload.n), Buffer.from(nonce));
      if (calendar === undefined) return c.redirect(settingsUrl(deps.appUrl, slug, 'off'));
      if (payload === undefined || slug === undefined || !sameBrowser || typeof payload.m !== 'string') {
        log.warn('calendar.connect.refused', { requestId: c.get('requestId'), reason: 'state' });
        return c.redirect(settingsUrl(deps.appUrl, slug, 'failed'));
      }
      // The member said no on Google's screen.
      if (c.req.query('error') !== undefined) return c.redirect(settingsUrl(deps.appUrl, slug, 'denied'));
      const code = c.req.query('code');
      if (code === undefined || code.length > 2048) return c.redirect(settingsUrl(deps.appUrl, slug, 'failed'));
      const member = await memberIn(deps, c, slug);
      // Signed out meanwhile, or now someone else: the state was for the member who started.
      if (member === undefined || member.scope.actor.id !== payload.m) {
        log.warn('calendar.connect.refused', { requestId: c.get('requestId'), reason: 'member' });
        return c.redirect(settingsUrl(deps.appUrl, slug, 'failed'));
      }
      let result: ConnectResult = 'connected';
      try {
        const exchanged = await calendar.providers.google.exchangeCode(code, calendar.redirectUri);
        await commitWrite(
          { wakeRelay: deps.wakeRelay, analytics: deps.analytics, user: { id: member.userId } },
          { mutationId: crypto.randomUUID() },
          (hooks) =>
            connectCalendar(member.scope, { provider: 'google', exchanged, tokenKey: calendar.tokenKey }, hooks),
        );
      } catch (error) {
        if (isProviderError(error)) {
          result = error.code === 'CALENDAR_SCOPE_DECLINED' ? 'scope' : 'failed';
          log.warn('calendar.connect.failed', { requestId: c.get('requestId'), code: error.code });
        } else if (isRefusal(error) && error.refusal.code === 'LIMIT_REACHED') {
          result = 'limit';
        } else {
          log.error('calendar.connect.failed', { requestId: c.get('requestId'), ...errorFields(error) });
          result = 'failed';
        }
      }
      return c.redirect(settingsUrl(deps.appUrl, slug, result));
    },
  };
}
