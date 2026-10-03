// Better Auth's browser client: its one wrapper module (spec 0005). Nothing
// else imports `better-auth/*`, and this module is loaded only with a dynamic
// import (`./auth.ts`), so the first load never carries it. Every answer
// leaves as a value or a DataError, never as Better Auth's own shapes.
import { createAuthClient } from 'better-auth/client';
import { emailOTPClient } from 'better-auth/client/plugins';
import { toDataError } from '../errors.ts';
import type { FetchLike } from '../fetch.ts';

/** Where sign in lives: the app's own origin, under `/api/auth`, reached through `fetch`. */
export interface AuthClientOptions {
  readonly origin: string;
  readonly fetch: FetchLike;
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

/** Better Auth's `{ data, error }` answer, unwrapped: the data (null when there is none), or a DataError thrown. */
async function unwrap<T>(answer: Promise<{ data: T | null; error: unknown }>): Promise<T | null> {
  let settled: { data: T | null; error: unknown };
  try {
    settled = await answer;
  } catch (error) {
    throw toDataError(error);
  }
  if (settled.error !== null && settled.error !== undefined) throw toDataError(settled.error);
  return settled.data;
}

/** Builds the Better Auth client for this origin, with the email code plugin. */
export function createBetterAuthClient({ origin, fetch }: AuthClientOptions): AuthClient {
  const client = createAuthClient({
    baseURL: new URL('/api/auth', origin).href,
    plugins: [emailOTPClient()],
    // The layer asks for the session when it needs it; no background refetches.
    sessionOptions: { refetchOnWindowFocus: false },
    fetchOptions: { customFetchImpl: (input, init) => fetch(input, init) },
  });

  return {
    async sendCode(email) {
      await unwrap(client.emailOtp.sendVerificationOtp({ email, type: 'sign-in' }));
    },
    async verify(email, code) {
      await unwrap(client.signIn.emailOtp({ email, otp: code }));
    },
    async signInWithGoogle(callbackUrl, errorUrl) {
      // On success the client sends the browser to Google.
      await unwrap(client.signIn.social({ provider: 'google', callbackURL: callbackUrl, errorCallbackURL: errorUrl }));
    },
    async signOut() {
      await unwrap(client.signOut());
    },
    async session() {
      const answer = await unwrap(client.getSession());
      if (answer === null) return undefined;
      const { id, name, email } = answer.user;
      return { id, name, email };
    },
  };
}
