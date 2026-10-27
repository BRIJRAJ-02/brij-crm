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
import {
  enterWorkspace,
  type BookingCalendar,
  type CalendarEvents,
  type HomeMetricsCache,
  type DoorSession,
  type JobRegistry,
  type ManageLinkKey,
  type RuleSource,
} from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import type { WalletKind } from '@crm/contracts/brand';
import type { WalletLinkMaker } from './wallet/wallet.ts';
import { implement, os } from '@orpc/server';
import type { ResponseHeadersPluginContext } from '@orpc/server/plugins';
import type { Auth, SessionUser } from './auth/auth.ts';
import { doorSession } from './auth/door-session.ts';
import type { CalendarServices } from './calendar/services.ts';
import type { Mailer } from './mail/mailer.ts';
import { apiError, inputProblems } from './errors.ts';
import { log } from './log.ts';
import type { OutsideFetch } from './public/outside.ts';
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
  /**
   * Keeps the process alive until work started after the answer settles
   * (`waitUntil` on Vercel, spec 0045; on a long running server it just runs).
   * Anything a procedure doesn't await, such as an email, goes through it.
   */
  keepAlive: (work: Promise<unknown>) => void;
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
  /**
   * Free and busy and the event writes over the connected calendars (spec 0024), where sync is on: the one kept
   * answer per member and range, forgotten when a member changes a conflict switch or their destination (AC-994).
   */
  calendarEvents: CalendarEvents | undefined;
  /** Whether an email domain is a free one (gmail.com), which names no company (spec 0024, AC-607). */
  isFreeDomain: (domain: string) => boolean;
  /** Where a booking's event goes (the host's calendar, or nowhere without sync): Book someone in (spec 0027). */
  bookingCalendar: BookingCalendar;
  /** Home's metrics (spec 0041): each workspace's figures, kept a minute per workspace and week in this process. */
  homeMetrics: HomeMetricsCache;
  /** The key a booking's guest page token derives from (`booking-link.ts`): Book someone in, Copy guest link. */
  bookingLinkKey: ManageLinkKey;
  /** The one way to send email (spec 0005): invitations (spec 0031) go through it. */
  mailer: Mailer;
  /**
   * The one read of an address somebody typed (spec 0055, AC-5531), bounded in `public/outside.ts`. Bringing a
   * link in bio page across is its one caller here; anything else that needs an outside page takes it from here
   * too, rather than calling the network itself.
   */
  outsideFetch: OutsideFetch;
  /** The app's own address (`APP_URL`): an invitation's link is `<appUrl>/invite/<token>`. */
  appUrl: string;
  /**
   * Our own public origins (the app's, the forms' and the booking pages'): an address on one of them that names a
   * booking page, form or handle may only name one of the writer's own workspace (spec 0056, AC-5610).
   */
  publicOrigins: readonly string[];
  /** Where handle pages are served (`BOOKING_PUBLIC_ORIGIN`, else the app's): a link page's address in an email. */
  bookingOrigin: string;
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
   * The directory's writes a member handler needs (spec 0031), each after
   * its tenant change commits: forgetting that a removed person is in this
   * workspace, so their switcher stops listing it, and a workspace's renamed
   * label and deleted mark (slice 7). Access never reads the directory.
   */
  directory: Pick<IdentityStore, 'dropMembership' | 'renameWorkspace' | 'setWorkspaceDeleted'>;
  /**
   * Cuts a person's live connections after one of their sessions was signed
   * out from another device (spec 0033): the worker closes them with 4501.
   */
  signedOut: SignedOutNotice;
  /**
   * Takes a person's uploaded picture off their account and out of the private store (27 Oct 2026), for their
   * account's deletion. Absent in tests that never upload.
   */
  forgetPicture?: (userId: string) => Promise<boolean>;
  /**
   * Second factors and session proofs, by user and session id only (spec 0033,
   * milestone 4): a workspace's security settings count members without a
   * second factor, the Members page shows who has one to owners and admins,
   * and "Sign out everyone" keeps its caller's own session. Kept for member
   * handlers, unlike `identity`.
   */
  factors: Pick<IdentityStore, 'secondFactorUsers' | 'sessionVerification' | 'markSessionVerified'>;
  /**
   * Whether a person has Google linked (23 Oct 2026), for Settings › Profile's Sync Google photo: a member handler
   * asks it for the caller's own user id only. Reads no token.
   */
  googleLinked: (userId: string) => Promise<boolean>;
  /**
   * Makes a save link for one wallet (26 Oct 2026), or undefined for a wallet this environment has no credentials
   * for. The pass holds only what the caller's own page already shows; the handler reads that and hands it over.
   */
  walletLink: (wallet: WalletKind) => WalletLinkMaker | undefined;
  /**
   * The names of the workspaces a person is in that require two factor (spec
   * 0033, AC-885): Account › Sign in and devices says so, and keeps their last second
   * factor on. A system read per workspace, in packages/core.
   */
  requiredBy: (userId: string) => Promise<readonly string[]>;
  /** The super admins (spec 0047, AC-1617): whether a signed in person is on `OPERATOR_EMAILS`, by verified email. */
  operators: OperatorList;
  /**
   * Notes that a signed in person used the app today (spec 0047, AC-1624): at
   * most once per person every 10 minutes in this process, never awaited, a
   * failure logged and dropped.
   */
  noteActivity: (userId: string) => void;
}

/** Who the console counts a super admin: a verified email on the list. Never a workspace role. */
export interface OperatorList {
  readonly isListed: (user: { readonly email: string; readonly emailVerified: boolean }) => boolean;
}

/** The list from `OPERATOR_EMAILS` (already lowercased by the env schema): empty or unset, nobody. */
export function operatorList(emails: readonly string[] | undefined): OperatorList {
  const listed = new Set(emails ?? []);
  return { isListed: (user) => user.emailVerified && listed.has(user.email.toLowerCase()) };
}

/** What `authed` adds: the signed in person, and which of their sessions this request carries (its id only). */
export interface SessionContext {
  user: SessionUser;
  sessionId: string;
  /** What the access door asks of this session: its last proof, and whether its person has a second factor. */
  doorSession: DoorSession;
  /** How this session last proved itself: the operator console asks for a second factor (spec 0047). */
  verifiedWith: 'email' | 'second_factor';
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
  if (!NOT_USE.has(path.join('.'))) {
    context.wakeOnUse();
    // And the console's "last active" (spec 0047): today's row, at most every 10 minutes per person here.
    context.noteActivity(session.user.id);
  }
  return next({
    context: {
      user: session.user,
      sessionId: session.sessionId,
      doorSession: doorSession(session),
      verifiedWith: session.verifiedWith ?? 'email',
    },
  });
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
      const { message, issues } = inputProblems([
        { path: ['workspace'], message: 'Name the workspace by its address.' },
      ]);
      throw apiError('INPUT_INVALID', message, { issues });
    }
    const scope = await enterWorkspace(memberDoor(context), {
      userId: context.user.id,
      slug: scoped.data.workspace,
      session: context.doorSession,
    });
    // An error report from here on names the workspace the door let them into.
    setRequestScope({ workspaceId: scope.workspaceId });
    return next({ context: { scope, db: TAKEN_AWAY, identity: TAKEN_AWAY } });
  });

/** How recently a super admin's session must have proved itself (spec 0047, AC-1618). */
export const OPERATOR_FRESH_MS = 12 * 60 * 60 * 1000;

/** The id an operator read names, when it names one: the person or the booking page. */
function operatorTarget(input: unknown): { readonly target?: string; readonly period?: string; readonly q?: string } {
  if (typeof input !== 'object' || input === null) return {};
  const fields = input as Record<string, unknown>;
  const target = [fields['userId'], fields['pageId']].find((value) => typeof value === 'string');
  const period = fields['period'];
  const q = fields['q'];
  return {
    ...(typeof target === 'string' && UUID.test(target) ? { target } : {}),
    ...(typeof period === 'string' && /^(7|30|90)d$/.test(period) ? { period } : {}),
    // Who looked whom up: the users list's search, as typed (the contract caps it at 100).
    ...(typeof q === 'string' && q.trim() !== '' ? { q: q.trim().slice(0, 100) } : {}),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The operator gate (spec 0047): a person on `OPERATOR_EMAILS` with a
 * verified email, else NOT_FOUND, as for a procedure that doesn't exist;
 * then two factor on (TWO_FACTOR_REQUIRED) and this session proven with it
 * within 12 hours, at sign in or by a step up (SIGN_IN_AGAIN). Each read is written to `auth.operator_event`
 * before it runs, and fails if that write fails (AC-1620).
 */
export const requireOperator = os
  .$context<RequestContext & SessionContext>()
  .middleware(async ({ context, next, path }, input: unknown) => {
    if (!context.operators.isListed(context.user)) throw apiError('NOT_FOUND', 'There is nothing at this address.');
    if (!(await context.doorSession.hasSecondFactor())) {
      throw apiError(
        'TWO_FACTOR_REQUIRED',
        'Turn on two factor in Account, Sign in and devices, to open the super admin pages.',
      );
    }
    // Proven with the app within 12 hours: a remembered device, or an email code step up, isn't enough here.
    if (
      context.verifiedWith !== 'second_factor' ||
      Date.now() - context.doorSession.verifiedAt.getTime() > OPERATOR_FRESH_MS
    ) {
      throw apiError('SIGN_IN_AGAIN', 'Confirm it’s you with your authenticator app to open the super admin pages.');
    }
    await context.identity.logOperatorEvent({
      userId: context.user.id,
      action: path.join('.'),
      requestId: context.requestId,
      ...operatorTarget(input),
    });
    return next();
  });

/** Procedures for a signed in person, before any workspace (the bootstrap list). */
export const authed = base.use(requireSession);

/** Procedures inside a workspace: a session and an active member row there. */
export const member = authed.use(requireMember);

/** The operator console's procedures (spec 0047): a session that passes the operator gate. */
export const operator = authed.use(requireOperator);
