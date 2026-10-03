// Sign in for the data layer (spec 0005). The Better Auth client loads on
// first use through a dynamic import, so the first load stays small; the
// session, `me` and the caches are the layer's to reset around it.
import { toDataError } from '../errors.ts';
import type { FetchLike } from '../fetch.ts';
import type { AuthClient, SessionUser } from './client.ts';

export type { SessionUser } from './client.ts';

/** What sign in needs: the origin, the layer's `fetch`, and what to reset when who is signed in changes. */
export interface AuthOptions {
  readonly origin: string;
  readonly fetch: FetchLike;
  /** Forgets everything cached for the person who was signed in. */
  readonly reset: () => void;
}

/** Sign in, as screens use it. Each method resolves on success and rejects with a DataError. */
export interface Auth {
  /** Sends a 6 digit sign in code to the address. */
  sendCode(email: string): Promise<void>;
  /** Signs in with the code sent to the address. */
  verify(email: string, code: string): Promise<void>;
  /** Sends the browser to Google; it comes back to `returnTo` (a path in the app), or to `/sign-in` on a failure. */
  signInWithGoogle(returnTo: string): Promise<void>;
  /** Ends the session on this device and forgets what was cached for it. */
  signOut(): Promise<void>;
  /** The signed in person, or undefined when nobody is. */
  session(): Promise<SessionUser | undefined>;
}

/** Builds sign in. The Better Auth client is imported and built the first time a method runs. */
export function createAuth({ origin, fetch, reset }: AuthOptions): Auth {
  let client: Promise<AuthClient> | undefined;
  const load = (): Promise<AuthClient> => {
    client ??= import('./client.ts')
      .then(({ createBetterAuthClient }) => createBetterAuthClient({ origin, fetch }))
      .catch((error: unknown) => {
        // A failed load (offline) is tried again next time.
        client = undefined;
        throw toDataError(error);
      });
    return client;
  };

  return {
    async sendCode(email) {
      await (await load()).sendCode(email);
    },
    async verify(email, code) {
      await (await load()).verify(email, code);
      reset();
    },
    async signInWithGoogle(returnTo) {
      await (await load()).signInWithGoogle(new URL(returnTo, origin).href, new URL('/sign-in', origin).href);
    },
    async signOut() {
      try {
        await (await load()).signOut();
      } finally {
        reset();
      }
    },
    async session() {
      return (await load()).session();
    },
  };
}
