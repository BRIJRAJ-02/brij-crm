// Sign in (spec 0005): Better Auth, in its one wrapper. Email codes and
// (where configured) Google, sessions in the `auth` schema through the
// identity store, the sign up allowlist, and rate limits that hold across
// instances. Nothing outside this folder imports Better Auth; the rest of the
// API sees only `Auth`.
import { isIP } from 'node:net';
import { EmailValue, emailDomain, errorStatus, type SignInProviders } from '@crm/contracts';
import type { IdentityStore } from '@crm/db';
import { betterAuth, type DBAdapter } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins/email-otp';
import * as z from 'zod';
import type { ApiEnv } from '../env.ts';
import { log } from '../log.ts';
import type { Mailer } from '../mail/mailer.ts';
import { captureFault } from '../monitoring/sentry.ts';
import { SIGN_IN_CODE_MINUTES, signInCodeEmail } from '../mail/sign-in-code.ts';
import { createAllowlist } from './allowlist.ts';
import { authErrorResponse } from './errors.ts';

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
 * code, sign in by code, Google's sign in and its callback, sign out, and the
 * session read. Sign out deletes its own session, so the revoke routes stay
 * shut. Everything else Better Auth offers (changing the user, listing or
 * revoking sessions, linking accounts) answers 404, so a route we never
 * reviewed can't be reached.
 */
export const AUTH_ROUTES: ReadonlySet<string> = new Set([
  SEND_CODE_PATH,
  SIGN_IN_CODE_PATH,
  '/sign-in/social',
  '/callback/google',
  '/sign-out',
  '/get-session',
]);

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
];

/** The signed in person, as their session says. */
export interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

/** A live session's user, and any cookies to send back (a session extended on use renews its cookie). */
export interface AuthSession {
  readonly user: SessionUser;
  readonly setCookies: readonly string[];
}

/** Sign in, as the rest of the API sees it. */
export interface Auth {
  /** The sign in methods offered beyond the email code. */
  readonly providers: SignInProviders;
  /**
   * Answers a request to `/api/auth/*`. `clientIp` is the IP the edge guard
   * trusted, or undefined; any `x-forwarded-for` the caller sent is replaced
   * by it, or dropped, so rate limits never key on a forged address. Refusals
   * leave as `{ code, message }`.
   */
  handle(request: Request, clientIp: string | undefined, origin?: string): Promise<Response>;
  /** The session the request's cookie names, or undefined when there is none or it expired. */
  session(headers: Headers, clientIp: string | undefined): Promise<AuthSession | undefined>;
}

/** What sign in needs: the environment, the identity store (its database), and a mailer for codes. */
export interface AuthDeps {
  readonly env: ApiEnv;
  readonly identity: IdentityStore;
  readonly mailer: Mailer;
}

/**
 * The request headers Better Auth sees: `x-forwarded-for` holds exactly the
 * IP the edge guard trusted, or is absent. A forwarded chain never reaches it,
 * and nor does a value that isn't an IP: Better Auth would key that caller on
 * its one shared bucket, which `perTrustedIp` keeps shut only while the header
 * is absent.
 */
export function forwardedHeaders(headers: Headers, clientIp: string | undefined, origin?: string): Headers {
  const next = new Headers(headers);
  next.delete('x-forwarded-for');
  if (clientIp !== undefined && isIP(clientIp) !== 0) next.set('x-forwarded-for', clientIp);
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
  const live = await adapter.count({
    model: 'verification',
    where: [
      { field: 'identifier', value: `sign-in-otp-${email}` },
      { field: 'expiresAt', value: new Date(), operator: 'gt' },
    ],
  });
  return live > 0;
}

function signupClosed(): APIError {
  return new APIError('FORBIDDEN', { code: 'SIGNUP_CLOSED', message: "Sign up isn't open yet." });
}

/** Builds sign in for this environment. */
export function createAuth({ env, identity, mailer }: AuthDeps): Auth {
  const local = env.APP_ENV === 'local';
  const allowlist = createAllowlist(env.APP_ENV, env.SIGNUP_ALLOWLIST);
  const google =
    env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : undefined;
  const appOrigin = new URL(env.APP_URL).origin;

  async function sendCode({ email, otp }: { email: string; otp: string }): Promise<void> {
    // A failure answers the caller the same as success; the log never holds the address or the code.
    try {
      const message = await signInCodeEmail(otp);
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

  const auth = betterAuth({
    appName: 'CRM',
    baseURL: env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    database: identity.authDatabase(),
    trustedOrigins: [appOrigin, ...(env.TRUSTED_ORIGINS ?? []), ...(local ? LOCAL_ORIGINS : [])],
    telemetry: { enabled: false },
    disabledPaths: DISABLED_PATHS,
    session: {
      expiresIn: 30 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
      // Read every session from the database, so signing out or revoking takes effect at once.
      cookieCache: { enabled: false },
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
      log: (level, message) => (level === 'error' ? log.error : log.warn)('Sign in library', { detail: message }),
    },
    databaseHooks: {
      user: {
        create: {
          // Every way an account is made (a code, Google) passes here.
          before: (user) => {
            if (!allowlist.allows(user.email)) throw signupClosed();
            return Promise.resolve();
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
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
        if (!allowlist.allows(email) && (await ctx.context.internalAdapter.findUserByEmail(email)) === null) {
          throw signupClosed();
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
    ],
  });

  return {
    providers: { google: google !== undefined },

    async handle(request, clientIp, origin) {
      const checked = await checkEmail(request);
      if (checked instanceof Response) return checked;
      const forwarded = new Request(checked, { headers: forwardedHeaders(checked.headers, clientIp, origin) });
      return authErrorResponse(
        await auth.handler(forwarded),
        new URL(checked.url).pathname.slice(AUTH_BASE_PATH.length),
      );
    },

    async session(headers, clientIp) {
      const { headers: answered, response } = await auth.api.getSession({
        headers: forwardedHeaders(headers, clientIp),
        returnHeaders: true,
      });
      if (response === null) return undefined;
      const { id, name, email, emailVerified } = response.user;
      return { user: { id, name, email, emailVerified }, setCookies: answered.getSetCookie() };
    },
  };
}
