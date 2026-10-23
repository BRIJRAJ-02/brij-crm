// Sign in (spec 0005): Better Auth, in its one wrapper. Email codes and
// (where configured) Google, sessions in the `auth` schema through the
// identity store, the sign up allowlist, and rate limits that hold across
// instances. Nothing outside this folder imports Better Auth; the rest of the
// API sees only `Auth`.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import {
  EmailValue,
  emailDomain,
  errorStatus,
  requiresTwoFactorMessage,
  type SignInMethod,
  type SignInProviders,
} from '@crm/contracts';
import { renderSignInAlert, renderSignInCode, SIGN_IN_CODE_MINUTES } from '@crm/emails';
import type { SignUpMethod } from '@crm/contracts/events';
import type { IdentityStore, SecurityEventInput } from '@crm/db';
import { betterAuth, type DBAdapter } from 'better-auth';
import {
  addOAuthServerContext,
  APIError,
  createAuthMiddleware,
  getOAuthState,
  getSessionFromCtx,
} from 'better-auth/api';
import { deleteSessionCookie, expireCookie } from 'better-auth/cookies';
import { generateRandomString, symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { twoFactor } from 'better-auth/plugins/two-factor';
import * as z from 'zod';
import {
  alertNewDevice,
  deviceLabel,
  FRESH_MESSAGE,
  SECOND_FACTOR_MESSAGE,
  servedPicture,
  sessionFreshness,
  sweepAccountHistory,
} from '@crm/core';
import type { ApiEnv } from '../env.ts';
import { GEO_CITY_HEADER, GEO_COUNTRY_HEADER, readGeo, type Geo } from '../edge.ts';
import { log } from '../log.ts';
import type { Mailer } from '../mail/mailer.ts';
import { type Analytics, NO_ANALYTICS } from '../monitoring/posthog.ts';
import { captureFault } from '../monitoring/sentry.ts';
import { scrubText } from '@crm/contracts/monitoring';
import { createAllowlist } from './allowlist.ts';
import { authErrorResponse } from './errors.ts';
import {
  type GooglePhotoResult,
  isProfileReturn,
  LINK_SOCIAL_PATH,
  LinkGoogleBody,
  linkFailure,
  PHOTO_PURPOSE,
  profileWithResult,
} from './google-photo.ts';
import {
  BACKUP_CODE_COUNT,
  SECOND_STEP_FAILURES,
  SECOND_STEP_LOCK_SECONDS,
  SECOND_STEP_PATH,
  SECOND_STEP_SECONDS,
  stripTokens,
  totpMatches,
  PENDING_COOKIE,
  pendingPicture,
  pendingPictureId,
  pendingPictureValue,
  TRUST_DEVICE_COOKIE,
  TRUST_DEVICE_SECONDS,
  trustToken,
  TWO_FACTOR_DISABLED_PATHS,
  TWO_FACTOR_ROUTES,
} from './two-factor.ts';

/** Where Better Auth's own routes live, beside `/api/rpc`. */
export const AUTH_BASE_PATH = '/api/auth';

/** The route that sends a code. */
export const SEND_CODE_PATH = '/email-otp/send-verification-otp';
/** The route that signs in with a code. */
export const SIGN_IN_CODE_PATH = '/sign-in/email-otp';

/** Code sends per email (a mistyped email and the 60 second resend wait can't lock anyone out for long). */
export const CODE_SENDS_PER_EMAIL = { window: 600, max: 5 } as const;
/** Code sends per client IP. */
export const CODE_SENDS_PER_IP = { window: 600, max: 10 } as const;
/** Sign in attempts (code checks, Google) per client IP. Each code also allows only 5 wrong tries. */
export const SIGN_INS_PER_IP = { window: 60, max: 5 } as const;
/** Second step and two factor setup tries per client IP (each pending sign in also allows only 5 wrong codes). */
export const TWO_FACTOR_PER_IP = { window: 60, max: 10 } as const;
/**
 * Code checks per email in an hour, and in a day, whatever the IP: each new
 * code gets 5 tries, so without these, sending codes again and again would
 * give a guesser unlimited tries at one account.
 */
export const CODE_CHECKS_PER_EMAIL_HOUR = { window: 60 * 60, max: 15 } as const;
/** Code checks per email in a day (see `CODE_CHECKS_PER_EMAIL_HOUR`). */
export const CODE_CHECKS_PER_EMAIL_DAY = { window: 24 * 60 * 60, max: 40 } as const;
/**
 * Every other Better Auth route per client IP (the session read, Google's
 * callback, sign out). Its window is also the longest one Better Auth knows
 * of, which is how long it keeps its rate limit rows, so it must be at least
 * the longest per IP window above.
 */
export const OTHER_AUTH_ROUTES_PER_IP = { window: 600, max: 600 } as const;

/** A fixed window limit, as Better Auth's limiter takes it. */
interface Rule {
  readonly window: number;
  readonly max: number;
}

/**
 * A per IP rule that applies only to a request carrying a trusted client IP
 * (see `forwardedHeaders`, which sets the header only to a valid IP). Without
 * one, Better Auth would key every caller on one shared
 * `no-trusted-ip|<path>` bucket, and one caller could use up everyone's sign
 * ins; so there is no per IP limit then, and the per email limits still hold.
 * `rule` undefined keeps the rule Better Auth resolved.
 */
function perTrustedIp(rule?: Rule) {
  return (request: Request, current: Rule): false | Rule => {
    if (!request.headers.has('x-forwarded-for')) return false;
    return rule === undefined ? { window: current.window, max: current.max } : { window: rule.window, max: rule.max };
  };
}

const DAY_SECONDS = 24 * 60 * 60;

/**
 * The only Better Auth routes the API serves (after `AUTH_BASE_PATH`): send a
 * code, sign in by code, Google's sign in and its callback, sign out, the
 * session read, and two factor's setup, turning off, new backup codes and the
 * second step (spec 0033, AC-900). Sign out deletes its own session, so the
 * revoke routes stay shut. Passkeys were taken out on 22 October 2026, so the
 * passkey plugin's routes are gone with it. Linking Google (23 October 2026)
 * serves Profile's Sync Google photo only: Google, back to Profile, nothing
 * else it takes. Everything else Better Auth offers (changing the user,
 * listing or revoking sessions, listing or unlinking accounts, the email
 * second factor) answers 404, so a route we never reviewed can't be reached.
 */
export const AUTH_ROUTES: ReadonlySet<string> = new Set([
  SEND_CODE_PATH,
  SIGN_IN_CODE_PATH,
  '/sign-in/social',
  '/callback/google',
  '/sign-out',
  '/get-session',
  LINK_SOCIAL_PATH,
  ...TWO_FACTOR_ROUTES,
]);

/** The callback route as Better Auth's hooks name it (every provider's). */
const CALLBACK_ROUTE = '/callback/:id';

/** The web app's address on a laptop (Vite), trusted only when the API runs locally. */
const LOCAL_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/**
 * Better Auth routes this app never uses: passwords don't exist, the email
 * never changes by code, and a sign in code is checked only by signing in.
 */
const DISABLED_PATHS = [
  '/email-otp/check-verification-otp',
  '/email-otp/verify-email',
  '/email-otp/request-password-reset',
  '/email-otp/reset-password',
  '/forget-password/email-otp',
  '/email-otp/request-email-change',
  '/email-otp/change-email',
  ...TWO_FACTOR_DISABLED_PATHS,
];

/** The signed in person, as their session says. */
export interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  /** The account's picture as stored (Google's): a raw outside URL, served only through `/api/me/picture`. */
  readonly image?: string;
}

/** A live session's user, and any cookies to send back (a session extended on use renews its cookie). */
export interface AuthSession {
  /** The session's id, never its token: `account.sessions.*` mark "This device" by it (spec 0033). */
  readonly sessionId: string;
  readonly user: SessionUser;
  readonly setCookies: readonly string[];
  /**
   * When this session last proved who it is (its sign in, or a step up since),
   * for a workspace's session length and "Sign out everyone" (spec 0033,
   * milestone 4). A session older than the field reads as its creation.
   */
  readonly verifiedAt: Date;
  /** Whether the person has the authenticator app on, their one second factor. */
  readonly twoFactorEnabled: boolean;
}

/** Sign in, as the rest of the API sees it. */
export interface Auth {
  /** The sign in methods offered beyond the email code. */
  readonly providers: SignInProviders;
  /** Waits for the work a sign in starts after answering (the new device alert, the history sweep): for tests. */
  settled(): Promise<void>;
  /**
   * Answers a request to `/api/auth/*`. `clientIp` is the IP the edge guard
   * trusted, or undefined; any `x-forwarded-for` the caller sent is replaced
   * by it, or dropped, so rate limits never key on a forged address. `geo` is
   * where the edge guard trusted the request came from, the same way (spec
   * 0033): a new session keeps it. Refusals leave as `{ code, message }`.
   */
  handle(request: Request, clientIp: string | undefined, origin?: string, geo?: Geo): Promise<Response>;
  /** The session the request's cookie names, or undefined when there is none or it expired. */
  session(headers: Headers, clientIp: string | undefined): Promise<AuthSession | undefined>;
  /**
   * Checks an app code, or uses up a backup code, for a step up (spec 0033,
   * AC-896). False for a wrong code or no two factor; never throws for one.
   */
  checkSecondFactor(userId: string, method: 'totp' | 'backup', code: string): Promise<boolean>;
  /** How many unused backup codes the person has, or undefined without two factor. */
  backupCodesLeft(userId: string): Promise<number | undefined>;
  /** A step up email code as kept: keyed with the server's secret, so the table never yields a code. */
  hashStepUpCode(code: string): string;
}

/** What sign in needs: the environment, the identity store (its database), and a mailer for codes. */
export interface AuthDeps {
  readonly env: ApiEnv;
  readonly identity: IdentityStore;
  readonly mailer: Mailer;
  /** Where `user_signed_up` goes (spec 0010, AC-174); absent, nothing is sent. */
  readonly analytics?: Analytics;
  /**
   * Whether an open email invitation names this address (spec 0031, owner
   * decision 3, AC-807): such an address may sign up though it isn't on
   * `SIGNUP_ALLOWLIST`. Absent, only the list decides.
   */
  readonly invited?: (email: string) => Promise<boolean>;
  /**
   * The names of the workspaces this person is in that require two factor
   * (spec 0033, AC-885): while any does, the authenticator app can't be turned
   * off. Always named, so no sign in is built without it.
   */
  readonly requiredBy: (userId: string) => Promise<readonly string[]>;
  /**
   * Keeps the process alive until the work a sign in starts after answering
   * settles (the new device alert, the history sweep): Vercel's `waitUntil`
   * (spec 0045). Absent, as on a long running server, the work runs on.
   */
  readonly keepAlive?: (work: Promise<unknown>) => void;
}

/**
 * How a new account was made, from the route that made it (spec 0010,
 * AC-174): the email code sign in, or Google (its callback, or a sign in
 * with Google's id token). Any other route makes no account today, so it
 * names no method and sends no event.
 */
export function signUpMethod(route: string | undefined): SignUpMethod | undefined {
  if (route === SIGN_IN_CODE_PATH) return 'email_code';
  // Google is the only social provider today, so '/callback/:id' (Better Auth's own name for every provider's
  // callback) and '/sign-in/social' map to it. Revisit this when a second provider is added: name the method by
  // the provider, and add it to `SignUpMethod` in the catalog first.
  if (route === '/callback/:id' || route === '/callback/google' || route === '/sign-in/social') return 'google';
  return undefined;
}

/**
 * The request headers Better Auth sees: `x-forwarded-for` holds exactly the
 * IP the edge guard trusted, or is absent. A forwarded chain never reaches it,
 * and nor does a value that isn't an IP: Better Auth would key that caller on
 * its one shared bucket, which `perTrustedIp` keeps shut only while the header
 * is absent.
 */
export function forwardedHeaders(headers: Headers, clientIp: string | undefined, origin?: string, geo?: Geo): Headers {
  const next = new Headers(headers);
  next.delete('x-forwarded-for');
  if (clientIp !== undefined && isIP(clientIp) !== 0) next.set('x-forwarded-for', clientIp);
  // The geo headers likewise: only what the edge guard trusted (spec 0033), never a caller's own.
  next.delete(GEO_COUNTRY_HEADER);
  next.delete(GEO_CITY_HEADER);
  if (geo?.country !== undefined) next.set(GEO_COUNTRY_HEADER, geo.country);
  if (geo?.city !== undefined) next.set(GEO_CITY_HEADER, encodeURIComponent(geo.city));
  // Better Auth checks the request's own origin; give it the one the edge guard read, and no other.
  if (origin === undefined) next.delete('origin');
  else next.set('origin', origin);
  return next;
}

/** The body of a route that names an email: the shared email schema (trimmed, lowercased, 254 at most). */
const EmailBody = z.looseObject({ email: EmailValue });
const SendCodeBody = z.object({ email: EmailValue, type: z.string() });
const SignInCodeBody = z.object({ email: EmailValue });

/** The routes whose body names an email, checked before Better Auth or its limiter sees them. */
const EMAIL_ROUTES: ReadonlySet<string> = new Set([SEND_CODE_PATH, SIGN_IN_CODE_PATH]);

/** The answer to a body without a valid email: 400 INPUT_INVALID, as every other refusal is shaped. */
function emailInvalid(message: string): Response {
  return Response.json({ code: 'INPUT_INVALID', message }, { status: errorStatus('INPUT_INVALID') });
}

/**
 * For the routes that take an email: the request with its email checked
 * against the shared schema and written back normalized, so the limits, the
 * code's lookup and the account all use one spelling; or a 400 INPUT_INVALID
 * answer. It runs before Better Auth, so a malformed or oversized email
 * reaches neither its rate limiter nor the database. Other routes pass as
 * they came.
 */
async function checkEmail(request: Request): Promise<Request | Response> {
  if (request.method !== 'POST') return request;
  if (!EMAIL_ROUTES.has(new URL(request.url).pathname.slice(AUTH_BASE_PATH.length))) return request;
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => undefined);
  const parsed = EmailBody.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues.find((found) => found.path[0] === 'email');
    return emailInvalid(
      issue === undefined || issue.code === 'invalid_type' ? 'Send an email address.' : issue.message,
    );
  }
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  return new Request(request, { headers, body: JSON.stringify(parsed.data) });
}

function rateLimited(message: string, retryAfterSeconds: number): APIError {
  return new APIError(
    'TOO_MANY_REQUESTS',
    { code: 'RATE_LIMITED', message },
    { 'retry-after': String(retryAfterSeconds) },
  );
}

/** Better Auth's social sign in route, which also takes a provider's id token in its body. */
const SOCIAL_SIGN_IN_PATH = '/sign-in/social';

/** Whether a social sign in body carries an id token (`{ idToken: … }`), which this app never sends. */
function hasIdToken(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'idToken' in body && body.idToken !== undefined;
}

function inputInvalid(): APIError {
  return new APIError('BAD_REQUEST', { code: 'INPUT_INVALID', message: 'Send an email address.' });
}

/**
 * Whether `email` has a sign in code that hasn't expired (Better Auth's
 * `sign-in-otp-<email>` verification). A plain count through its adapter:
 * `internalAdapter.findVerificationValue` would also delete every expired
 * row, turning an expired code's OTP_EXPIRED into INVALID_OTP.
 */
async function hasLiveCode(adapter: Pick<DBAdapter, 'count'>, email: string): Promise<boolean> {
  return isLiveVerification(adapter, `sign-in-otp-${email}`);
}

/** Whether a verification row named `identifier` is there and hasn't expired, without deleting anything. */
async function isLiveVerification(adapter: Pick<DBAdapter, 'count'>, identifier: string): Promise<boolean> {
  const live = await adapter.count({
    model: 'verification',
    where: [
      { field: 'identifier', value: identifier },
      { field: 'expiresAt', value: new Date(), operator: 'gt' },
    ],
  });
  return live > 0;
}

function signupClosed(): APIError {
  return new APIError('FORBIDDEN', { code: 'SIGNUP_CLOSED', message: "Sign up isn't open yet." });
}

/** An account whose email nobody has proven (Google saying it isn't verified) is never made. */
function emailUnverified(): APIError {
  return new APIError('FORBIDDEN', {
    code: 'EMAIL_UNVERIFIED',
    message: 'That email isn’t verified. Sign in with a code sent to it instead.',
  });
}

/**
 * Better Auth's own log lines, its message only (its arguments can carry
 * request data), scrubbed: it logs a failed query's raw message, which ends
 * in `\nparams: <values>` (session tokens, emails), so that and any email go.
 */
export function logLibrary(level: 'debug' | 'info' | 'success' | 'warn' | 'error', message: unknown): void {
  (level === 'error' ? log.error : log.warn)('Sign in library', { detail: libraryDetail(message) });
}

/**
 * A log message as safe text. Better Auth sometimes logs an Error object (its
 * session list route does), whose message may be drizzle's raw one, so only
 * its name goes; never `String(error)`.
 */
function libraryDetail(message: unknown): string {
  if (typeof message === 'string') return scrubText(message);
  if (message instanceof Error) return message.name;
  return typeof message;
}

/** How a session was made, from the route that made it (spec 0033's sign in events): undefined for any other. */
export function signInMethod(route: string | undefined): SignInMethod | undefined {
  const method = signUpMethod(route);
  return method === undefined ? undefined : method;
}

/** `{ [key]: value }` when `value` is a non empty string, else nothing: optional fields from Better Auth's loose rows. */
function presentText<K extends string>(key: K, value: unknown): { [P in K]?: string } {
  return typeof value === 'string' && value !== '' ? ({ [key]: value } as { [P in K]: string }) : {};
}

/** What enabling two factor may send: the app only (the email second factor is off), and never our issuer. */
const EnableBody = z.strictObject({ method: z.literal('totp').optional() });

/** The second step's routes: an app code or a backup code. */
const SECOND_STEP_ROUTES: ReadonlySet<string> = new Set(['/two-factor/verify-totp', '/two-factor/verify-backup-code']);

/** What a second step's backup code may send: the code, and whether to remember the device. */
const SecondStepBody = z.strictObject({ code: z.string().max(40), trustDevice: z.boolean().optional() });

/** A session's `verifiedAt` as the adapter hands it (a Date, or its text), else when the session was made. */
function verifiedAtOf(value: unknown, createdAt: Date): Date {
  const at = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined;
  return at === undefined || Number.isNaN(at.getTime()) ? new Date(createdAt) : at;
}

/** Whether a session's user has two factor on (the plugin's field on Better Auth's loose user). */
function isTwoFactorUser(user: unknown): boolean {
  return typeof user === 'object' && user !== null && 'twoFactorEnabled' in user && user.twoFactorEnabled === true;
}

/** Builds sign in for this environment. */
export function createAuth({
  env,
  identity,
  mailer,
  analytics = NO_ANALYTICS,
  invited,
  requiredBy,
  keepAlive,
}: AuthDeps): Auth {
  const local = env.APP_ENV === 'local';
  const allowlist = createAllowlist(env.APP_ENV, env.SIGNUP_ALLOWLIST);
  /** Whether a new account may be made for `email`: on the list, or holding an open email invitation (AC-807). */
  const mayJoin = async (email: string): Promise<boolean> =>
    allowlist.allows(email) || (invited !== undefined && (await invited(email)));
  // The picture Google's profile names in this request (23 Oct 2026): Better Auth stores it only when Google makes
  // the account, so one made with an email code and linked to Google later has none, and a picture changed at Google
  // never arrives. The two factor hold below saves it once the sign in stands (`savePicture`).
  const googlePictures = new AsyncLocalStorage<string[]>();
  const google =
    env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined
      ? {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          // Changes nothing Better Auth keeps: only notes the picture for this request.
          mapProfileToUser: (profile: { readonly picture?: unknown }) => {
            if (typeof profile.picture === 'string') googlePictures.getStore()?.push(profile.picture);
            return {};
          },
        }
      : undefined;
  const appOrigin = new URL(env.APP_URL).origin;

  async function sendCode({ email, otp }: { email: string; otp: string }): Promise<void> {
    // A failure answers the caller the same as success; the log never holds the address or the code.
    try {
      const message = await renderSignInCode(otp, { appOrigin });
      await mailer.send({ to: email, ...message });
      log.info('Sign in code sent', { mail: mailer.transport });
    } catch (error) {
      // Our mailers' messages name the service and the status, never the recipient.
      const failure = error instanceof Error ? { name: error.name, message: error.message } : { name: typeof error };
      log.error('Sign in code not sent', { mail: mailer.transport, error: failure });
      // Nobody can sign in while mail fails, though the answer says sent; scrub marks any address in the message.
      captureFault(error, { task: 'sign in mail' });
    }
  }

  // The sessions each request made (spec 0033, AC-897): checked for a new device after it answers, never in its way.
  const signedInThisRequest = new AsyncLocalStorage<{ userId: string; sessionId: string }[]>();
  const alertDeps = {
    identity,
    send: async (to: string, alert: { when: Date; device: string; place?: string }, sessionId: string) => {
      const message = await renderSignInAlert(alert, { appOrigin });
      // Once per session, however often this runs (the mailer passes the key on to Resend).
      await mailer.send({ to, ...message, idempotencyKey: `sign-in-alert/${sessionId}` });
      log.info('Sign in alert sent', { mail: mailer.transport });
    },
  };
  /** Checks each new session for a new device; a failure is logged and reported, never thrown. */
  async function alertAfter(made: readonly { userId: string; sessionId: string }[]): Promise<void> {
    for (const each of made) {
      try {
        await alertNewDevice(alertDeps, each);
      } catch (error) {
        log.error('Sign in alert not sent', { error: error instanceof Error ? error.name : typeof error });
        captureFault(error, { task: 'sign in alert' });
      }
    }
  }
  /** The picture Google's profile named in this request, when it is an account picture of Google's (allowlisted). */
  function notedPicture(userId: string): string | undefined {
    const picture = googlePictures.getStore()?.at(-1);
    return picture !== undefined && servedPicture(userId, picture) !== undefined ? picture : undefined;
  }
  /**
   * Saves a picture of Google's as the account's, when it has none or an older one of Google's (Google's picture
   * hosts, https only: `setUserImageFromGoogle`). Answers whether the account's picture is now that one: undefined
   * when saving failed, which is logged, never thrown.
   */
  async function applyPicture(userId: string, picture: string): Promise<boolean | undefined> {
    try {
      if (await identity.setUserImageFromGoogle(userId, picture)) {
        log.info('Account picture set from Google', {});
        return true;
      }
      return (await identity.userImage(userId)) === picture.trim();
    } catch (error) {
      log.warn('Account picture not set', { error: error instanceof Error ? error.name : typeof error });
      return undefined;
    }
  }
  /** Saves the picture Google named in this request: only for a sign in that stands, never one held back. */
  async function savePicture(userId: string): Promise<void> {
    const picture = notedPicture(userId);
    if (picture !== undefined) await applyPicture(userId, picture);
  }
  /** Profile's Sync Google photo, once Google is linked: how saving this request's picture went. */
  async function syncPicture(userId: string): Promise<GooglePhotoResult> {
    const picture = notedPicture(userId);
    if (picture === undefined) return 'none';
    const current = await applyPicture(userId, picture);
    return current === undefined ? 'failed' : current ? 'synced' : 'kept';
  }
  // The year old security history goes at most once a day per process, after a sign in (AC-898): no timer keeps
  // the database awake.
  let sweptAt = 0;
  async function sweepAfterSignIn(): Promise<void> {
    if (Date.now() - sweptAt < DAY_SECONDS * 1000) return;
    sweptAt = Date.now();
    try {
      const gone = await sweepAccountHistory({ identity });
      if (gone > 0) log.info('Old security history deleted', { rows: gone });
    } catch (error) {
      log.error('Security history not swept', { error: error instanceof Error ? error.name : typeof error });
    }
  }
  /** Settles after-answer work for tests: the alerts and sweep started by the last requests. */
  const pending = new Set<Promise<void>>();
  const track = (work: Promise<void>) => {
    keepAlive?.(work);
    pending.add(work);
    void work.finally(() => pending.delete(work));
  };

  /** Keeps a security event; a failure is logged and reported, never thrown into a sign in or out. */
  async function keepEvent(event: SecurityEventInput): Promise<void> {
    try {
      await identity.recordSecurityEvent(event);
    } catch (error) {
      log.error('Security event not kept', {
        kind: event.kind,
        error: error instanceof Error ? error.name : typeof error,
      });
      captureFault(error, { task: 'security event' });
    }
  }

  // Two factor sign in (spec 0033, milestone 2): an authenticator app and 10 backup codes, no passwords, the secret
  // and codes encrypted with BETTER_AUTH_SECRET (AC-886). The plugin's own locks count wrong codes per pending sign in
  // (5) and per account (15, then 15 minutes locked, AC-882).
  const twoFactorPlugin = twoFactor({
    issuer: 'Timefix',
    allowPasswordless: true,
    skipVerificationOnEnable: false,
    twoFactorCookieMaxAge: SECOND_STEP_SECONDS,
    trustDeviceMaxAge: TRUST_DEVICE_SECONDS,
    backupCodeOptions: { amount: BACKUP_CODE_COUNT, storeBackupCodes: 'encrypted' },
    accountLockout: {
      enabled: true,
      maxFailedAttempts: SECOND_STEP_FAILURES,
      durationSeconds: SECOND_STEP_LOCK_SECONDS,
    },
  });

  /** Refuses a two factor change unless this session proved who it is lately (AC-896), with a second factor when asked. */
  async function requireFreshSession(
    userId: string,
    sessionId: string,
    options: { readonly secondFactor?: boolean } = {},
  ): Promise<void> {
    const freshness = await sessionFreshness({ identity }, { userId, sessionId });
    if (freshness.freshUntil === undefined) {
      throw new APIError('FORBIDDEN', { code: 'STEP_UP_REQUIRED', message: FRESH_MESSAGE });
    }
    if (options.secondFactor === true && !freshness.withSecondFactor) {
      throw new APIError('FORBIDDEN', { code: 'SECOND_FACTOR_REQUIRED', message: SECOND_FACTOR_MESSAGE });
    }
  }

  /** The person's two factor row, as the plugin keeps it (encrypted), or undefined. */
  async function twoFactorRow(
    userId: string,
  ): Promise<
    | { readonly id: string; readonly secret: string; readonly backupCodes: string; readonly lockedUntil: Date | null }
    | undefined
  > {
    const context = await auth.$context;
    const row = await context.adapter.findOne<{
      id: string;
      secret: string;
      backupCodes: string;
      verified: boolean;
      lockedUntil: Date | null;
    }>({
      model: 'twoFactor',
      where: [{ field: 'userId', value: userId }],
    });
    return row === null || !row.verified ? undefined : row;
  }

  /** The backup codes still unused, decrypted, or undefined when they can't be read. */
  async function backupCodesOf(encrypted: string): Promise<readonly string[] | undefined> {
    const context = await auth.$context;
    try {
      const parsed: unknown = JSON.parse(await symmetricDecrypt({ key: context.secretConfig, data: encrypted }));
      return Array.isArray(parsed) && parsed.every((code) => typeof code === 'string') ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  const auth = betterAuth({
    appName: 'Timefix',
    baseURL: env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    database: identity.authDatabase(),
    trustedOrigins: [appOrigin, ...(env.TRUSTED_ORIGINS ?? []), ...(local ? LOCAL_ORIGINS : [])],
    telemetry: { enabled: false },
    disabledPaths: DISABLED_PATHS,
    session: {
      expiresIn: 30 * DAY_SECONDS,
      // Our own step up (`verified_at`, 10 minutes) guards sensitive routes; Better Auth's day long "fresh"
      // check would refuse a two factor change on any session older than a day, even right after a step up.
      freshAge: 0,
      updateAge: DAY_SECONDS,
      // Read every session from the database, so signing out or revoking takes effect at once.
      cookieCache: { enabled: false },
      // Where and on what it signed in, and when it last proved who it is (spec 0033). Set only by the hook below:
      // a caller can't send them (`input: false`).
      additionalFields: {
        country: { type: 'string', required: false, input: false },
        city: { type: 'string', required: false, input: false },
        deviceLabel: { type: 'string', required: false, input: false },
        verifiedAt: { type: 'date', required: false, input: false },
        verifiedWith: { type: 'string', required: false, input: false },
      },
    },
    account: {
      // Google joins an existing account only when Google says the email is verified.
      accountLinking: { enabled: true, updateUserInfoOnLink: false },
      encryptOAuthTokens: true,
    },
    ...(google === undefined ? {} : { socialProviders: { google } }),
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: OTHER_AUTH_ROUTES_PER_IP.window,
      max: OTHER_AUTH_ROUTES_PER_IP.max,
      // The first matching key wins, so the catch all comes last.
      customRules: {
        [SEND_CODE_PATH]: perTrustedIp(CODE_SENDS_PER_IP),
        '/sign-in/*': perTrustedIp(SIGN_INS_PER_IP),
        '/two-factor/*': perTrustedIp(TWO_FACTOR_PER_IP),
        [LINK_SOCIAL_PATH]: perTrustedIp(SIGN_INS_PER_IP),
        '/**': perTrustedIp(),
      },
    },
    advanced: {
      database: { generateId: 'uuid' },
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
      useSecureCookies: !local,
      // Host only (no Domain), HttpOnly, SameSite=Lax.
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
    // A refused Google sign in lands back on the sign in screen, which reads `?error=`.
    onAPIError: { errorURL: new URL('/sign-in', appOrigin).toString() },
    logger: {
      level: 'warn',
      // Its messages only: arguments can carry request data.
      log: logLibrary,
    },
    databaseHooks: {
      session: {
        create: {
          // Every new session (an email code, Google): what it is on, roughly where, and that it just proved who it
          // is (spec 0033). The headers are the ones `handle` rebuilt, so the geo pair is the edge guard's or none.
          before: (session, context) => {
            // Turning two factor on or off makes a new session in place of this one (the plugin's way to renew its
            // cookie): it keeps what the old one knew, and its sign in time stays its own.
            if (session.verifiedAt instanceof Date) return Promise.resolve({ data: session });
            const headers = context?.headers;
            const geo =
              headers === undefined
                ? undefined
                : readGeo(headers.get(GEO_COUNTRY_HEADER), headers.get(GEO_CITY_HEADER));
            const agent = typeof session.userAgent === 'string' ? session.userAgent : undefined;
            return Promise.resolve({
              data: {
                ...session,
                deviceLabel: deviceLabel(agent),
                country: geo?.country ?? null,
                city: geo?.city ?? null,
                verifiedAt: new Date(),
                // The second step of a sign in proves a second factor; an email code or Google alone, the email.
                verifiedWith: context?.path.startsWith('/two-factor/verify-') === true ? 'second_factor' : 'email',
              },
            });
          },
          // Kept in the account's security history (AC-898): how, on what, and roughly where. Never fails a sign in.
          after: async (session, context) => {
            // A session renewed in place by a two factor change is no new sign in.
            if (context?.context.session !== null && context?.context.session !== undefined) return;
            // Checked for a new device once the request has answered (AC-897), when a held back one is gone.
            signedInThisRequest.getStore()?.push({ userId: session.userId, sessionId: session.id });
            const method = signInMethod(context?.path);
            const secondFactor =
              context?.path === '/two-factor/verify-totp'
                ? 'totp'
                : context?.path === '/two-factor/verify-backup-code'
                  ? 'backup_code'
                  : undefined;
            await keepEvent({
              userId: session.userId,
              kind: 'sign_in',
              sessionId: session.id,
              ...presentText('ip', session.ipAddress),
              ...presentText('country', session.country),
              ...presentText('deviceLabel', session.deviceLabel),
              detail: {
                ...(method === undefined ? {} : { method }),
                ...(secondFactor === undefined ? {} : { secondFactor }),
                ...(typeof session.city === 'string' && session.city !== '' ? { city: session.city } : {}),
              },
            });
          },
        },
        delete: {
          // Signing out on the device itself; a revoke from Account › Sign in and devices keeps its own event.
          after: async (session, context) => {
            if (context?.path !== '/sign-out') return;
            await keepEvent({
              userId: session.userId,
              kind: 'sign_out',
              sessionId: session.id,
              ...presentText('ip', session.ipAddress),
              ...presentText('country', session.country),
              ...presentText('deviceLabel', session.deviceLabel),
            });
          },
        },
      },
      user: {
        create: {
          // Every way an account is made (a code, Google) passes here.
          before: async (user) => {
            if (!(await mayJoin(user.email))) throw signupClosed();
            // Every account starts from a proven email: a code proves it, and Google only when it says verified.
            // An unverified one could be someone else's address, waiting for its owner to sign in by code
            // (pre registration takeover), so it makes no account.
            // Typed boolean, but a provider's profile could carry the string "false": only true passes.
            const verified: unknown = user.emailVerified;
            if (verified !== true) throw emailUnverified();
          },
          // Once the account is written (Better Auth runs this after its transaction commits), and only for a new
          // one: signing in again creates no user. The user id only, never the email or name (AC-174).
          after: (user, context) => {
            const method = signUpMethod(context?.path);
            if (method === undefined) {
              log.warn('Sign up by a route that names no method; no product event', { analytics: 'skipped' });
            } else {
              analytics.capture({ event: 'user_signed_up', distinctId: user.id, properties: { method } });
            }
            return Promise.resolve();
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Google signs in only through its own page (the code flow, with state and PKCE). Better Auth would also
        // take a Google id token posted here; the app never sends one, so nothing reaches that path.
        if (ctx.path === SOCIAL_SIGN_IN_PATH && hasIdToken(ctx.body)) {
          throw new APIError('BAD_REQUEST', {
            code: 'INPUT_INVALID',
            message: 'Sign in with Google from its own page.',
          });
        }
        // Profile's Sync Google photo (23 Oct 2026): Google only, back to that Profile page either way, and none of
        // the rest linking takes. Its callback knows it by the mark in its state, which no caller can set.
        if (ctx.path === LINK_SOCIAL_PATH) {
          const body = LinkGoogleBody.safeParse(ctx.body ?? {});
          if (
            !body.success ||
            !isProfileReturn(body.data.callbackURL, appOrigin) ||
            body.data.errorCallbackURL !== body.data.callbackURL
          ) {
            throw new APIError('BAD_REQUEST', {
              code: 'INPUT_INVALID',
              message: 'Sync your Google photo from Settings › Profile.',
            });
          }
          // Whether Google was linked before, so a link this makes is kept in the security history. Signed out,
          // Better Auth's own session check refuses the route next.
          const current = await getSessionFromCtx(ctx);
          const wasLinked = current === null ? true : await identity.hasGoogleAccount(current.user.id);
          await addOAuthServerContext({
            [PHOTO_PURPOSE.key]: PHOTO_PURPOSE.value,
            [PHOTO_PURPOSE.wasLinked]: wasLinked,
          });
          return;
        }
        // Two factor's routes from a browser (spec 0033): setup and new codes need a recent check, turning off a
        // second factor's (AC-885, AC-896); the second step's routes are only for a sign in held back for one. A call
        // from our own code is held to the same rules.
        if (ctx.path.startsWith('/two-factor/')) {
          const current = await getSessionFromCtx(ctx);
          const owner = current === null ? undefined : { userId: current.user.id, sessionId: current.session.id };
          const signedIn = () => {
            if (owner === undefined) {
              throw new APIError('UNAUTHORIZED', { code: 'UNAUTHENTICATED', message: 'Sign in first.' });
            }
            return owner;
          };
          if (ctx.path === '/two-factor/enable') {
            const { userId, sessionId } = signedIn();
            // Only the app: the email second factor is off, and the issuer is ours.
            if (!EnableBody.safeParse(ctx.body ?? {}).success) throw inputInvalid();
            await requireFreshSession(userId, sessionId);
          } else if (ctx.path === '/two-factor/generate-backup-codes') {
            const { userId, sessionId } = signedIn();
            // New codes replace the old ones, so only a second factor may make them: an email code alone (on a
            // remembered device) must never turn into control of the second factor.
            await requireFreshSession(userId, sessionId, { secondFactor: true });
          } else if (ctx.path === '/two-factor/disable') {
            const { userId, sessionId } = signedIn();
            await requireFreshSession(userId, sessionId, { secondFactor: true });
            // A workspace that requires two factor keeps it on (AC-885).
            const names = await requiredBy(userId);
            if (names.length > 0) {
              throw new APIError('CONFLICT', {
                code: 'WORKSPACE_REQUIRES_TWO_FACTOR',
                message: requiresTwoFactorMessage(names),
              });
            }
          } else if (ctx.path === '/two-factor/verify-backup-code') {
            // A step up uses a backup code through `account.stepUp.verify`, never here; and a sign in's code always
            // makes its session (no `disableSession`), so a code is never used up unseen.
            if (owner !== undefined) {
              throw new APIError('BAD_REQUEST', { code: 'INPUT_INVALID', message: 'Backup codes are for signing in.' });
            }
            if (!SecondStepBody.safeParse(ctx.body ?? {}).success) throw inputInvalid();
          } else if (ctx.path === '/two-factor/verify-totp' && owner !== undefined) {
            // Signed in, this route only finishes setting the app up.
            const state = await identity.twoFactorState(owner.userId);
            if (state.enabled) {
              throw new APIError('BAD_REQUEST', {
                code: 'INPUT_INVALID',
                message: 'Two factor sign in is already on.',
              });
            }
          }
          return;
        }
        if (ctx.path === SIGN_IN_CODE_PATH) {
          const body = SignInCodeBody.safeParse(ctx.body);
          // `handle` refused a request like this already; a call from our own code gets the same answer.
          if (!body.success) throw inputInvalid();
          const { email } = body.data;
          // A try only counts against the email when there is something to guess: a live code, or an account.
          // Junk tries at an address with neither can't lock it out; Better Auth refuses them (INVALID_OTP) anyway.
          if (!(await hasLiveCode(ctx.context.adapter, email))) {
            if ((await ctx.context.internalAdapter.findUserByEmail(email)) === null) return;
          }
          const key = `email:${email}|${SIGN_IN_CODE_PATH}`;
          // Both windows count every try, so neither runs ahead of the other.
          const [hour, day] = await Promise.all([
            identity.consumeRateLimit(key, CODE_CHECKS_PER_EMAIL_HOUR),
            identity.consumeRateLimit(`${key}|day`, CODE_CHECKS_PER_EMAIL_DAY),
          ]);
          const refused = [hour, day].filter((limit) => !limit.allowed);
          if (refused.length > 0) {
            // Never the address: its domain says enough to spot an attack on one company.
            log.warn('Sign in tries capped for an email', {
              domain: emailDomain(email),
              hour: !hour.allowed,
              day: !day.allowed,
            });
            const wait = Math.max(
              ...refused.map((limit) => limit.retryAfterSeconds ?? CODE_CHECKS_PER_EMAIL_HOUR.window),
            );
            throw rateLimited('Too many sign in tries for this email. Wait a while, then send a new code.', wait);
          }
          return;
        }
        if (ctx.path !== SEND_CODE_PATH) return;
        const body = SendCodeBody.safeParse(ctx.body);
        // `handle` refused a request like this already; a call from our own code gets the same answer.
        if (!body.success) throw inputInvalid();
        if (body.data.type !== 'sign-in') {
          throw new APIError('BAD_REQUEST', { code: 'INPUT_INVALID', message: 'Only sign in codes are sent.' });
        }
        const { email } = body.data;
        const limit = await identity.consumeRateLimit(`email:${email}|${SEND_CODE_PATH}`, CODE_SENDS_PER_EMAIL);
        if (!limit.allowed) {
          throw rateLimited(
            'Too many codes were sent to this email. Wait a few minutes.',
            limit.retryAfterSeconds ?? CODE_SENDS_PER_EMAIL.window,
          );
        }
        // Before any email goes out: a new email off the list gets no code. An existing user always does.
        // An invited address (spec 0031, AC-807) gets its code too.
        if (
          !allowlist.allows(email) &&
          (await ctx.context.internalAdapter.findUserByEmail(email)) === null &&
          !(await mayJoin(email))
        ) {
          throw signupClosed();
        }
      }),
      // Two factor changes and backup code sign ins, kept in the account's security history (AC-898). Never a code.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.request === undefined || ctx.context.returned instanceof Error) return;
        if (!ctx.path.startsWith('/two-factor/')) return;
        const userId = ctx.context.newSession?.user.id ?? ctx.context.session?.user.id;
        if (userId === undefined) return;
        const sessionId = ctx.context.newSession?.session.id ?? ctx.context.session?.session.id;
        const event = (kind: SecurityEventInput['kind']) =>
          keepEvent({ userId, kind, ...(sessionId === undefined ? {} : { sessionId }) });
        if (ctx.path === '/two-factor/verify-totp' && ctx.context.session !== null) await event('two_factor_on');
        if (ctx.path === '/two-factor/generate-backup-codes') await event('backup_codes_made');
        if (ctx.path === '/two-factor/verify-backup-code') await event('backup_code_used');
        if (ctx.path === '/two-factor/disable') {
          // Off forgets every remembered device too (AC-884).
          await identity.forgetTrustedDevices(userId);
          await event('two_factor_off');
        }
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: SIGN_IN_CODE_MINUTES * 60,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        sendVerificationOTP: sendCode,
      }),
      twoFactorPlugin,
      {
        // The plugin holds a session back only on password sign ins; this app signs in by email code and Google, so
        // the same hold runs after those (spec 0033's milestone 2 spike, AC-882). A remembered device passes.
        id: 'crm-two-factor-hold',
        hooks: {
          after: [
            {
              matcher: (context: { readonly path?: string }) =>
                context.path === SIGN_IN_CODE_PATH || context.path === CALLBACK_ROUTE,
              handler: createAuthMiddleware(async (ctx) => {
                const made = ctx.context.newSession;
                if (made === null) return;
                const userId = made.user.id;
                // Google's picture, once the sign in stands (23 Oct 2026): never for one held back below.
                const stands = () => (ctx.path === CALLBACK_ROUTE ? savePicture(userId) : Promise.resolve());
                if (!isTwoFactorUser(made.user)) return stands();
                // A remembered device (AC-884) passes, and its cookie is renewed, as the plugin's own hold does.
                const trust = ctx.context.createAuthCookie(TRUST_DEVICE_COOKIE, { maxAge: TRUST_DEVICE_SECONDS });
                const trusted = await ctx.getSignedCookie(trust.name, ctx.context.secret);
                if (typeof trusted === 'string') {
                  const [token = '', trustId = ''] = trusted.split('!');
                  const record =
                    trustId === '' ? null : await ctx.context.internalAdapter.findVerificationValue(trustId);
                  if (
                    token === trustToken(ctx.context.secret, userId, trustId) &&
                    record !== null &&
                    record.value === userId &&
                    record.expiresAt > new Date()
                  ) {
                    await ctx.context.internalAdapter.deleteVerificationByIdentifier(trustId);
                    const nextId = `trust-device-${generateRandomString(32)}`;
                    await ctx.context.internalAdapter.createVerificationValue({
                      value: userId,
                      identifier: nextId,
                      expiresAt: new Date(Date.now() + TRUST_DEVICE_SECONDS * 1000),
                    });
                    await ctx.setSignedCookie(
                      trust.name,
                      `${trustToken(ctx.context.secret, userId, nextId)}!${nextId}`,
                      ctx.context.secret,
                      trust.attributes,
                    );
                    return stands();
                  }
                  expireCookie(ctx, trust);
                }
                // Held back: no session until the second step (AC-882); a pending cookie names the sign in instead.
                deleteSessionCookie(ctx, true);
                await ctx.context.internalAdapter.deleteSession(made.session.token);
                ctx.context.setNewSession(null);
                const pending = ctx.context.createAuthCookie(PENDING_COOKIE, { maxAge: SECOND_STEP_SECONDS });
                const identifier = `2fa-${generateRandomString(20)}`;
                const expiresAt = new Date(Date.now() + SECOND_STEP_SECONDS * 1000);
                await ctx.context.internalAdapter.createVerificationValue({ value: userId, identifier, expiresAt });
                await ctx.context.internalAdapter.createVerificationValue({
                  value: '0',
                  identifier: `2fa-attempts-${identifier}`,
                  expiresAt,
                });
                // Google's picture waits beside the pending sign in, as long as it does, for its second step.
                const picture = ctx.path === CALLBACK_ROUTE ? notedPicture(userId) : undefined;
                if (picture !== undefined) {
                  await ctx.context.internalAdapter.createVerificationValue({
                    value: pendingPictureValue(userId, picture),
                    identifier: pendingPictureId(identifier),
                    expiresAt,
                  });
                }
                await ctx.setSignedCookie(pending.name, identifier, ctx.context.secret, pending.attributes);
                // The session never came to be, so neither did its sign in.
                await identity.forgetSignInEvent(userId, made.session.id).catch((error: unknown) => {
                  log.error('Held back sign in event not dropped', {
                    error: error instanceof Error ? error.name : typeof error,
                  });
                });
                // Google's callback lands in the browser: send it to the second step.
                if (ctx.path === CALLBACK_ROUTE) throw ctx.redirect(new URL(SECOND_STEP_PATH, appOrigin).toString());
                return ctx.json({ twoFactorRedirect: true, twoFactorMethods: ['totp'] });
              }),
            },
            {
              // The second step of a held Google sign in (23 Oct 2026): once it stands, the picture kept beside it is
              // saved; a step that ended without a session (too many wrong codes, or gone) drops it. A wrong code
              // leaves both waiting, and an expired one is never read.
              matcher: (context: { readonly path?: string }) =>
                context.path !== undefined && SECOND_STEP_ROUTES.has(context.path),
              handler: createAuthMiddleware(async (ctx) => {
                // Signed in already, `verify-totp` finishes setting the app up: no sign in to finish.
                if (ctx.context.session !== null) return;
                const pending = ctx.context.createAuthCookie(PENDING_COOKIE);
                const pendingId = await ctx.getSignedCookie(pending.name, ctx.context.secret);
                if (typeof pendingId !== 'string' || pendingId === '') return;
                const made = ctx.context.newSession;
                if (ctx.context.returned instanceof Error || made === null) {
                  if (!(await isLiveVerification(ctx.context.adapter, pendingId))) {
                    await ctx.context.internalAdapter.deleteVerificationByIdentifier(pendingPictureId(pendingId));
                  }
                  return;
                }
                const kept = await ctx.context.internalAdapter.consumeVerificationValue(pendingPictureId(pendingId));
                const picture = kept === null ? undefined : pendingPicture(kept.value, made.user.id);
                if (picture !== undefined && servedPicture(made.user.id, picture) !== undefined) {
                  await applyPicture(made.user.id, picture);
                }
              }),
            },
            {
              // Profile's Sync Google photo (23 Oct 2026): the link's callback, known by its state's mark. Linked (or
              // already linked to this person), Google's picture is saved; either way the browser goes back to
              // Profile with how it went.
              matcher: (context: { readonly path?: string }) => context.path === CALLBACK_ROUTE,
              handler: createAuthMiddleware(async (ctx) => {
                const state = await getOAuthState();
                const link = state?.link;
                if (link === undefined || state?.serverContext?.[PHOTO_PURPOSE.key] !== PHOTO_PURPOSE.value) return;
                const profile = state.callbackURL;
                // Checked when the link started; held to it again, so this never sends anyone anywhere else.
                if (typeof profile !== 'string' || !isProfileReturn(profile, appOrigin)) return;
                const location = ctx.context.responseHeaders?.get('location') ?? undefined;
                const linked = location === profile;
                // A new way to sign in: Account › Sign in and devices lists it (AC-898).
                if (linked && state.serverContext[PHOTO_PURPOSE.wasLinked] === false) {
                  await keepEvent({ userId: link.userId, kind: 'google_linked' });
                }
                const result = linked ? await syncPicture(link.userId) : linkFailure(location);
                if (result !== 'synced') log.info('Google photo not synced', { result });
                throw ctx.redirect(profileWithResult(profile, result));
              }),
            },
          ],
        },
      },
    ],
  });

  return {
    providers: { google: google !== undefined },

    async handle(request, clientIp, origin, geo) {
      const checked = await checkEmail(request);
      if (checked instanceof Response) return checked;
      const forwarded = new Request(checked, { headers: forwardedHeaders(checked.headers, clientIp, origin, geo) });
      const made: { userId: string; sessionId: string }[] = [];
      const answered = await googlePictures.run([], () => signedInThisRequest.run(made, () => auth.handler(forwarded)));
      if (made.length > 0) {
        track(alertAfter(made));
        track(sweepAfterSignIn());
      }
      // No session token leaves in a body (AC-891): the cookie carries it.
      return authErrorResponse(await stripTokens(answered), new URL(checked.url).pathname.slice(AUTH_BASE_PATH.length));
    },

    async session(headers, clientIp) {
      const { headers: answered, response } = await auth.api.getSession({
        headers: forwardedHeaders(headers, clientIp),
        returnHeaders: true,
      });
      if (response === null) return undefined;
      const { id, name, email, emailVerified, image } = response.user;
      const verified: unknown = response.session.verifiedAt;
      return {
        sessionId: response.session.id,
        user: { id, name, email, emailVerified, ...(typeof image === 'string' ? { image } : {}) },
        setCookies: answered.getSetCookie(),
        verifiedAt: verifiedAtOf(verified, response.session.createdAt),
        twoFactorEnabled: isTwoFactorUser(response.user),
      };
    },

    async checkSecondFactor(userId, method, code) {
      const row = await twoFactorRow(userId);
      // An account whose second step is locked after too many wrong codes can't step up meanwhile either.
      if (row === undefined || (row.lockedUntil instanceof Date && row.lockedUntil > new Date())) return false;
      const context = await auth.$context;
      if (method === 'totp') {
        const secret = await symmetricDecrypt({ key: context.secretConfig, data: row.secret }).catch(() => undefined);
        return secret !== undefined && totpMatches(secret, code);
      }
      const codes = await backupCodesOf(row.backupCodes);
      if (codes === undefined || !codes.includes(code)) return false;
      const left = await symmetricEncrypt({
        key: context.secretConfig,
        data: JSON.stringify(codes.filter((each) => each !== code)),
      });
      // Only while the codes are still the ones read, so one code can't be used twice at once.
      const used = await context.adapter.update({
        model: 'twoFactor',
        where: [
          { field: 'id', value: row.id },
          { field: 'backupCodes', value: row.backupCodes },
        ],
        update: { backupCodes: left },
      });
      if (used === null) return false;
      await keepEvent({ userId, kind: 'backup_code_used', detail: { stepUp: true } });
      return true;
    },

    hashStepUpCode(code) {
      return createHmac('sha256', env.BETTER_AUTH_SECRET).update(`step-up:${code}`).digest('hex');
    },

    async settled() {
      await Promise.all([...pending]);
    },

    async backupCodesLeft(userId) {
      const row = await twoFactorRow(userId);
      if (row === undefined) return undefined;
      return (await backupCodesOf(row.backupCodes))?.length;
    },
  };
}
