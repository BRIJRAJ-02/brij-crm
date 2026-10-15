// `data.views` (spec 0020, milestone 1): an object's saved views as the
// switcher lists them, and each view whole, one copy per view id shared by
// every screen. Lists hold ids and summaries; bodies hold the config. A live
// `views` event naming ids reads the object's list again and each named body
// held; a coarse one (a private view's change, or a delete, on a channel not
// everyone may see) reads the list, then only the held bodies whose version
// in the list moved, and treats a held view gone from the list as not found.
// Both are coalesced at most once a second per object: the first at once,
// the next after a random 0 to 2 seconds. A body is replaced only by a read
// with a version at least the one held (spec 0006's revision rule, for
// views). Saving a query waits for the server.
//
// Plain TypeScript with no runtime imports beyond the layer's own, so it sits
// in the first load.
import type { FilterGroup, SortRule, View, ViewsList, ViewSummary } from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import type { MutationLog } from '../live/mutations.ts';
import type { LiveEventOf } from '../live/router.ts';

/** How long, at least, between two rereads of one object's views (spec 0020: at most once a second). */
export const VIEWS_COALESCE_MS = 1000;

/** The longest random wait before a coalesced reread (spec 0006 AC-61's 0 to 2 seconds). */
export const VIEWS_JITTER_MS = 2000;

/** The calls the views store makes, each mapped to a DataError by the layer. */
export interface ViewsApi {
  readonly list: (input: { readonly workspace: string; readonly objectId: string }) => Promise<ViewsList>;
  readonly get: (input: { readonly workspace: string; readonly viewId: string }) => Promise<View>;
  readonly saveQuery: (input: {
    readonly workspace: string;
    readonly viewId: string;
    readonly filter?: FilterGroup;
    readonly sorts: readonly SortRule[];
    readonly baseQueryVersion: number;
    readonly force?: boolean;
    readonly mutationId: string;
  }) => Promise<View>;
}

/** What the views store needs from the layer. */
export interface ViewsDeps {
  readonly api: ViewsApi;
  readonly mintId: () => string;
  readonly mutations: MutationLog;
  /** Listens to a workspace's change events; the answer stops. */
  readonly watch: (workspace: string) => () => void;
  /** A random number in [0, 1), for the jitter (tests pass their own). */
  readonly random?: () => number;
  /** Runs `work` after `ms` (tests pass their own); the answer cancels it. */
  readonly after?: (ms: number, work: () => void) => () => void;
}

/** An object's views, as the switcher shows them. */
export interface ViewsListSnapshot {
  /** `loading` before the first read, `error` when it failed, `not-found` for an object the person can't see. */
  readonly status: 'loading' | 'ready' | 'error' | 'not-found';
  /** In switcher order: the default, the other shared views, then the person's private views. */
  readonly views: readonly ViewSummary[];
  readonly defaultViewId?: string;
  readonly lastOpenedViewId?: string;
  readonly error?: DataError;
}

/** One view whole. */
export interface SavedViewSnapshot {
  /** `not-found` for a view that doesn't exist or isn't the person's to see (never saying which). */
  readonly status: 'loading' | 'ready' | 'error' | 'not-found';
  readonly view?: View;
  readonly error?: DataError;
}

/** Something a screen holds while it shows it, and reads through useSyncExternalStore. */
export interface ViewsSource<Snapshot> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => Snapshot;
  /** Holds it (and listens to the workspace's changes) while a screen shows it; the answer lets go. */
  readonly retain: () => () => void;
  /** Settles once the first read is in (or failed). */
  readonly ready: () => Promise<void>;
  /** Reads it again (Retry). */
  readonly retry: () => Promise<void>;
}

/** An object's views. */
export type ViewsListSource = ViewsSource<ViewsListSnapshot>;
/** One view. */
export type SavedViewSource = ViewsSource<SavedViewSnapshot>;

/** A query to save as a view's own. */
export interface SaveQueryInput {
  readonly filter?: FilterGroup | undefined;
  readonly sorts: readonly SortRule[];
  /** The view's `queryVersion` when the draft began. */
  readonly baseQueryVersion: number;
  /** Replace a query someone else saved since (the clash dialog's Replace). */
  readonly force?: boolean;
}

const LOADING_LIST: ViewsListSnapshot = Object.freeze({ status: 'loading', views: Object.freeze([]) });
const LOADING_VIEW: SavedViewSnapshot = Object.freeze({ status: 'loading' });

/** A source's shared parts: listeners, holders, the workspace's watch, the first read. */
function createSource<Snapshot>(
  watch: () => () => void,
  initial: Snapshot,
  read: () => Promise<void>,
): {
  readonly api: ViewsSource<Snapshot>;
  readonly set: (next: Snapshot) => void;
  readonly get: () => Snapshot;
  readonly isRetained: () => boolean;
  readonly reread: () => Promise<void>;
} {
  let snapshot = initial;
  let held = 0;
  let release: (() => void) | undefined;
  let first: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const set = (next: Snapshot) => {
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const reread = () => {
    const reading = read();
    first ??= reading;
    return reading;
  };
  return {
    set,
    get: () => snapshot,
    isRetained: () => held > 0,
    reread,
    api: {
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: () => snapshot,
      retain() {
        held += 1;
        if (held === 1) release = watch();
        let released = false;
        return () => {
          if (released) return;
          released = true;
          held -= 1;
          if (held === 0) {
            release?.();
            release = undefined;
          }
        };
      },
      ready: () => first ?? reread(),
      retry: () => reread(),
    },
  };
}

/** The views store: every workspace's views lists and bodies, kept fresh by live events. */
export function createViewsStore(deps: ViewsDeps) {
  const random = deps.random ?? Math.random;
  const after =
    deps.after ??
    ((ms: number, work: () => void) => {
      const timer = setTimeout(work, ms);
      return () => {
        clearTimeout(timer);
      };
    });
  const lists = new Map<string, ReturnType<typeof makeList>>();
  const bodies = new Map<string, ReturnType<typeof makeBody>>();
  // Per workspace and object: the coalescing window, and whether a reread waits for its end.
  const windows = new Map<string, { pending: boolean; coarse: boolean; named: Set<string>; cancel: () => void }>();

  const key = (workspace: string, id: string) => `${workspace}\u0000${id}`;

  function makeList(workspace: string, objectId: string) {
    const source = createSource<ViewsListSnapshot>(
      () => deps.watch(workspace),
      LOADING_LIST,
      async () => {
        try {
          const answer = await deps.api.list({ workspace, objectId });
          source.set({
            status: 'ready',
            views: answer.views,
            ...(answer.defaultViewId === undefined ? {} : { defaultViewId: answer.defaultViewId }),
            ...(answer.lastOpenedViewId === undefined ? {} : { lastOpenedViewId: answer.lastOpenedViewId }),
          });
        } catch (failed) {
          const error = toDataError(failed);
          const held = source.get();
          // A list already shown stays on a passing failure; an object gone answers not found.
          if (error.code === 'NOT_FOUND') source.set({ status: 'not-found', views: [], error });
          else if (held.status !== 'ready') source.set({ status: 'error', views: [], error });
        }
      },
    );
    return { ...source, objectId };
  }

  function makeBody(workspace: string, viewId: string) {
    const source = createSource<SavedViewSnapshot>(
      () => deps.watch(workspace),
      LOADING_VIEW,
      async () => {
        try {
          put(workspace, await deps.api.get({ workspace, viewId }));
        } catch (failed) {
          const error = toDataError(failed);
          if (error.code === 'NOT_FOUND') source.set({ status: 'not-found', error });
          else if (source.get().view === undefined) source.set({ status: 'error', error });
        }
      },
    );
    return source;
  }

  /** A view read or saved: replaces the held body unless that one is newer (the revision rule, for views). */
  const put = (workspace: string, view: View, force = false) => {
    const body = bodyOf(workspace, view.id);
    const held = body.get().view;
    if (!force && held !== undefined && held.version > view.version) return;
    body.set({ status: 'ready', view });
  };

  const listOf = (workspace: string, objectId: string) => {
    const found = lists.get(key(workspace, objectId));
    if (found !== undefined) return found;
    const made = makeList(workspace, objectId);
    lists.set(key(workspace, objectId), made);
    return made;
  };

  const bodyOf = (workspace: string, viewId: string) => {
    const found = bodies.get(key(workspace, viewId));
    if (found !== undefined) return found;
    const made = makeBody(workspace, viewId);
    bodies.set(key(workspace, viewId), made);
    return made;
  };

  /** The held bodies of one workspace whose view is on `objectId`. */
  const bodiesOn = (workspace: string, objectId: string) =>
    [...bodies.entries()].flatMap(([bodyKey, body]) =>
      bodyKey.startsWith(`${workspace}\u0000`) && body.get().view?.objectId === objectId ? [body] : [],
    );

  /**
   * Reads one object's views again after a change: its list (when held),
   * then the bodies the event named, or (coarse) the held bodies whose
   * version in the list moved and those gone from it, which become not found.
   */
  const refresh = async (workspace: string, objectId: string, coarse: boolean, named: ReadonlySet<string>) => {
    const list = lists.get(key(workspace, objectId));
    if (list !== undefined) await list.reread();
    const listed = list?.get();
    const held = bodiesOn(workspace, objectId);
    for (const body of held) {
      const view = body.get().view;
      if (view === undefined) continue;
      if (!coarse) {
        if (named.has(view.id)) void body.reread();
        continue;
      }
      if (listed === undefined || listed.status !== 'ready') {
        // No list to compare with: read the body itself.
        void body.reread();
        continue;
      }
      const summary = listed.views.find((each) => each.id === view.id);
      if (summary === undefined) body.set({ status: 'not-found' });
      else if (summary.version !== view.version) void body.reread();
    }
    // A named view held but not yet loaded with its object (opened by id) reads too.
    for (const id of named) {
      const body = bodies.get(key(workspace, id));
      if (body !== undefined && body.get().view === undefined) void body.reread();
    }
  };

  /**
   * Coalesces rereads per object: the first event reads at once and opens a
   * one second window; events inside it wait for its end, then read once
   * after a random 0 to 2 seconds more, opening the next window.
   */
  const changed = (workspace: string, objectId: string, coarse: boolean, viewIds: readonly string[]) => {
    const windowKey = key(workspace, objectId);
    const open = windows.get(windowKey);
    if (open !== undefined) {
      open.pending = true;
      open.coarse ||= coarse;
      for (const id of viewIds) open.named.add(id);
      return;
    }
    const state: { pending: boolean; coarse: boolean; named: Set<string>; cancel: () => void } = {
      pending: false,
      coarse: false,
      named: new Set<string>(),
      cancel: () => undefined,
    };
    windows.set(windowKey, state);
    void refresh(workspace, objectId, coarse, new Set(viewIds));
    state.cancel = after(VIEWS_COALESCE_MS, () => {
      if (!state.pending) {
        windows.delete(windowKey);
        return;
      }
      state.cancel = after(Math.round(random() * VIEWS_JITTER_MS), () => {
        windows.delete(windowKey);
        changed(workspace, objectId, state.coarse, [...state.named]);
      });
    });
  };

  return {
    /** An object's views, the same source for every screen that asks. */
    list: (workspace: string, objectId: string): ViewsListSource => listOf(workspace, objectId).api,
    /** One view whole, the same source for every screen that asks. */
    get: (workspace: string, viewId: string): SavedViewSource => bodyOf(workspace, viewId).api,
    /**
     * Saves a draft as the view's filter and sorts for everyone (AC-468),
     * waiting for the server: the answer replaces the held body and the
     * object's list is read again. Rejects with the server's refusal
     * (`VIEW_CHANGED`, `FORBIDDEN`, `FILTER_INVALID`) for the screen to show.
     */
    async saveQuery(workspace: string, viewId: string, input: SaveQueryInput): Promise<View> {
      const mutationId = deps.mintId();
      deps.mutations.sent(mutationId);
      try {
        const view = await deps.api.saveQuery({
          workspace,
          viewId,
          ...(input.filter === undefined ? {} : { filter: input.filter }),
          sorts: input.sorts,
          baseQueryVersion: input.baseQueryVersion,
          ...(input.force === true ? { force: true } : {}),
          mutationId,
        });
        // One views row for the view's object: its echo is skipped, so the list is read here.
        deps.mutations.answered(mutationId, 1);
        put(workspace, view, true);
        const list = lists.get(key(workspace, view.objectId));
        if (list !== undefined) void list.reread();
        return view;
      } catch (error) {
        deps.mutations.forget(mutationId);
        throw toDataError(error);
      }
    },
    /** A live `views` event: the object's list and the bodies it concerns are read again, coalesced per object. */
    changed(workspace: string, event: LiveEventOf<'views'>) {
      if (event.objectId === undefined) return;
      changed(workspace, event.objectId, event.coarse === true, event.viewIds);
    },
    /** Everything held of the workspace is read again (a resync after a gap the outbox no longer covers). */
    resync(workspace: string) {
      for (const [listKey, list] of lists) if (listKey.startsWith(`${workspace}\u0000`)) void list.reread();
      for (const [bodyKey, body] of bodies) if (bodyKey.startsWith(`${workspace}\u0000`)) void body.reread();
    },
    /** Forgets everything: the session ended, or the workspace changed. */
    clear() {
      for (const state of windows.values()) state.cancel();
      windows.clear();
      lists.clear();
      bodies.clear();
    },
  };
}

/** The views store. */
export type ViewsStore = ReturnType<typeof createViewsStore>;
