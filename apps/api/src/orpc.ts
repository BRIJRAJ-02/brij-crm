// The procedure bases (spec 0005, the access door). Every procedure is built
// on one of three:
// - `pub`: anyone (the status check);
// - `authed`: a signed in person (`context.user`), else 401 UNAUTHENTICATED;
// - `member`: `authed` plus the access door for the input's `workspace`
//   (`context.scope`), else the same NOT_FOUND for a non member, a removed
//   member and an unknown address.
// Only `enterWorkspace` in packages/core builds a member's scope; nothing in
// this app builds one. A `member` handler sees `context.scope` and neither
// `context.db` nor `context.identity`, so the door is its only way to the data. The contract walking
// test fails if a procedure outside the bootstrap list isn't built on `member`.
import { type AppEnvironment, contract, WorkspaceScoped } from '@crm/contracts';
import { enterWorkspace, type BookingCalendar, type JobRegistry, type ManageLinkKey, type RuleSource } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { implement, os } from '@orpc/server';
import type { ResponseHeadersPluginContext } from '@orpc/server/plugins';
import type { Auth, SessionUser } from './auth/auth.ts';
import type { CalendarServices } from './calendar/services.ts';
import type { Mailer } from './mail/mailer.ts';
import { apiError } from './errors.ts';
import { log } from './log.ts';
import type { ReadGate } from './gate.ts';
import type { Analytics } from './monitoring/posthog.ts';
import { setRequestScope } from './monitoring/sentry.ts';
import type { SignedOutNotice } from './realtime/signed-out.ts';
import type { RealtimeTokens } from './realtime/tokens.ts';
import type { WakeRelay } from './realtime/wake.ts';

/** What every procedure receives. */
export interface RequestContext extends ResponseHeadersPluginContext {
  db: Database;
  /** Global identity: the directory and users. */
  identity: IdentityStore;
  /** Sign in: sessions and the configured providers. */
  auth: Auth;
  /**
   * Pokes the worker's relay (spec 0005). A write procedure calls it once its
   * engine call has resolved, so the write committed: see `realtime/wake.ts`.
   */
  wakeRelay: WakeRelay;
  /**
   * The same call at most once a minute per api process (spec 0008): every
   * signed in request sends it, so the worker sleeps only when nobody uses
   * the app.
   */
  wakeOnUse: WakeRelay;
  /**
   * The wake a read of an overdue job sends (spec 0008): at most once every
   * 10 seconds per api process, so polling a backlog never keeps the worker
   * from sleeping or resets the relay's poll on every call.
   */
  wakeOverdue: WakeRelay;
  /** Product events (spec 0010): a write sends the milestones it reached once it commits (`hooks.ts`). */
  analytics: Analytics;
  environment: AppEnvironment;
  /** Whether `system.testFault` is switched on (`MONITORING_TEST_FAULT=on`, spec 0010). */
  testFault: boolean;
  /** This request's id, also sent back as `x-request-id`; every log line about the request carries it. */
  requestId: string;
  /** The caller's IP, only when the edge guard trusted the request (see `edge.ts`). */
  clientIp: string | undefined;
  /** The request's headers, for the session cookie. */
  headers: Headers;
  /** This process's cap on heavy reads in flight per workspace (`records.query` and `records.count`). */
  readGate: ReadGate;
  /** Signs Centrifugo's tokens (spec 0005), or undefined where live updates are off (no `CENTRIFUGO_TOKEN_SECRET`). */
  realtime: RealtimeTokens | undefined;
  /** Where the door reads the workspace's rules (spec 0009): `APP_RULES` (none until #24) outside tests. */
  rules: RuleSource;
  /** The job kinds this API knows (spec 0008): the test kind only locally and in previews. */
  jobs: JobRegistry;
  /** Calendar sync (spec 0024): its provider and keys where `CALENDAR_SYNC=on`, else undefined. */
  calendar: CalendarServices | undefined;
  /** Whether an email domain is a free one (gmail.com), which names no company (spec 0024, AC-607). */
  isFreeDomain: (domain: string) => boolean;
  /** Where a booking's event goes (the host's calendar, or nowhere without sync): Book someone in (spec 0027). */
  bookingCalendar: BookingCalendar;
  /** The key a booking's guest page token derives from (`booking-link.ts`): Book someone in, Copy guest link. */
  bookingLinkKey: ManageLinkKey;
  /** The one way to send email (spec 0005): invitations (spec 0031) go through it. */
  mailer: Mailer;
  /** The app's own address (`APP_URL`): an invitation's link is `<appUrl>/invite/<token>`. */
  appUrl: string;
  /**
   * The cross instance limiter (`auth.rate_limit`, through the identity
   * store), and only that piece of identity, so a member handler can limit
   * invitation sends per workspace and per inviter (spec 0031, AC-808).
   */
  limiter: Pick<IdentityStore, 'consumeRateLimit'>;
  /**
   * Whether `email` may start a workspace of its own: an address on
   * `SIGNUP_ALLOWLIST` (anyone while the list is open). An account an email
   * invitation let past a closed list joins the workspace that invited it and
   * starts none (spec 0031, owner decision 3), so an invitation can't make
   * more senders of invitations.
   */
  mayStartWorkspace: (email: string) => boolean;
  /**
   * Cuts a person's live connections after one of their sessions was signed
   * out from another device (spec 0033): the worker closes them with 4501.
   */
  signedOut: SignedOutNotice;
}

/** What `authed` adds: the signed in person, and which of their sessions this request carries (its id only). */
export interface SessionContext {
  user: SessionUser;
  sessionId: string;
}

export const base = implement(contract).$context<RequestContext>();

/** Procedures anyone may call. */
export const pub = base;

/**
 * Background renewals, not someone using the app: Centrifugo renews its
 * tokens from any open tab (every hour), and a renewal that woke the worker
 * would keep Neon's compute awake for a tab nobody uses.
 */
const NOT_USE: ReadonlySet<string> = new Set(['realtime.connectionToken', 'realtime.subscriptionToken']);

/** Puts the signed in person in `context.user`, or refuses UNAUTHENTICATED. A renewed session cookie goes back out. */
export const requireSession = os.$context<RequestContext>().middleware(async ({ context, next, path }) => {
  const session = await context.auth.session(context.headers, context.clientIp);
  if (session === undefined) throw apiError('UNAUTHENTICATED', 'Sign in to continue.');
  // An error report from here on names the user, by id only.
  setRequestScope({ userId: session.user.id });
  for (const cookie of session.setCookies) context.resHeaders?.append('set-cookie', cookie);
  // Someone is using the app: the worker stays awake, or wakes (at most once a minute; it never slows the request).
  if (!NOT_USE.has(path.join('.'))) context.wakeOnUse();
  return next({ context: { user: session.user, sessionId: session.sessionId } });
});

/**
 * What a `member` handler holds for `context.db` and `context.identity`:
 * nothing at run time, and `never` in the type (oRPC lets a middleware narrow
 * a context field, never widen it), so reading anything off either doesn't
 * compile. Global identity (sessions, the directory, every user) is no member
 * handler's business; one that needs a piece of it gets a narrow interface.
 */
const TAKEN_AWAY = undefined as never;

/**
 * What the member door opens with: the tenant database, the directory, the
 * log and the request's rules (`APP_RULES` outside tests). `requireMember`
 * opens with it, and so does the one bootstrap service that passes the door
 * itself inside packages/core (`me.setLastWorkspace`, spec 0031), so both
 * open with the same rules.
 */
export function memberDoor(context: Pick<RequestContext, 'db' | 'identity' | 'rules'>) {
  return { db: context.db, identity: context.identity, log, rules: context.rules };
}

/**
 * The access door for a workspace procedure: reads `workspace` (its address)
 * from the input and puts the scope `enterWorkspace` returns in
 * `context.scope`. A non member, a removed member and an unknown address all
 * get the same NOT_FOUND. It takes `context.db` and `context.identity` away
 * (see `TAKEN_AWAY`), so a handler behind it reaches data only through its
 * scope.
 */
export const requireMember = os
  .$context<RequestContext & SessionContext>()
  .middleware(async ({ context, next }, input: unknown) => {
    const scoped = WorkspaceScoped.safeParse(input);
    if (!scoped.success) {
      throw apiError('INPUT_INVALID', 'Some of the input is invalid.', {
        issues: [{ path: ['workspace'], message: 'Name the workspace by its address.' }],
      });
    }
    const scope = await enterWorkspace(memberDoor(context), {
      userId: context.user.id,
      slug: scoped.data.workspace,
    });
    // An error report from here on names the workspace the door let them into.
    setRequestScope({ workspaceId: scope.workspaceId });
    return next({ context: { scope, db: TAKEN_AWAY, identity: TAKEN_AWAY } });
  });

/** Procedures for a signed in person, before any workspace (the bootstrap list). */
export const authed = base.use(requireSession);

/** Procedures inside a workspace: a session and an active member row there. */
export const member = authed.use(requireMember);
