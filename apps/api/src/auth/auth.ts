// Sign in (spec 0005): Better Auth, in its one wrapper. Email codes and
// (where configured) Google, sessions in the `auth` schema through the
// identity store, the sign up allowlist, and rate limits that hold across
// instances. Nothing outside this folder imports Better Auth; the rest of the
// API sees only `Auth`.
import type { SignInProviders } from '@crm/contracts';
import type { IdentityStore } from '@crm/db';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins/email-otp';
import * as z from 'zod';
import type { ApiEnv } from '../env.ts';
import { log } from '../log.ts';
import type { Mailer } from '../mail/mailer.ts';
import { SIGN_IN_CODE_MINUTES, signInCodeEmail } from '../mail/sign-in-code.ts';
import { createAllowlist } from './allowlist.ts';
import { authErrorResponse } from './errors.ts';

/** Where Better Auth's own routes live, beside `/api/rpc`. */
export const AUTH_BASE_PATH = '/api/auth';

/** The route that sends a code, and the one that signs in with it. */
export const SEND_CODE_PATH = '/email-otp/send-verification-otp';

/** Code sends per email (a mistyped email and the 60 second resend wait can't lock anyone out for long). */
export const CODE_SENDS_PER_EMAIL = { window: 600, max: 5 } as const;
/** Code sends per client IP. */
export const CODE_SENDS_PER_IP = { window: 600, max: 10 } as const;
/** Sign in attempts (code checks, Google) per client IP. Each code also allows only 5 wrong tries. */
export const SIGN_INS_PER_IP = { window: 60, max: 20 } as const;

const DAY_SECONDS = 24 * 60 * 60;

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
  handle(request: Request, clientIp: string | undefined): Promise<Response>;
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
 * IP the edge guard trusted, or is absent. A forwarded chain never reaches it.
 */
export function forwardedHeaders(headers: Headers, clientIp: string | undefined): Headers {
  const next = new Headers(headers);
  next.delete('x-forwarded-for');
  if (clientIp !== undefined) next.set('x-forwarded-for', clientIp);
  return next;
}

const SendCodeBody = z.object({ email: z.string(), type: z.string() });

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
      customRules: {
        [SEND_CODE_PATH]: CODE_SENDS_PER_IP,
        '/sign-in/*': SIGN_INS_PER_IP,
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
        if (ctx.path !== SEND_CODE_PATH) return;
        const body = SendCodeBody.safeParse(ctx.body);
        // The route refuses a malformed body itself.
        if (!body.success) return;
        if (body.data.type !== 'sign-in') {
          throw new APIError('BAD_REQUEST', { code: 'INPUT_INVALID', message: 'Only sign in codes are sent.' });
        }
        const email = body.data.email.trim().toLowerCase();
        const limit = await identity.consumeRateLimit(`email:${email}|${SEND_CODE_PATH}`, CODE_SENDS_PER_EMAIL);
        if (!limit.allowed) {
          throw new APIError(
            'TOO_MANY_REQUESTS',
            { code: 'RATE_LIMITED', message: 'Too many codes were sent to this email. Wait a few minutes.' },
            { 'retry-after': String(limit.retryAfterSeconds ?? CODE_SENDS_PER_EMAIL.window) },
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

    async handle(request, clientIp) {
      const forwarded = new Request(request, { headers: forwardedHeaders(request.headers, clientIp) });
      return authErrorResponse(await auth.handler(forwarded));
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
