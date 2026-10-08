// Better Auth's browser client: its one wrapper module (spec 0005). Nothing
// else imports `better-auth/*`, and this module is loaded only with a dynamic
// import (`./auth.ts`), so the first load never carries it. Every answer
// leaves as a value or a DataError, never as Better Auth's own shapes.
import { createAuthClient } from 'better-auth/client';
import { emailOTPClient } from 'better-auth/client/plugins';
import { type DataFault, isUnseenFault, parseRetryAfter, toDataError, withRetryAfter } from '../errors.ts';
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

/** Sign in, as the data layer uses it. Each method resolves on success and rejects with a DataError. */
export interface AuthClient {
  sendCode(email: string): Promise<void>;
  verify(email: string, code: string): Promise<void>;
  signInWithGoogle(callbackUrl: string, errorUrl: string): Promise<void>;
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
      await unwrap((fetchOptions) => client.signIn.emailOtp({ email, otp: code, fetchOptions }), step('auth.verify'));
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
