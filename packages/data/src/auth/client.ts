// Better Auth's browser client: its one wrapper module (spec 0005). Nothing
// else imports `better-auth/*`, and this module is loaded only with a dynamic
// import (`./auth.ts`), so the first load never carries it. Every answer
// leaves as a value or a DataError, never as Better Auth's own shapes.
import { createAuthClient } from 'better-auth/client';
import { emailOTPClient } from 'better-auth/client/plugins';
import {
  type DataFault,
  dataError,
  ERROR_MESSAGES,
  isUnseenFault,
  parseRetryAfter,
  toDataError,
  withRetryAfter,
} from '../errors.ts';
import type { FetchLike } from '../fetch.ts';

/** Where sign in lives: the app's own origin, under `/api/auth`, reached through `fetch`. */
export interface AuthClientOptions {
  readonly origin: string;
  readonly fetch: FetchLike;
  /** Monitoring: a failure the server can't have seen (see `DataLayerOptions.report`). */
  readonly report?: (fault: DataFault) => void;
}

/** The signed in person, as the session cookie says. */
export interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

/**
 * How a sign in by code went: signed in, or held back for its second step
 * (two factor is on, spec 0033).
 */
export type SignInOutcome = 'signed-in' | 'second-step';

/** A second step's code: from the authenticator app, or one of the backup codes. */
export type SecondFactorKind = 'totp' | 'backup';

/** Two factor setup's first answer (AC-881): the app's address for the QR code, and the backup codes, shown once. */
export interface TwoFactorSetup {
  readonly totpUri: string;
  readonly backupCodes: readonly string[];
}

/** Sign in, as the data layer uses it. Each method resolves on success and rejects with a DataError. */
export interface AuthClient {
  sendCode(email: string): Promise<void>;
  verify(email: string, code: string): Promise<SignInOutcome>;
  /** The second step of a sign in held back for it; `remember` skips it on this browser for 30 days. */
  secondStep(kind: SecondFactorKind, code: string, remember: boolean): Promise<void>;
  /** Starts setting the app up (after a step up): its address and the backup codes. */
  startTwoFactor(): Promise<TwoFactorSetup>;
  /** Confirms the app with a first code, which turns two factor on. */
  confirmTwoFactor(code: string): Promise<void>;
  /** Turns two factor off (after a step up with a second factor). */
  turnOffTwoFactor(): Promise<void>;
  /** Makes 10 new backup codes in place of the old ones (after a step up with a second factor). */
  newBackupCodes(): Promise<readonly string[]>;
  signInWithGoogle(callbackUrl: string, errorUrl: string): Promise<void>;
  /** Links (or refreshes) the signed in person's Google account; the browser comes back to `returnUrl` either way. */
  linkGoogle(returnUrl: string): Promise<void>;
  signOut(): Promise<void>;
  session(): Promise<SessionUser | undefined>;
}

/** Per call fetch options: reads a refusal's `Retry-After` before Better Auth drops the response. */
interface CallOptions {
  readonly onError: (context: { readonly response: Response }) => void;
}

/**
 * Better Auth's `{ data, error }` answer, unwrapped: the data (null when there
 * is none), or a DataError thrown, carrying the answer's `Retry-After` when it
 * had one.
 */
async function unwrap<T>(
  run: (options: CallOptions) => Promise<{ data: T | null; error: unknown }>,
  step: { readonly procedure: string; readonly report?: ((fault: DataFault) => void) | undefined },
): Promise<T | null> {
  let retryAfter: number | undefined;
  let requestId: string | undefined;
  const options: CallOptions = {
    onError: ({ response }) => {
      retryAfter = parseRetryAfter(response.headers.get('retry-after'), Date.now());
      requestId = response.headers.get('x-request-id') ?? undefined;
    },
  };
  const fail = (error: unknown): never => {
    if (isUnseenFault(error)) {
      step.report?.({ error, procedure: step.procedure, ...(requestId === undefined ? {} : { requestId }) });
    }
    throw withRetryAfter(toDataError(error), retryAfter);
  };
  let settled: { data: T | null; error: unknown };
  try {
    settled = await run(options);
  } catch (error) {
    return fail(error);
  }
  if (settled.error !== null && settled.error !== undefined) return fail(settled.error);
  return settled.data;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((each) => typeof each === 'string');

/** Builds the Better Auth client for this origin, with the email code plugin. */
export function createBetterAuthClient({ origin, fetch, report }: AuthClientOptions): AuthClient {
  const step = (procedure: string) => ({ procedure, report });
  const client = createAuthClient({
    baseURL: new URL('/api/auth', origin).href,
    plugins: [emailOTPClient()],
    // The layer asks for the session when it needs it; no background refetches.
    sessionOptions: { refetchOnWindowFocus: false },
    fetchOptions: { customFetchImpl: (input, init) => fetch(input, init) },
  });

  return {
    async sendCode(email) {
      await unwrap(
        (fetchOptions) => client.emailOtp.sendVerificationOtp({ email, type: 'sign-in', fetchOptions }),
        step('auth.sendCode'),
      );
    },
    async verify(email, code) {
      const answer: unknown = await unwrap(
        (fetchOptions) => client.signIn.emailOtp({ email, otp: code, fetchOptions }),
        step('auth.verify'),
      );
      return isRecord(answer) && answer.twoFactorRedirect === true ? 'second-step' : 'signed-in';
    },
    async secondStep(kind, code, remember) {
      const path = kind === 'totp' ? '/two-factor/verify-totp' : '/two-factor/verify-backup-code';
      await unwrap(
        (fetchOptions) =>
          client.$fetch(path, { method: 'POST', body: { code, trustDevice: remember }, ...fetchOptions }),
        step('auth.secondStep'),
      );
    },
    async startTwoFactor() {
      const answer: unknown = await unwrap(
        (fetchOptions) => client.$fetch('/two-factor/enable', { method: 'POST', body: {}, ...fetchOptions }),
        step('auth.startTwoFactor'),
      );
      if (!isRecord(answer) || typeof answer.totpURI !== 'string' || !isStringList(answer.backupCodes)) {
        throw dataError('INTERNAL', ERROR_MESSAGES.internal);
      }
      return { totpUri: answer.totpURI, backupCodes: answer.backupCodes };
    },
    async confirmTwoFactor(code) {
      await unwrap(
        (fetchOptions) => client.$fetch('/two-factor/verify-totp', { method: 'POST', body: { code }, ...fetchOptions }),
        step('auth.confirmTwoFactor'),
      );
    },
    async turnOffTwoFactor() {
      await unwrap(
        (fetchOptions) => client.$fetch('/two-factor/disable', { method: 'POST', body: {}, ...fetchOptions }),
        step('auth.turnOffTwoFactor'),
      );
    },
    async newBackupCodes() {
      const answer: unknown = await unwrap(
        (fetchOptions) =>
          client.$fetch('/two-factor/generate-backup-codes', { method: 'POST', body: {}, ...fetchOptions }),
        step('auth.newBackupCodes'),
      );
      if (!isRecord(answer) || !isStringList(answer.backupCodes)) throw dataError('INTERNAL', ERROR_MESSAGES.internal);
      return answer.backupCodes;
    },
    async signInWithGoogle(callbackUrl, errorUrl) {
      // On success the client sends the browser to Google.
      await unwrap(
        (fetchOptions) =>
          client.signIn.social({
            provider: 'google',
            callbackURL: callbackUrl,
            errorCallbackURL: errorUrl,
            fetchOptions,
          }),
        step('auth.signInWithGoogle'),
      );
    },
    async linkGoogle(returnUrl) {
      // On success the client sends the browser to Google; the API sends it back to `returnUrl` with the result.
      await unwrap(
        (fetchOptions) =>
          client.linkSocial({
            provider: 'google',
            callbackURL: returnUrl,
            errorCallbackURL: returnUrl,
            fetchOptions,
          }),
        step('auth.linkGoogle'),
      );
    },
    async signOut() {
      await unwrap((fetchOptions) => client.signOut({ fetchOptions }), step('auth.signOut'));
    },
    async session() {
      const answer = await unwrap((fetchOptions) => client.getSession({ fetchOptions }), step('auth.session'));
      if (answer === null) return undefined;
      const { id, name, email } = answer.user;
      return { id, name, email };
    },
  };
}
