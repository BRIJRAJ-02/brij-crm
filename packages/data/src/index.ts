// The one client data layer (spec 0005, the thin start of #6). Screens and
// routes read and write through it and never call the network themselves.
// It holds who is signed in, the workspace's objects, members and attributes,
// creating a workspace, sign in, the status check, and the records: one
// store, a view per object, and optimistic creates and edits (loaded when a
// screen first asks for records), patched in place by live change events
// while a screen shows a workspace (the realtime client loads with the first).
import type {
  AttributeDefinition,
  CreatableAttributeType,
  CreateWorkspaceInput,
  contract,
  JobView,
  Me,
  MemberSummary,
  MyAccess,
  ObjectSummary,
  RecordView,
  Usage,
} from '@crm/contracts';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { ActivityFeed, ActivityFeeds } from './activity/feed.ts';
import { createAuth } from './auth/auth.ts';
import { createTrashedLookups, type TrashedSource } from './records/trashed.ts';
import {
  type DataFault,
  ERROR_MESSAGES,
  isUnseenFault,
  parseRetryAfter,
  toDataError,
  withRetryAfter,
} from './errors.ts';
import type { FetchLike } from './fetch.ts';
import { createJobsStore, type JobsScope, type JobsView, type TestJobSettings } from './jobs/store.ts';
import type { createLive, Granted, Live, LiveStatus } from './live/live.ts';
import { createMutationLog } from './live/mutations.ts';
import { createLiveRouter } from './live/router.ts';
import type { Notice } from './notice.ts';
import type { UndoKind } from './records/history.ts';
import type { RecordAttributes, RecordSubscription } from './records/one.ts';
import type {
  CellChange,
  EditOutcome,
  ObjectShape,
  RecordsApi,
  RecordsLayer,
  RecordsView,
  ReplacedNotice,
  UndoOutcome,
  ViewQuery,
} from './records/layer.ts';

export type {
  ActorDisplay,
  ApiRefusal,
  AttributeDefinition,
  AttributeOption,
  AttributeType,
  CreatableAttributeType,
  CreatedWorkspace,
  CreateWorkspaceInput,
  InputIssue,
  JobStatus,
  JobView,
  Me,
  MemberSummary,
  MyAccess,
  ObjectSummary,
  Permission,
  RecordRefDisplay,
  RecordView,
  SignedInUser,
  SystemStatus,
  TrashedRecord,
  Usage,
  UsageCount,
  WorkspaceSummary,
} from '@crm/contracts';
export type { ActivityEntryShape, ActivityFeed, ActivityState, ActivityStatus, EntrySource } from './activity/feed.ts';
export type { Hue, ObjectIcon } from '@crm/contracts/values';
// The API name rule and the new object's defaults (spec 0012): plain modules with no Zod, so the dialogs share
// the server's own functions without loading the schema library.
export { isReservedSlug, RESERVED_SLUGS, toApiSlug } from '@crm/contracts/slugs';
export { freeHue } from '@crm/contracts/picker';
export type { Auth, SessionUser } from './auth/auth.ts';
export {
  dataError,
  isDataError,
  isFetchFailure,
  refusalFor,
  refusalSummary,
  SIGN_IN_CODES,
  type DataError,
  type DataErrorCode,
  type DataErrorDetails,
  type DataFault,
  type SignInCode,
} from './errors.ts';
export type { FetchLike } from './fetch.ts';
export type { JobsScope, JobsSnapshot, JobsView, TestJobSettings } from './jobs/store.ts';
export { isEditableHere, toActorDisplays, toFieldAttribute, type FieldAttributeShape } from './fields.ts';
export { createIdMinter, type IdSources } from './ids.ts';
export type { LiveStatus } from './live/live.ts';
export type { Notice } from './notice.ts';
export type { UndoKind } from './records/history.ts';
export type {
  CellChange,
  EditOutcome,
  RecordsView,
  ViewQuery,
  ViewReader,
  ViewState,
  ViewStatus,
} from './records/layer.ts';
export type { RecordAttributes, RecordState, RecordStatus, RecordSubscription } from './records/one.ts';
export type { TrashedSource, TrashedState } from './records/trashed.ts';
export type { RowNote } from './records/view.ts';
export type { NameState, RecordRef } from './records/names.ts';
export type { WindowCount, WindowMode } from './records/windows.ts';
export type { FilterGroup, SortRule, SortRules } from '@crm/contracts/values';

/**
 * A value this tab saved was replaced by someone else's later save (spec
 * 0006, AC-46), with the names resolved for the screen's words: the record,
 * the first attribute replaced and how many more, and who replaced it (a
 * member by name, or an API key or an automation). "Use mine" saves this
 * tab's values again as a normal, undoable edit.
 */
export interface ReplacedValue {
  readonly workspace: string;
  readonly recordId: string;
  readonly recordName: string;
  readonly attributeTitle: string;
  /** How many more cells of the record the same save replaced ("and 2 more"). */
  readonly others: number;
  readonly by:
    | { readonly kind: 'member'; readonly name: string | undefined }
    | { readonly kind: 'api_key' }
    | { readonly kind: 'automation' };
  readonly useMine: () => void;
}

/** What an undo did (spec 0006, AC-48, AC-49), with the first cell's attribute named for a one cell toast. */
export type UndoResult =
  | { readonly kind: 'nothing' }
  | { readonly kind: 'stale' }
  | (Extract<UndoOutcome, { kind: 'undone' }> & { readonly attributeTitle: string });

/** What each API call carries to the link: where to report the answer's `Retry-After`, and that an answer came. */
interface CallContext {
  readonly onRetryAfter?: (seconds: number) => void;
  /** The answer's request id (`x-request-id`) and the procedure it answered, for a fault report. */
  readonly onAnswer?: (answer: { readonly requestId?: string; readonly procedure: string }) => void;
}

type ApiClient = ContractRouterClient<typeof contract, CallContext>;

/** One API call's options: the context, and the signal that cancels it. */
interface CallOptions {
  readonly context: CallContext;
  readonly signal?: AbortSignal;
}

/** How long a read waits for the workspace's head before going ahead without it (spec 0007: the token call is usually beside `me.get`). */
const HEAD_WAIT_MS = 5_000;
/** The longest spread before a reread every tab of a workspace makes at once (a members or access event), in ms. */
const SPREAD_MS = 2_000;

/** How long the token read with the head may be handed to the live layer as its first token. */
const FIRST_TOKEN_MS = 60_000;

/** A new object, as settings sends it (spec 0012, AC-223): the id from `objects.newId`, minted once per dialog. */
export interface NewObject {
  readonly id: string;
  readonly singularName: string;
  readonly pluralName: string;
  /** Derived from the plural name on the server (`toApiSlug`) when absent. */
  readonly apiSlug?: string;
  readonly icon: ObjectSummary['icon'];
  readonly hue: ObjectSummary['hue'];
}

/** What settings may change on an object (spec 0012, AC-224). Its API name never changes. */
export interface ObjectChanges {
  readonly singularName?: string;
  readonly pluralName?: string;
  readonly icon?: ObjectSummary['icon'];
  readonly hue?: ObjectSummary['hue'];
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
  /**
   * Centrifugo's WebSocket address (`VITE_REALTIME_URL`). Unset (previews),
   * live updates are off and `live.status()` says so.
   */
  readonly realtimeUrl?: string | undefined;
  /**
   * An object's attributes changed elsewhere (a live `definitions` event) and
   * were dropped from the cache: the app loads its pages again, so a new
   * column shows.
   */
  readonly onDefinitionsChange?: () => void;
  /**
   * A value this tab saved was replaced by someone else's later save (spec
   * 0006, AC-46): the app raises the notice in its own words, with "Use mine".
   */
  readonly onReplaced?: (replaced: ReplacedValue) => void;
  /**
   * A background job this browser started has ended while the app is open
   * (spec 0008, AC-119): the app raises its toast ("Done", "Done, 6
   * refused", "Failed", "Cancelled") with a link to the job.
   */
  readonly onJobFinished?: (workspace: string, job: JobView) => void;
  /** Loads live updates. `./live/live.ts` by default; tests pass one on a fake transport. */
  readonly loadLive?: () => Promise<{ readonly createLive: typeof createLive }>;
  /**
   * Monitoring (spec 0010, AC-163): called only for a failure the server can't
   * have seen (an answer without one of our codes, or an error thrown inside
   * the layer), with the answer's request id when there was one. Never for
   * being offline, a cancelled call or a refusal. It must not throw.
   */
  readonly report?: (fault: DataFault) => void;
  /** A number from 0 to 1 that spreads rereads every tab makes at once. `Math.random` by default; tests pass 0. */
  readonly random?: () => number;
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
  realtimeUrl,
  onDefinitionsChange = () => undefined,
  onReplaced = () => undefined,
  onJobFinished = () => undefined,
  loadLive = () => import('./live/live.ts'),
  report = () => undefined,
  random = Math.random,
}: DataLayerOptions) {
  const api: ApiClient = createORPCClient(
    new RPCLink<CallContext>({
      url: new URL('/api/rpc', origin).href,
      fetch: async (request, init, { context }, path) => {
        const response = await fetch(request, init);
        const requestId = response.headers.get('x-request-id') ?? undefined;
        context.onAnswer?.({ procedure: path.join('.'), ...(requestId === undefined ? {} : { requestId }) });
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
  // Every object, archived ones too (settings lists them; the sidebar filters them out), in the workspace's order.
  let objects = new Map<string, Promise<ObjectSummary[]>>();
  let usage = new Map<string, Promise<Usage>>();
  let members = new Map<string, Promise<MemberSummary[]>>();
  let access = new Map<string, Promise<MyAccess>>();
  let attributes = new Map<string, Promise<AttributeDefinition[]>>();
  // The records layer, loaded with the first screen that shows records.
  let records: Promise<RecordsLayer> | undefined;
  // Records' timelines (spec 0017), loaded with the first record page.
  let activity: Promise<ActivityFeeds> | undefined;
  // Records looked up in the trash (spec 0017): a missing record's page.
  const trashedLookups = createTrashedLookups((workspace, recordId) =>
    call((options) => api.records.getTrashed({ workspace, recordId }, options)),
  );
  // Set by the first 401, so a burst of failed calls signs out once.
  let ended = false;
  // Live updates: loaded with the first watched workspace, and this tab's writes waiting for their echo.
  let live: Promise<Live> | undefined;
  const mutations = createMutationLog();
  // The stores' live handlers (spec 0007): what each kind of change, and a resync, asks of them.
  const router = createLiveRouter();
  // Each workspace's subscription token read before its first read: its head is the first watermark.
  let heads = new Map<string, Promise<Granted | undefined>>();
  let firstTokens = new Map<string, { readonly granted: Granted; readonly at: number }>();
  // Workspaces read without a head (the token call failed or took too long): their first watermark comes from
  // the live client's own token, with a resync of everything held, so nothing read before it is missed.
  let uncovered = new Set<string>();
  let liveStatus: LiveStatus = realtimeUrl === undefined ? 'off' : 'live';
  const liveListeners = new Set<() => void>();
  const setLiveStatus = (next: LiveStatus) => {
    if (next === liveStatus) return;
    liveStatus = next;
    for (const listener of liveListeners) listener();
  };
  const forget = () => {
    me = undefined;
    objects = new Map();
    usage = new Map();
    members = new Map();
    access = new Map();
    attributes = new Map();
    heads = new Map();
    firstTokens = new Map();
    uncovered = new Set();
    // Signed out: no more changes for the last person, and none of their writes to wait for.
    const stopping = live;
    live = undefined;
    mutations.clear();
    void stopping?.then((running) => {
      running.stop();
    });
    void records?.then((layer) => {
      layer.clear();
    });
    jobs.clear();
    void activity?.then((feeds) => {
      feeds.clear();
    });
    trashedLookups.clear();
  };
  const reset = () => {
    forget();
    ended = false;
    onSessionChange();
  };

  /** Hands a fault to monitoring, which never gets to break the call it came from. */
  const reportSafely = (fault: DataFault) => {
    try {
      report(fault);
    } catch {
      // Monitoring failed; the call's own failure still goes to the caller.
    }
  };

  /**
   * Runs one API call with a fresh context, mapping its failure to a
   * DataError that carries the answer's `Retry-After`.
   */
  async function attempt<T>(run: (options: CallOptions) => Promise<T>, signal?: AbortSignal): Promise<T> {
    let wait: number | undefined;
    let answer: { readonly requestId?: string; readonly procedure: string } | undefined;
    try {
      return await run({
        context: {
          onRetryAfter: (seconds) => {
            wait = seconds;
          },
          onAnswer: (answered) => {
            answer = answered;
          },
        },
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      if (signal?.aborted !== true && isUnseenFault(error)) reportSafely({ error, ...answer });
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
        // A write still waiting for its answer is lost with the session (its layer leaves with the records), so
        // the notice says so; read before forget() clears the log.
        const unsaved = mutations.unanswered();
        forget();
        notify({ tone: 'danger', message: unsaved ? ERROR_MESSAGES.signedOutUnsaved : ERROR_MESSAGES.signedOut });
        // Off to sign in first, then the app drops the last person's pages.
        onSignedOut(currentPath());
        onSessionChange();
      }
      throw failure;
    }
  }

  const auth = createAuth({ origin, fetch, reset, report: reportSafely });

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

  /**
   * Reads an object's cached attributes again (all of a workspace's when no
   * object is named), and runs `onDefinitionsChange` once when any list came
   * back different, so the app reloads its pages only for a real change.
   */
  const refreshAttributes = (workspace: string, objectId?: string): Promise<boolean> => {
    const prefix = `${workspace}/`;
    const held = [...attributes.entries()].filter(([key]) =>
      objectId === undefined ? key.startsWith(prefix) : key === objectKey(workspace, objectId),
    );
    const compared = held.map(async ([key, before]) => {
      attributes.delete(key);
      const fresh = cached(attributes, key, () =>
        call((options) => api.attributes.list({ workspace, objectId: key.slice(prefix.length) }, options)),
      );
      const [old, next] = await Promise.all([before.catch(() => undefined), fresh]);
      return JSON.stringify(old) !== JSON.stringify(next);
    });
    // Each list on its own: one that can no longer be read (its object archived) is a change, dropped from the
    // cache so the next page load asks again, and never hides another list's change.
    return Promise.allSettled(compared).then((results) =>
      results.some((result) => result.status === 'rejected' || result.value),
    );
  };

  /** The ids of the workspace's archived objects in a held list, sorted, to tell when the set changed. */
  const archivedIds = (list: readonly ObjectSummary[] | undefined): string =>
    (list ?? [])
      .filter((object) => object.isArchived)
      .map((object) => object.id)
      .sort()
      .join(',');

  /**
   * Reads the workspace's objects again (when held) and, only when the set of
   * archived objects changed, every held attribute list too: a reference to
   * an archived object is archived itself (spec 0012), while a rename,
   * restyle or move changes no attribute. Answers whether anything changed.
   */
  const refreshObjects = async (workspace: string): Promise<boolean> => {
    const before = await objects.get(workspace)?.catch(() => undefined);
    const changed = await refreshHeld(objects, workspace, () => allObjects(workspace));
    if (!changed) return false;
    const after = await objects.get(workspace)?.catch(() => undefined);
    if (archivedIds(before) !== archivedIds(after)) await refreshAttributes(workspace);
    return true;
  };

  /**
   * Drops the held usage (when held) instead of reading it again: only the
   * settings pages show it, and their next load reads it once. Answers
   * whether one was held, so the pages reload and that read happens now.
   */
  const dropUsage = (workspace: string): boolean => usage.delete(workspace);

  /** Runs `onDefinitionsChange` once when any of the comparisons found a list that came back different. */
  const reloadIfChanged = (comparisons: readonly Promise<boolean>[]): void => {
    void Promise.all(comparisons).then((changes) => {
      if (changes.includes(true)) onDefinitionsChange();
    });
  };

  /**
   * Reads the workspace's head (with a subscription token) once per app load,
   * when live updates are on: the first watermark, read before any of the
   * workspace's reads, so a write that commits while they are in flight is
   * caught up. Without a session or membership it answers nothing and ends no
   * session; a failure is forgotten, so the next read asks again.
   */
  const prepare = (workspace: string): Promise<Granted | undefined> => {
    if (realtimeUrl === undefined) return Promise.resolve(undefined);
    const hit = heads.get(workspace);
    if (hit !== undefined) return hit;
    const asking: Promise<Granted | undefined> = attempt((options) =>
      api.realtime.subscriptionToken({ workspace }, options),
    ).then(
      (granted) => {
        if (heads.get(workspace) === asking) firstTokens.set(workspace, { granted, at: Date.now() });
        return granted;
      },
      () => {
        if (heads.get(workspace) === asking) heads.delete(workspace);
        return undefined;
      },
    );
    heads.set(workspace, asking);
    return asking;
  };

  /**
   * Waits for the workspace's head before a read, at most 5 seconds; nothing
   * waits when live is off. A read that goes ahead without it (the call
   * failed, or the wait ran out) marks the workspace uncovered, and later
   * reads stop waiting: the live client resyncs it once it listens.
   */
  const beforeRead = async (workspace: string): Promise<void> => {
    if (realtimeUrl === undefined || uncovered.has(workspace)) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const covered = await Promise.race([
      prepare(workspace).then((granted) => granted !== undefined),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => {
          resolve(false);
        }, HEAD_WAIT_MS);
      }),
    ]);
    clearTimeout(timeout);
    if (!covered) uncovered.add(workspace);
  };

  /** Live updates, loaded the first time a screen watches a workspace. */
  const loadedLive = (url: string): Promise<Live> => {
    live ??= loadLive().then(({ createLive }) =>
      createLive({
        url,
        connectionToken: async () => {
          try {
            return (await call((options) => api.realtime.connectionToken(undefined, options))).token;
          } catch (error) {
            // Signed out: stop asking (the layer already went to sign in). Anything else: try again later.
            if (toDataError(error).code === 'UNAUTHENTICATED') return undefined;
            throw error;
          }
        },
        subscriptionToken: async (workspace) => {
          // The token read with the head, once, while it is fresh.
          const first = firstTokens.get(workspace);
          firstTokens.delete(workspace);
          if (first !== undefined && Date.now() - first.at < FIRST_TOKEN_MS) return first.granted;
          try {
            return await call((options) => api.realtime.subscriptionToken({ workspace }, options));
          } catch (error) {
            const { code } = toDataError(error);
            if (code === 'UNAUTHENTICATED' || code === 'NOT_FOUND') return undefined;
            throw error;
          }
        },
        // No head when a read went ahead without one: the live client then starts from its token and resyncs.
        head: async (workspace) => {
          const granted = await prepare(workspace);
          return uncovered.has(workspace) ? undefined : granted?.head;
        },
        catchUp: async (workspace, after) => {
          try {
            return await call((options) => api.realtime.catchUp({ workspace, after }, options));
          } catch (error) {
            const { code } = toDataError(error);
            if (code === 'UNAUTHENTICATED' || code === 'NOT_FOUND') return undefined;
            throw error;
          }
        },
        mutations,
        onStatus: setLiveStatus,
        router,
      }),
    );
    return live;
  };

  /**
   * Reads a cached per workspace list again when one is held (nothing when
   * not: the next read loads it fresh), and runs `onDefinitionsChange` when
   * it came back different, so the app reloads its pages only for a real
   * change.
   */
  const refreshHeld = <T>(
    cache: Map<string, Promise<T>>,
    workspace: string,
    load: () => Promise<T>,
  ): Promise<boolean> => {
    const before = cache.get(workspace);
    if (before === undefined) return Promise.resolve(false);
    cache.delete(workspace);
    return Promise.all([before.catch(() => undefined), load()]).then(
      ([old, next]) => JSON.stringify(old) !== JSON.stringify(next),
      // Unreadable now: dropped from the cache, so the next read asks again.
      () => false,
    );
  };

  // Rereads waiting out their spread, by what they reread: a burst of events costs one read, and every tab of a
  // workspace doesn't ask at the same moment (a role change reaches every member at once).
  const spreading = new Set<string>();
  const spread = (key: string, work: () => void): void => {
    if (spreading.has(key)) return;
    spreading.add(key);
    setTimeout(
      () => {
        spreading.delete(key);
        work();
      },
      Math.round(random() * SPREAD_MS),
    );
  };
  const readMembers = (workspace: string) =>
    cached(members, workspace, () => call((options) => api.members.list({ workspace }, options)));
  const readAccess = (workspace: string) =>
    cached(access, workspace, () => call((options) => api.access.mine({ workspace }, options)));
  /** Whether `memberIds` names the person, by the access this tab holds (unknown counts as named). */
  const namesMe = async (workspace: string, memberIds: readonly string[]): Promise<boolean> => {
    const mine = await access.get(workspace)?.catch(() => undefined);
    return mine === undefined || memberIds.includes(mine.memberId);
  };

  // The stores' handlers (spec 0007, milestone 2): records refetch the named rows (or everything held of the
  // object when coarse) and settle on the ones made, deleted or restored; definitions an object's attributes,
  // and the workspace's objects when the object itself changed or none is named; members the member list (and
  // the person's own access when it names them); access, naming the person, everything held; and a resync
  // everything held of the workspace. Entries have no store yet: no screen shows lists.
  router.on('records', (workspace, event) => {
    void records?.then((layer) => {
      if (event.coarse === true) layer.reload(workspace, event.objectId);
      else layer.changed(workspace, event.objectId, event.recordIds, event.attributeIds, event);
      // What the write replaced (spec 0006): a notice for the values this tab wrote.
      if (event.replaced !== undefined) layer.replaced(workspace, event);
    });
  });
  router.on('definitions', (workspace, event) => {
    // A list's own definitions: no screen holds lists yet.
    if (event.listId !== undefined) return;
    // Any definition change may move a count the settings meters show (spec 0012, AC-243): a held usage is
    // dropped, and the pages reload once so a settings page reads it again.
    const counted = Promise.resolve(dropUsage(workspace));
    if (event.objectId !== undefined && event.attributeIds !== undefined) {
      reloadIfChanged([refreshAttributes(workspace, event.objectId), counted]);
    } else if (event.objectId !== undefined) {
      // The object itself was made, renamed, restyled, moved, archived or restored (spec 0012), or a catch up
      // collapsed its attribute changes: its own attributes, the workspace's objects, and every other held
      // attribute list only when an object was archived or restored. One reload at most.
      reloadIfChanged([refreshAttributes(workspace, event.objectId), refreshObjects(workspace), counted]);
    } else {
      objects.delete(workspace);
      void refreshAttributes(workspace);
      onDefinitionsChange();
    }
  });
  router.on('members', (workspace, event) => {
    // Every member's tab hears a role change at once: spread, and one read for a burst.
    spread(`members ${workspace}`, () => {
      reloadIfChanged([refreshHeld(members, workspace, () => readMembers(workspace))]);
    });
    // A role changed may be the person's own: their access is read again (the server checks every call anyway).
    void namesMe(workspace, event.memberIds).then((named) => {
      if (!named) return;
      spread(`access ${workspace}`, () => {
        reloadIfChanged([refreshHeld(access, workspace, () => readAccess(workspace))]);
      });
    });
  });
  router.on('access', (workspace, event) => {
    // The person's access changed: everything held is read again under it (spec 0009, AC-146; milestone 4 adds
    // the new channel and the 4500 disconnect).
    void namesMe(workspace, event.memberIds).then((named) => {
      if (!named) return;
      spread(`resync ${workspace}`, () => {
        access.delete(workspace);
        router.resync(workspace);
      });
    });
  });
  router.on('jobs', (workspace, event) => {
    jobs.changed(workspace, event);
  });
  router.onResync((workspace) => {
    jobs.resync(workspace);
    void records?.then((layer) => {
      layer.reload(workspace);
    });
    void refreshAttributes(workspace);
    // The workspace's objects, usage and members are read again on the next page load, which a resync asks for.
    objects.delete(workspace);
    usage.delete(workspace);
    members.delete(workspace);
    onDefinitionsChange();
  });

  /** Listens to a workspace's changes while a view of it is open; the answer stops. Nothing when live is off. */
  const watch = (workspace: string): (() => void) => {
    if (realtimeUrl === undefined) return () => undefined;
    const url = realtimeUrl;
    let release: (() => void) | undefined;
    let isReleased = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const attempt = (failures: number) => {
      loadedLive(url).then(
        (running) => {
          if (isReleased) return;
          setLiveStatus(running.status());
          release = running.watch(workspace);
        },
        () => {
          // The live client didn't load (offline): paused, and tried again, later each time.
          live = undefined;
          setLiveStatus('paused');
          if (isReleased) return;
          retry = setTimeout(
            () => {
              attempt(failures + 1);
            },
            Math.min(30_000, 1000 * 2 ** failures),
          );
        },
      );
    };
    attempt(0);
    return () => {
      isReleased = true;
      clearTimeout(retry);
      release?.();
    };
  };

  // Background jobs (spec 0008): one store for the app, its views per workspace and scope.
  const jobs = createJobsStore({
    api: {
      list: (input) =>
        beforeRead(input.workspace).then(() =>
          call((options) =>
            api.jobs.list(
              {
                workspace: input.workspace,
                scope: input.scope,
                ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
              },
              options,
            ),
          ),
        ),
      get: (input) => call((options) => api.jobs.get(input, options)),
      cancel: (input) => call((options) => api.jobs.cancel(input, options)),
      startTest: (input) => call((options) => api.jobs.startTest(input, options)),
    },
    mintId,
    mutations,
    notify,
    watch,
    memberOf: (workspace) =>
      readAccess(workspace).then(
        (mine) => mine.memberId,
        () => undefined,
      ),
    spread,
    onFinished: onJobFinished,
  });

  const recordsApi: RecordsApi = {
    query: (input, signal) =>
      call((options) => api.records.query({ ...input, attributeIds: [...input.attributeIds] }, options), signal),
    count: (input, signal) => call((options) => api.records.count(input, options), signal),
    get: (input) =>
      call((options) =>
        api.records.get(
          {
            workspace: input.workspace,
            ids: [...input.ids],
            ...(input.attributeIds === undefined ? {} : { attributeIds: [...input.attributeIds] }),
          },
          options,
        ),
      ),
    create: (input) => call((options) => api.records.create(input, options)),
    setValues: (input) => call((options) => api.records.setValues(input, options)),
    setValuesBatch: (input) => call((options) => api.records.setValuesBatch(input, options)),
  };

  /** An attribute's title, from the cached list of its object (empty when it can't be read). */
  const attributeTitle = async (workspace: string, objectId: string, attributeId: string): Promise<string> => {
    const list = await cached(attributes, objectKey(workspace, objectId), () =>
      call((options) => api.attributes.list({ workspace, objectId }, options)),
    ).catch(() => []);
    return list.find((attribute) => attribute.id === attributeId)?.title ?? '';
  };

  /**
   * A member's name from the cached member list; one the list doesn't hold
   * (someone who joined after it was read) reads the list once more.
   */
  const memberName = async (workspace: string, memberId: string | null): Promise<string | undefined> => {
    const read = () =>
      cached(members, workspace, () => call((options) => api.members.list({ workspace }, options))).catch(() => []);
    const found = (await read()).find((member) => member.id === memberId);
    if (found !== undefined || memberId === null) return found?.name;
    members.delete(workspace);
    return (await read()).find((member) => member.id === memberId)?.name;
  };

  /** A replaced notice from the records layer, with its names read from the cached definitions. */
  const tellReplaced = async (notice: ReplacedNotice): Promise<void> => {
    const [first = '', ...rest] = notice.attributeIds;
    const title = await attributeTitle(notice.workspace, notice.objectId, first);
    const by = notice.by;
    const who: ReplacedValue['by'] =
      by.type === 'member' ? { kind: 'member', name: await memberName(notice.workspace, by.id) } : { kind: by.type };
    onReplaced({
      workspace: notice.workspace,
      recordId: notice.recordId,
      recordName: notice.recordName,
      attributeTitle: title,
      others: rest.length,
      by: who,
      useMine: notice.useMine,
    });
  };

  /**
   * Every object of the workspace, archived ones too, in its order (spec
   * 0012), cached for the app load. A non member gets the same `NOT_FOUND`
   * as an unknown address, which also drops the cached `me`: the person may
   * have just left it, so `/` asks again.
   */
  function allObjects(workspace: string): Promise<ObjectSummary[]> {
    const cached = objects.get(workspace);
    if (cached !== undefined) return cached;
    const loading = beforeRead(workspace).then(() =>
      call((options) => api.objects.list({ workspace, includeArchived: true }, options)),
    );
    objects.set(workspace, loading);
    loading.catch((error: unknown) => {
      if (objects.get(workspace) === loading) objects.delete(workspace);
      if (toDataError(error).code === 'NOT_FOUND') me = undefined;
    });
    return loading;
  }

  /** The workspace's live objects in its order (the sidebar's), from the same cached list. */
  function listObjects(workspace: string): Promise<ObjectSummary[]> {
    return allObjects(workspace).then((all) => all.filter((object) => !object.isArchived));
  }

  /** The workspace's usage of its limits (spec 0012, AC-243), cached until a definition changes. */
  function readUsage(workspace: string): Promise<Usage> {
    return cached(usage, workspace, () =>
      beforeRead(workspace).then(() => call((options) => api.usage.get({ workspace }, options))),
    );
  }

  /**
   * Runs one object write (spec 0012): server confirmed, never optimistic.
   * Its echo is skipped (one definitions event), and once it lands the
   * workspace's objects, usage and held attributes are read again and the
   * app reloads its pages, so this tab shows the change as every other tab
   * does.
   */
  async function writeObject<T>(
    workspace: string,
    write: (mutationId: string, options: CallOptions) => Promise<T>,
    effects: {
      /** An archive or restore: references to the object change, so every held attribute list is read again. */
      readonly archives?: boolean;
      /** The workspace's objects as the answer already holds them (a move answers the whole new order). */
      readonly objectsOf?: (answer: T) => ObjectSummary[];
    } = {},
  ) {
    const mutationId = mintId();
    mutations.sent(mutationId);
    try {
      const answer = await call((options) => write(mutationId, options));
      mutations.answered(mutationId, 1);
      const known = effects.objectsOf?.(answer);
      if (known === undefined) objects.delete(workspace);
      else objects.set(workspace, Promise.resolve(known));
      usage.delete(workspace);
      if (effects.archives === true) await refreshAttributes(workspace);
      onDefinitionsChange();
      return answer;
    } catch (error) {
      mutations.forget(mutationId);
      throw error;
    }
  }

  /** An object's primary attribute and its attributes' kinds, for a window's mode (spec 0006, from the cached lists). */
  const describeObject = async (workspace: string, objectId: string): Promise<ObjectShape> => {
    const [list, defined] = await Promise.all([
      listObjects(workspace),
      cached(attributes, objectKey(workspace, objectId), () =>
        beforeRead(workspace).then(() => call((options) => api.attributes.list({ workspace, objectId }, options))),
      ),
    ]);
    const primary = list.find((object) => object.id === objectId)?.primaryAttributeId ?? undefined;
    return {
      ...(primary === undefined ? {} : { primaryAttributeId: primary }),
      attributes: defined.map(({ id, type, isSystem, apiSlug, title }) => ({ id, type, isSystem, apiSlug, title })),
    };
  };

  const activityFeeds = (): Promise<ActivityFeeds> => {
    activity ??= import('./activity/feed.ts').then(({ createActivityFeeds }) =>
      createActivityFeeds({
        page: (workspace, recordId, cursor) =>
          beforeRead(workspace).then(() =>
            call((options) =>
              api.records.activity({ workspace, recordId, ...(cursor === undefined ? {} : { cursor }) }, options),
            ),
          ),
        members: (workspace, fresh) => {
          if (fresh) members.delete(workspace);
          return readMembers(workspace);
        },
      }),
    );
    return activity;
  };

  const recordsLayer = (): Promise<RecordsLayer> => {
    records ??= import('./records/layer.ts').then(({ createRecordsLayer }) =>
      createRecordsLayer({
        api: recordsApi,
        notify,
        mintId,
        watch,
        mutations,
        beforeRead,
        // The person's member id in the workspace (cached with their role), so their own saves raise no notice.
        memberOf: (workspace) =>
          cached(access, workspace, () => call((options) => api.access.mine({ workspace }, options))).then(
            (mine) => mine.memberId,
            () => undefined,
          ),
        onReplaced: (notice) => {
          void tellReplaced(notice);
        },
        describe: describeObject,
      }),
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
       * The workspace's live objects in its order (the sidebar's), cached for
       * the app load. A non member gets the same `NOT_FOUND` as an unknown
       * address, which also drops the cached `me`: the person may have just
       * left it, so `/` asks again.
       */
      list: listObjects,
      /** Every object, archived ones too, in the workspace's order (settings, an archived object's page). */
      all: allObjects,
      /** A new object's id: mint it once per dialog, and send the same one again on a retry. */
      newId: () => mintId(),
      /**
       * Creates a custom object and waits for the server (spec 0012, AC-223).
       * Refusals: `SLUG_TAKEN` (field `apiSlug`), `NAME_TAKEN` (on the name it
       * names), `CONFIG_INVALID` (on its field), `LIMIT_REACHED`, `FORBIDDEN`.
       */
      create: (workspace: string, input: NewObject): Promise<ObjectSummary> =>
        writeObject(workspace, (mutationId, options) =>
          api.objects.create(
            {
              workspace,
              id: input.id,
              singularName: input.singularName,
              pluralName: input.pluralName,
              ...(input.apiSlug === undefined ? {} : { apiSlug: input.apiSlug }),
              icon: input.icon,
              hue: input.hue,
              mutationId,
            },
            options,
          ),
        ),
      /** Renames or restyles an object (AC-224), waiting for the server. Refusals: `NAME_TAKEN`, `CONFIG_INVALID`. */
      update: (workspace: string, objectId: string, changes: ObjectChanges): Promise<ObjectSummary> =>
        writeObject(workspace, (mutationId, options) =>
          api.objects.update({ workspace, objectId, ...changes, mutationId }, options),
        ),
      /** Moves an object to `position` in the workspace's order (AC-225), archived objects counted. */
      reorder: (workspace: string, objectId: string, position: number): Promise<ObjectSummary[]> =>
        writeObject(
          workspace,
          (mutationId, options) => api.objects.reorder({ workspace, objectId, position, mutationId }, options),
          { objectsOf: (order) => order },
        ),
      /** Archives an object (AC-226): it leaves the sidebar; its records stay. */
      archive: (workspace: string, objectId: string): Promise<ObjectSummary> =>
        writeObject(
          workspace,
          (mutationId, options) => api.objects.archive({ workspace, objectId, mutationId }, options),
          { archives: true },
        ),
      /** Restores an archived object (AC-226), at its old place. */
      restore: (workspace: string, objectId: string): Promise<ObjectSummary> =>
        writeObject(
          workspace,
          (mutationId, options) => api.objects.restore({ workspace, objectId, mutationId }, options),
          { archives: true },
        ),
    },
    usage: {
      /**
       * The workspace's usage of its limits (spec 0012, AC-243): the custom
       * object meter for owners and admins, each object's attribute count.
       * Cached until a definition changes.
       */
      get: readUsage,
    },
    members: {
      /** The workspace's active members, by name: the Owner column's names. Cached for the app load. */
      list: (workspace: string): Promise<MemberSummary[]> =>
        cached(members, workspace, () =>
          beforeRead(workspace).then(() => call((options) => api.members.list({ workspace }, options))),
        ),
    },
    access: {
      /**
       * The person's own role, its label and their permissions in a workspace
       * (spec 0009, AC-136), cached for the app load. Screens use it only to
       * hide controls the person can't use; the server checks every call.
       */
      mine: (workspace: string): Promise<MyAccess> =>
        cached(access, workspace, () =>
          beforeRead(workspace).then(() => call((options) => api.access.mine({ workspace }, options))),
        ),
    },
    attributes: {
      /** An object's live attributes in position order, system ones marked. Cached until an attribute is added. */
      list: (workspace: string, objectId: string): Promise<AttributeDefinition[]> =>
        cached(attributes, objectKey(workspace, objectId), () =>
          beforeRead(workspace).then(() => call((options) => api.attributes.list({ workspace, objectId }, options))),
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
        const mutationId = mintId();
        mutations.sent(mutationId);
        try {
          const made = await call((options) => api.attributes.create({ workspace, ...input, mutationId }, options));
          // It stored one definitions row: one echo.
          mutations.answered(mutationId, 1);
          attributes.delete(objectKey(workspace, input.objectId));
          return made;
        } catch (error) {
          mutations.forget(mutationId);
          throw error;
        }
      },
    },
    records: {
      /**
       * An object's records for one screen (the same view for every screen
       * that asks), settled once its count and first block are in or failed.
       * The router loader awaits it; the screen reads it through `useView`.
       */
      async view(
        workspace: string,
        objectId: string,
        query: ViewQuery = {},
        attributeIds: readonly string[] = [],
      ): Promise<RecordsView> {
        const view = (await recordsLayer()).view(workspace, objectId, query, attributeIds);
        await view.ready();
        return view;
      },
      /**
       * The same view, answered as soon as it exists, settled or not, after
       * waiting at most `graceMs` for it to settle: a quick load arrives with
       * its rows, and a slow one hands the screen a loading view at once, so
       * the table draws its header and loading rows in place rather than a
       * page sized placeholder that jumps when the rows come.
       */
      async open(
        workspace: string,
        objectId: string,
        query: ViewQuery = {},
        attributeIds: readonly string[] = [],
        graceMs = 0,
      ): Promise<RecordsView> {
        const view = (await recordsLayer()).view(workspace, objectId, query, attributeIds);
        if (graceMs > 0) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            view.ready(),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, graceMs);
            }),
          ]);
          clearTimeout(timer);
        }
        return view;
      },
      /** A new record's id: mint it once per form, and send the same one on every try, so nothing is made twice. */
      newId: () => mintId(),
      /**
       * How many live records an object holds (spec 0012: the archive
       * confirm says so), with `atLeast` when the server capped it (a record
       * rule, spec 0009). One count, never cached: it is asked for once per
       * confirm.
       */
      count: (workspace: string, objectId: string): Promise<{ readonly count: number; readonly atLeast: boolean }> =>
        beforeRead(workspace).then(() => call((options) => api.records.count({ workspace, objectId }, options))),
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
        void recordsLayer().then((layer) => layer.setValues(workspace, [change], 'cell'));
      },
      /**
       * Edits cells as one action (spec 0006): a cell, a paste or a range
       * clear, as one write (one batch for up to 500 records; more is refused
       * before anything shows, `too-many`). Each record's cells show at once
       * and land or roll back on their own; what lands can be undone. The
       * answer says how many cells landed, for the "Pasted into 40 cells" toast.
       */
      setValues: async (workspace: string, changes: readonly CellChange[], kind?: UndoKind): Promise<EditOutcome> =>
        (await recordsLayer()).setValues(workspace, changes, kind),
      /**
       * One record with the attributes a screen shows (spec 0006, `records.one`;
       * the record page, spec 0017): served from the store every table reads
       * (one body), held while subscribed, reading only what it lacks, patched
       * live, and `deleted` when it goes away (`isLost` once it was shown).
       * Answered once the records layer is loaded; `ready()` settles with the
       * first read. Read it through `useRecord`.
       */
      one: async (workspace: string, recordId: string, attributeIds: RecordAttributes): Promise<RecordSubscription> =>
        (await recordsLayer()).one(workspace, recordId, attributeIds),
      /**
       * A record `one` found missing (spec 0017): in the trash and visible to
       * the reader, or unavailable (missing or hidden, one answer), asked on
       * its first subscriber and kept for the session. The trashed body is
       * never put in the store, so no table shows it. Read it through
       * `useTrashed`.
       */
      trashed: (workspace: string, recordId: string): TrashedSource => trashedLookups.lookup(workspace, recordId),
    },
    activity: {
      /**
       * A record's timeline, newest first (spec 0017): pages of `records.activity`
       * mapped to the feed's entries, who did it named from the members. One
       * per record, shared with `recent`. Read it through `useActivity`.
       */
      forRecord: async (workspace: string, recordId: string): Promise<ActivityFeed> =>
        (await activityFeeds()).forRecord(workspace, recordId),
      /** The same timeline cut to its newest five entries (Overview's "Recent activity"), sharing the first page. */
      recent: async (workspace: string, recordId: string): Promise<ActivityFeed> =>
        (await activityFeeds()).recent(workspace, recordId),
    },
    undo: {
      /**
       * Undoes this tab's last confirmed change in the workspace (spec 0006,
       * AC-48, AC-49): one cell, or every cell of one paste or range clear, up
       * to 50 back. Each cell goes back only if nobody changed it since
       * (checked on the server); the answer says how many went back and how
       * many were kept, for the screen's toast.
       */
      run: async (workspace: string, only?: string): Promise<UndoResult> => {
        const outcome = await (await recordsLayer()).undo.run(workspace, only);
        if (outcome.kind !== 'undone') return outcome;
        return {
          ...outcome,
          attributeTitle: await attributeTitle(workspace, outcome.objectId, outcome.first.attributeId),
        };
      },
    },
    jobs: {
      /**
       * A workspace's background jobs for `scope` (`mine`, or `all` for
       * holders of `jobs.manage`), the same view for every screen that asks:
       * unfinished first, then the newest, 50 at a time, live while a screen
       * retains it (`useJobs`).
       */
      view: (workspace: string, scope: JobsScope): JobsView => jobs.view(workspace, scope),
      /** A new job id: mint it once per form, and send the same one on a retry. */
      newId: () => jobs.newId(),
      /**
       * Starts a test job (local and previews only; production answers
       * NOT_FOUND). Its end raises `onJobFinished` while the app is open.
       */
      startTest: (workspace: string, id: string, settings: TestJobSettings): Promise<JobView> =>
        jobs.startTest(workspace, id, settings),
      /** Cancels a job at once on screen; a refusal puts it back with a toast. Answers whether it landed. */
      cancel: (workspace: string, jobId: string): Promise<boolean> => jobs.cancel(workspace, jobId),
    },
    live: {
      /**
       * Whether other people's changes are arriving: `live`, `paused` while the
       * connection or a subscription is down (screens say so quietly), or
       * `off` where live updates aren't configured (previews, which show
       * nothing about it).
       */
      status: (): LiveStatus => liveStatus,
      /**
       * Reads the workspace's head before its screens read anything (spec
       * 0007): the route loader calls it beside `me.get`, so the first reads
       * rarely wait. Nothing when live is off; never throws.
       */
      prepare: (workspace: string): void => {
        void prepare(workspace);
      },
      /** Calls `listener` whenever `status()` changes; the answer stops. */
      subscribe: (listener: () => void): (() => void) => {
        liveListeners.add(listener);
        return () => {
          liveListeners.delete(listener);
        };
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
