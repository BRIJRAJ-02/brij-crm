// The one client data layer (spec 0005, the thin start of #6). Screens and
// routes read and write through it and never call the network themselves.
// It holds who is signed in, the workspace's objects, members and attributes,
// creating a workspace, sign in, the status check, and the records: one
// store, a view per object, and optimistic creates and edits (loaded when a
// screen first asks for records). Live patches land behind the same object
// in milestone 3.
import type {
  AttributeDefinition,
  CreatableAttributeType,
  CreateWorkspaceInput,
  contract,
  Me,
  MemberSummary,
  ObjectSummary,
  RecordView,
} from '@crm/contracts';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { createAuth } from './auth/auth.ts';
import { ERROR_MESSAGES, parseRetryAfter, toDataError, withRetryAfter } from './errors.ts';
import type { FetchLike } from './fetch.ts';
import type { Notice } from './notice.ts';
import type { CellChange, RecordsApi, RecordsLayer, RecordsView } from './records/layer.ts';

export type {
  ActorDisplay,
  ApiRefusal,
  AttributeDefinition,
  AttributeType,
  CreatableAttributeType,
  CreatedWorkspace,
  CreateWorkspaceInput,
  InputIssue,
  Me,
  MemberSummary,
  ObjectSummary,
  RecordView,
  SignedInUser,
  SystemStatus,
  WorkspaceSummary,
} from '@crm/contracts';
export type { Auth, SessionUser } from './auth/auth.ts';
export {
  dataError,
  isDataError,
  refusalFor,
  refusalSummary,
  SIGN_IN_CODES,
  type DataError,
  type DataErrorCode,
  type DataErrorDetails,
  type SignInCode,
} from './errors.ts';
export type { FetchLike } from './fetch.ts';
export { isEditableHere, toActorDisplays, toFieldAttribute, type FieldAttributeShape } from './fields.ts';
export { createIdMinter, type IdSources } from './ids.ts';
export type { Notice } from './notice.ts';
export type { CellChange, RecordsView, ViewState, ViewStatus } from './records/layer.ts';

/** What each API call carries to the link: where to report the answer's `Retry-After`. */
interface CallContext {
  readonly onRetryAfter?: (seconds: number) => void;
}

type ApiClient = ContractRouterClient<typeof contract, CallContext>;

/** One API call's options: the context, and the signal that cancels it. */
interface CallOptions {
  readonly context: CallContext;
  readonly signal?: AbortSignal;
}

/** The cache key of one object's attributes in one workspace. */
const objectKey = (workspace: string, objectId: string) => `${workspace}/${objectId}`;

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

  // Cached per app load: who is signed in, and each workspace's objects,
  // members and attributes. A failed load is dropped, so the next call tries
  // again.
  let me: Promise<Me | undefined> | undefined;
  let objects = new Map<string, Promise<ObjectSummary[]>>();
  let members = new Map<string, Promise<MemberSummary[]>>();
  let attributes = new Map<string, Promise<AttributeDefinition[]>>();
  // The records layer, loaded with the first screen that shows records.
  let records: Promise<RecordsLayer> | undefined;
  // Set by the first 401, so a burst of failed calls signs out once.
  let ended = false;
  const forget = () => {
    me = undefined;
    objects = new Map();
    members = new Map();
    attributes = new Map();
    void records?.then((layer) => {
      layer.clear();
    });
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
  async function attempt<T>(run: (options: CallOptions) => Promise<T>, signal?: AbortSignal): Promise<T> {
    let wait: number | undefined;
    try {
      return await run({
        context: {
          onRetryAfter: (seconds) => {
            wait = seconds;
          },
        },
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      throw withRetryAfter(toDataError(error), wait);
    }
  }

  /** Runs a call, mapping its failure to a DataError; a 401 ends the session here. */
  async function call<T>(run: (options: CallOptions) => Promise<T>, signal?: AbortSignal): Promise<T> {
    try {
      return await attempt(run, signal);
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

  /** Reads a per workspace list once, dropping it from the cache when it fails, so the next call asks again. */
  function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const loading = load();
    cache.set(key, loading);
    loading.catch(() => {
      if (cache.get(key) === loading) cache.delete(key);
    });
    return loading;
  }

  const recordsApi: RecordsApi = {
    query: (input, signal) => call((options) => api.records.query(input, options), signal),
    count: (input, signal) => call((options) => api.records.count(input, options), signal),
    get: (input) => call((options) => api.records.get({ workspace: input.workspace, ids: [...input.ids] }, options)),
    create: (input) => call((options) => api.records.create(input, options)),
    setValues: (input) => call((options) => api.records.setValues(input, options)),
  };
  const recordsLayer = (): Promise<RecordsLayer> => {
    records ??= import('./records/layer.ts').then(({ createRecordsLayer }) =>
      createRecordsLayer({ api: recordsApi, notify, mintId }),
    );
    return records;
  };

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
    members: {
      /** The workspace's active members, by name: the Owner column's names. Cached for the app load. */
      list: (workspace: string): Promise<MemberSummary[]> =>
        cached(members, workspace, () => call((options) => api.members.list({ workspace }, options))),
    },
    attributes: {
      /** An object's live attributes in position order, system ones marked. Cached until an attribute is added. */
      list: (workspace: string, objectId: string): Promise<AttributeDefinition[]> =>
        cached(attributes, objectKey(workspace, objectId), () =>
          call((options) => api.attributes.list({ workspace, objectId }, options)),
        ),
      /**
       * Adds an attribute and waits for the server (no optimistic step: it is
       * often refused, and it reshapes the table). Refusals: `SLUG_TAKEN` on
       * `title`, `LIMIT_REACHED`, `CONFIG_INVALID`. A retry after a lost answer
       * gets the attribute the first try made. The object's list is read again
       * next time.
       */
      async create(
        workspace: string,
        input: { readonly objectId: string; readonly title: string; readonly type: CreatableAttributeType },
      ): Promise<AttributeDefinition> {
        const made = await call((options) =>
          api.attributes.create({ workspace, ...input, mutationId: mintId() }, options),
        );
        attributes.delete(objectKey(workspace, input.objectId));
        return made;
      },
    },
    records: {
      /**
       * An object's records for one screen (the same view for every screen
       * that asks), settled once its count and first block are in or failed.
       * The router loader awaits it; the screen reads it through `useView`.
       */
      async view(workspace: string, objectId: string): Promise<RecordsView> {
        const view = (await recordsLayer()).view(workspace, objectId);
        await view.ready();
        return view;
      },
      /** A new record's id: mint it once per form, and send the same one on every try, so nothing is made twice. */
      newId: () => mintId(),
      /**
       * Makes a record at once (see the records layer) with `id` (from
       * `newId`); rejects with the refusals when the server says no. Sending the
       * same id again after a lost answer gets the record already made.
       */
      create: async (
        workspace: string,
        objectId: string,
        id: string,
        values: Readonly<Record<string, unknown>>,
      ): Promise<RecordView> => (await recordsLayer()).create(workspace, objectId, values, id),
      /** Edits one cell at once; a refusal rolls it back with a cell message and a toast with Retry. */
      setValue: (workspace: string, change: CellChange): void => {
        void recordsLayer().then((layer) => {
          layer.setValues(workspace, [change]);
        });
      },
      /** Edits several cells at once (a paste, a range clear), one write per record. */
      setValues: (workspace: string, changes: readonly CellChange[]): void => {
        void recordsLayer().then((layer) => {
          layer.setValues(workspace, changes);
        });
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
