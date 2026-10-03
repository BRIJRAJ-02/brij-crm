// The one client data layer (spec 0005, the thin start of #6). Screens and
// routes read and write through it and never call the network themselves.
// This milestone holds who is signed in, the workspace's objects, creating a
// workspace, sign in, and the status check; the record store, optimistic
// writes and live patches land behind the same object in milestones 2 and 3.
import type { CreateWorkspaceInput, contract, Me, ObjectSummary } from '@crm/contracts';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { createAuth } from './auth/auth.ts';
import { ERROR_MESSAGES, parseRetryAfter, toDataError, withRetryAfter } from './errors.ts';
import type { FetchLike } from './fetch.ts';

export type {
  ApiRefusal,
  CreatedWorkspace,
  CreateWorkspaceInput,
  InputIssue,
  Me,
  ObjectSummary,
  SignedInUser,
  SystemStatus,
  WorkspaceSummary,
} from '@crm/contracts';
export type { Auth, SessionUser } from './auth/auth.ts';
export {
  dataError,
  isDataError,
  SIGN_IN_CODES,
  type DataError,
  type DataErrorCode,
  type DataErrorDetails,
  type SignInCode,
} from './errors.ts';
export type { FetchLike } from './fetch.ts';
export { createIdMinter, type IdSources } from './ids.ts';

/** What each API call carries to the link: where to report the answer's `Retry-After`. */
interface CallContext {
  readonly onRetryAfter?: (seconds: number) => void;
}

type ApiClient = ContractRouterClient<typeof contract, CallContext>;

/** A message for the person, raised on the app's toast queue. The same shape as the library's `ToastContent`. */
export interface Notice {
  readonly tone: 'success' | 'danger';
  readonly message: string;
  readonly action?: { readonly label: string; readonly onAction: () => void };
}

/** What the data layer needs from the app. */
export interface DataLayerOptions {
  /** The app's own origin. The API sits under `/api` on it. */
  readonly origin: string;
  /** Raises a message on the app's toast queue. */
  readonly notify: (notice: Notice) => void;
  /** Mints a UUID v7 with the browser's crypto (`createIdMinter`). */
  readonly mintId: () => string;
  /**
   * The session ended while in use (a call answered 401): the app goes to
   * sign in, coming back to `redirectTo` (the path and query the person was
   * on) afterwards.
   */
  readonly onSignedOut: (redirectTo: string) => void;
  /** The path and query the person is on now, for `onSignedOut`. */
  readonly currentPath: () => string;
  /**
   * Who is signed in changed: a sign in, a sign out, or a session that ended
   * (a 401, after `onSignedOut`). The app drops whatever it cached for the
   * last person outside the layer, such as the router's loaded pages.
   */
  readonly onSessionChange?: () => void;
  /** The network. The browser's `fetch` by default; tests pass a fake API. */
  readonly fetch?: FetchLike;
}

/**
 * The one client data layer. Screens read and write through it and never
 * call the network themselves. Every failure rejects with a DataError
 * (`{ code, message, data?, retryAfterSeconds? }`); a 401 from any call but
 * `me.get` also runs `onSignedOut` once, forgets what was cached for the
 * person and runs `onSessionChange`.
 */
export function createDataLayer({
  origin,
  notify,
  mintId,
  onSignedOut,
  currentPath,
  onSessionChange = () => undefined,
  fetch = (input, init) => globalThis.fetch(input, init),
}: DataLayerOptions) {
  const api: ApiClient = createORPCClient(
    new RPCLink<CallContext>({
      url: new URL('/api/rpc', origin).href,
      fetch: async (request, init, { context }) => {
        const response = await fetch(request, init);
        const wait = response.ok ? undefined : parseRetryAfter(response.headers.get('retry-after'), Date.now());
        if (wait !== undefined) context.onRetryAfter?.(wait);
        return response;
      },
    }),
  );

  // Cached per app load: who is signed in, and each workspace's objects. A
  // failed load is dropped, so the next call tries again.
  let me: Promise<Me | undefined> | undefined;
  let objects = new Map<string, Promise<ObjectSummary[]>>();
  // Set by the first 401, so a burst of failed calls signs out once.
  let ended = false;
  const forget = () => {
    me = undefined;
    objects = new Map();
  };
  const reset = () => {
    forget();
    ended = false;
    onSessionChange();
  };

  /**
   * Runs one API call with a fresh context, mapping its failure to a
   * DataError that carries the answer's `Retry-After`.
   */
  async function attempt<T>(run: (options: { readonly context: CallContext }) => Promise<T>): Promise<T> {
    let wait: number | undefined;
    try {
      return await run({
        context: {
          onRetryAfter: (seconds) => {
            wait = seconds;
          },
        },
      });
    } catch (error) {
      throw withRetryAfter(toDataError(error), wait);
    }
  }

  /** Runs a call, mapping its failure to a DataError; a 401 ends the session here. */
  async function call<T>(run: (options: { readonly context: CallContext }) => Promise<T>): Promise<T> {
    try {
      return await attempt(run);
    } catch (error) {
      const failure = toDataError(error);
      if (failure.code === 'UNAUTHENTICATED' && !ended) {
        ended = true;
        forget();
        notify({ tone: 'danger', message: ERROR_MESSAGES.signedOut });
        // Off to sign in first, then the app drops the last person's pages.
        onSignedOut(currentPath());
        onSessionChange();
      }
      throw failure;
    }
  }

  const auth = createAuth({ origin, fetch, reset });

  return {
    me: {
      /**
       * Who is signed in and their workspaces (oldest first), or undefined
       * when nobody is. Asked once per app load, then cached until sign in,
       * sign out or a new workspace changes it. A 401 here is an answer
       * ("nobody"), so it never runs `onSignedOut`.
       */
      get(): Promise<Me | undefined> {
        me ??= attempt((options) => api.me.get(undefined, options)).then(
          (answer) => {
            // Someone is signed in again (in another tab, say): the next 401 ends their session too.
            ended = false;
            return answer;
          },
          (error: unknown) => {
            const failure = toDataError(error);
            if (failure.code === 'UNAUTHENTICATED') return undefined;
            me = undefined;
            throw failure;
          },
        );
        return me;
      },
    },
    workspaces: {
      /** A new workspace's id: mint it once per form, and send the same one again on a retry, so nothing is made twice. */
      newId: () => mintId(),
      /** Creates the signed in person's workspace. Refusals: `SLUG_TAKEN` (field `slug`), `ID_TAKEN`, `INPUT_INVALID` (with issues). */
      async create(input: CreateWorkspaceInput) {
        const created = await call((options) => api.workspaces.create(input, options));
        me = undefined;
        return created;
      },
    },
    objects: {
      /**
       * The workspace's live objects, cached for the app load. A non member
       * gets the same `NOT_FOUND` as an unknown address, which also drops the
       * cached `me`: the person may have just left it, so `/` asks again.
       */
      list(workspace: string): Promise<ObjectSummary[]> {
        const cached = objects.get(workspace);
        if (cached !== undefined) return cached;
        const loading = call((options) => api.objects.list({ workspace }, options));
        objects.set(workspace, loading);
        loading.catch((error: unknown) => {
          if (objects.get(workspace) === loading) objects.delete(workspace);
          if (toDataError(error).code === 'NOT_FOUND') me = undefined;
        });
        return loading;
      },
    },
    system: {
      /** Whether the API and the database answer, and which sign in methods are on. Never cached. */
      status: () => call((options) => api.system.status(undefined, options)),
    },
    auth,
  };
}

/** The data layer, as routes see it in their context. */
export type DataLayer = ReturnType<typeof createDataLayer>;
