// Sign in for the data layer (spec 0005). The Better Auth client loads on
// first use through a dynamic import, so the first load stays small; the
// session, `me` and the caches are the layer's to reset around it.
import { type DataFault, toDataError } from '../errors.ts';
import type { FetchLike } from '../fetch.ts';
import type { AuthClient, SecondFactorKind, SessionUser, SignInOutcome, TwoFactorSetup } from './client.ts';

export type { SecondFactorKind, SessionUser, SignInOutcome, TwoFactorSetup } from './client.ts';

/** What sign in needs: the origin, the layer's `fetch`, and what to reset when who is signed in changes. */
export interface AuthOptions {
  readonly origin: string;
  readonly fetch: FetchLike;
  /** Forgets everything cached for the person who was signed in. */
  readonly reset: () => void;
  /** Monitoring: a sign in failure the server can't have seen (see `DataLayerOptions.report`). */
  readonly report?: (fault: DataFault) => void;
}

/** Sign in, as screens use it. Each method resolves on success and rejects with a DataError. */
export interface Auth {
  /** Sends a 6 digit sign in code to the address. */
  sendCode(email: string): Promise<void>;
  /**
   * Signs in with the code sent to the address. With two factor on (spec
   * 0033) no session exists yet: it answers `second-step`, for the second
   * step page; otherwise `signed-in`.
   */
  verify(email: string, code: string): Promise<SignInOutcome>;
  /** The second step: an app code or a backup code; `remember` skips it on this browser for 30 days. */
  secondStep(kind: SecondFactorKind, code: string, remember: boolean): Promise<void>;
  /** Two factor setup and change (Account › Security, after a step up). */
  readonly twoFactor: {
    start(): Promise<TwoFactorSetup>;
    confirm(code: string): Promise<void>;
    turnOff(): Promise<void>;
    newBackupCodes(): Promise<readonly string[]>;
  };
  /**
   * Sends the browser to Google; it comes back to `returnTo` (a path in the
   * app, already checked by the screen), or on a failure to `/sign-in` with
   * `?redirect=` set to `returnTo`, so a refused sign in keeps the deep link.
   */
  signInWithGoogle(returnTo: string): Promise<void>;
  /** Ends the session on this device and forgets what was cached for it. */
  signOut(): Promise<void>;
  /** The signed in person, or undefined when nobody is. */
  session(): Promise<SessionUser | undefined>;
}

/** Builds sign in. The Better Auth client is imported and built the first time a method runs. */
export function createAuth({ origin, fetch, reset, report }: AuthOptions): Auth {
  let client: Promise<AuthClient> | undefined;
  const load = (): Promise<AuthClient> => {
    client ??= import('./client.ts')
      .then(({ createBetterAuthClient }) =>
        createBetterAuthClient({ origin, fetch, ...(report === undefined ? {} : { report }) }),
      )
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
      const outcome = await (await load()).verify(email, code);
      if (outcome === 'signed-in') reset();
      return outcome;
    },
    async secondStep(kind, code, remember) {
      await (await load()).secondStep(kind, code, remember);
      reset();
    },
    twoFactor: {
      async start() {
        return (await load()).startTwoFactor();
      },
      async confirm(code) {
        await (await load()).confirmTwoFactor(code);
      },
      async turnOff() {
        await (await load()).turnOffTwoFactor();
      },
      async newBackupCodes() {
        return (await load()).newBackupCodes();
      },
    },
    async signInWithGoogle(returnTo) {
      // Better Auth adds `error` to this address's search, beside `redirect`.
      const back = new URL('/sign-in', origin);
      if (returnTo !== '/') back.searchParams.set('redirect', returnTo);
      await (await load()).signInWithGoogle(new URL(returnTo, origin).href, back.href);
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
