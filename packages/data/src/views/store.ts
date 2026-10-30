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
// views). Saving a query, and every other view write but the layout, waits
// for the server. A layout change shows at once as a layer over the held
// body and is sent at most once per 500 ms (the latest wins); a refusal drops
// the layer and says why. On a locked view the person may not change, the
// layer stays in this tab only and is dropped when the screen leaves.
//
// Plain TypeScript with no runtime imports beyond the layer's own, so it sits
// in the first load.
import type {
  FilterGroup,
  SortRule,
  View,
  ViewConfig,
  ViewKind,
  ViewLayout,
  ViewsList,
  ViewSummary,
  ViewVisibility,
} from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import type { MutationLog } from '../live/mutations.ts';
import type { LiveEventOf } from '../live/router.ts';

/** How long, at least, between two rereads of one object's views (spec 0020: at most once a second). */
export const VIEWS_COALESCE_MS = 1000;

/** The longest random wait before a coalesced reread (spec 0006 AC-61's 0 to 2 seconds). */
export const VIEWS_JITTER_MS = 2000;

/** The least time between two layout saves of one view (spec 0020, AC-470: a resize sends at most one per 500 ms). */
export const LAYOUT_SAVE_MS = 500;

/** The least time between two "last opened" marks of one view (spec 0020: at most once per view per 10 seconds). */
export const MARK_OPENED_MS = 10_000;

/** The calls the views store makes, each mapped to a DataError by the layer. */
export interface ViewsApi {
  readonly list: (input: {
    readonly workspace: string;
    readonly objectId: string;
    readonly listId?: string;
  }) => Promise<ViewsList>;
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
  readonly create: (input: { readonly workspace: string; readonly mutationId: string } & NewView) => Promise<View>;
  readonly update: (input: {
    readonly workspace: string;
    readonly viewId: string;
    readonly name?: string;
    readonly visibility?: ViewVisibility;
    readonly mutationId: string;
  }) => Promise<View>;
  readonly setLayout: (input: {
    readonly workspace: string;
    readonly viewId: string;
    readonly layout: ViewLayout;
    readonly mutationId: string;
  }) => Promise<View>;
  readonly move: (input: {
    readonly workspace: string;
    readonly viewId: string;
    readonly direction: 'up' | 'down';
    readonly mutationId: string;
  }) => Promise<readonly ViewSummary[]>;
  readonly setLocked: (input: {
    readonly workspace: string;
    readonly viewId: string;
    readonly locked: boolean;
    readonly mutationId: string;
  }) => Promise<View>;
  readonly setDefault: (input: {
    readonly workspace: string;
    readonly objectId: string;
    readonly listId?: string;
    readonly viewId: string;
    readonly mutationId: string;
  }) => Promise<readonly ViewSummary[]>;
  readonly remove: (input: {
    readonly workspace: string;
    readonly viewId: string;
    readonly mutationId: string;
  }) => Promise<unknown>;
  readonly markOpened: (input: { readonly workspace: string; readonly viewId: string }) => Promise<unknown>;
}

/** A view to make (the create dialog): the id minted once per dialog, its object, name, kind, who sees it and its config. */
export interface NewView {
  readonly id: string;
  readonly objectId: string;
  /** A view of one of the object's lists (spec 0048). */
  readonly listId?: string;
  readonly name: string;
  readonly kind: ViewKind;
  readonly visibility: ViewVisibility;
  readonly config: ViewConfig;
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
  /** The time now, in ms (tests pass their own). */
  readonly now?: () => number;
  /** A layout save the server refused: it was rolled back, and the person is told why. */
  readonly onLayoutRefused?: (error: DataError) => void;
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
  /** The view, with this tab's layout change on top while it is on its way (or kept here, on a locked view). */
  readonly view?: View;
  readonly error?: DataError;
  /** The layout shown is this tab's own and isn't saved: a locked view the person may not change (AC-476). */
  readonly isLayoutLocal?: boolean;
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

/** A view's draft kept in this tab: its filter and sorts, and the view's query version it began on. */
export interface KeptDraft {
  readonly query: { readonly filter?: FilterGroup | undefined; readonly sorts: readonly SortRule[] };
  readonly base: number;
}

const LOADING_LIST: ViewsListSnapshot = Object.freeze({ status: 'loading', views: Object.freeze([]) });
const LOADING_VIEW: SavedViewSnapshot = Object.freeze({ status: 'loading' });

/**
 * A source's shared parts: listeners, holders, the workspace's watch, and
 * its reads. Only the answer of the latest read started lands (`isLatest`),
 * so an older answer arriving last never replaces a newer one. A source no
 * screen holds isn't read on a change; it is marked stale and read when a
 * screen holds it or a loader asks for it again.
 */
function createSource<Snapshot extends { readonly status: string }>(
  watch: () => () => void,
  initial: Snapshot,
  read: (isLatest: () => boolean) => Promise<void>,
): {
  readonly api: ViewsSource<Snapshot>;
  readonly set: (next: Snapshot) => void;
  readonly get: () => Snapshot;
  readonly isRetained: () => boolean;
  readonly reread: () => Promise<void>;
  /** Changed on the server while no screen held it: read on the next hold or ask. */
  readonly markStale: () => void;
} {
  let snapshot = initial;
  let held = 0;
  let release: (() => void) | undefined;
  let last: Promise<void> | undefined;
  let started = 0;
  let isStale = false;
  const listeners = new Set<() => void>();
  const set = (next: Snapshot) => {
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const reread = () => {
    started += 1;
    const mine = started;
    isStale = false;
    const reading = read(() => mine === started);
    last = reading;
    return reading;
  };
  return {
    set,
    get: () => snapshot,
    isRetained: () => held > 0,
    reread,
    markStale: () => {
      isStale = true;
    },
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
        if (held === 1) {
          release = watch();
          if (isStale) void reread();
        }
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
      // A failed read, or a change since, reads again: a Retry that calls this never meets the old failure.
      ready: () => (last === undefined || isStale || snapshot.status === 'error' ? reread() : last),
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
  // A list's views (spec 0048) are held by the list's id as their parent; each list's object, by workspace and list.
  const listObjects = new Map<string, string>();
  /** What a call names for a parent: its object, and its list when the parent is a list. */
  const parentArgs = (workspace: string, parentId: string) => {
    const objectId = listObjects.get(key(workspace, parentId));
    return objectId === undefined ? { objectId: parentId } : { objectId, listId: parentId };
  };
  /** The parent a view's list and bodies are held by: its list's id, else its object's. */
  const parentOf = (view: { readonly objectId: string; readonly listId?: string | undefined }) =>
    view.listId ?? view.objectId;

  function makeList(workspace: string, objectId: string) {
    const source = createSource<ViewsListSnapshot>(
      () => deps.watch(workspace),
      LOADING_LIST,
      async (isLatest) => {
        try {
          const answer = await deps.api.list({ workspace, ...parentArgs(workspace, objectId) });
          if (!isLatest()) return;
          source.set({
            status: 'ready',
            views: answer.views,
            ...(answer.defaultViewId === undefined ? {} : { defaultViewId: answer.defaultViewId }),
            ...(answer.lastOpenedViewId === undefined ? {} : { lastOpenedViewId: answer.lastOpenedViewId }),
          });
        } catch (failed) {
          if (!isLatest()) return;
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
      async (isLatest) => {
        try {
          const view = await deps.api.get({ workspace, viewId });
          if (isLatest()) put(workspace, view);
        } catch (failed) {
          if (!isLatest()) return;
          const error = toDataError(failed);
          if (error.code === 'NOT_FOUND') {
            servers.delete(key(workspace, viewId));
            source.set({ status: 'not-found', error });
          } else if (source.get().view === undefined) source.set({ status: 'error', error });
        }
      },
    );
    return source;
  }

  // The server's copy of each view held, and this tab's layout on top of it while one is on its way or kept here.
  const servers = new Map<string, View>();
  const layers = new Map<string, { readonly layout: ViewLayout; readonly isLocal: boolean }>();
  const saves = new Map<string, { queued?: ViewLayout; inFlight: boolean; lastSent: number; cancel?: () => void }>();
  const opened = new Map<string, { readonly viewId: string; readonly at: number }>();
  // Each view's unsaved filter and sorts in this tab, so leaving the view and coming back keeps them.
  const drafts = new Map<string, KeptDraft>();
  const now = deps.now ?? Date.now;

  /** The body as shown: the server's view with this tab's layout on top. */
  const show = (workspace: string, viewId: string) => {
    const body = bodyOf(workspace, viewId);
    const view = servers.get(key(workspace, viewId));
    if (view === undefined) return;
    const layer = layers.get(key(workspace, viewId));
    if (layer === undefined) {
      body.set({ status: 'ready', view });
      return;
    }
    const { layout } = layer;
    // A table's grouping: `null` sets it back to one list, absent keeps the one shown.
    const { groupBy: shownGroupBy, ...ungrouped } = view.config;
    const groupBy = layout.groupBy === undefined ? shownGroupBy : (layout.groupBy ?? undefined);
    body.set({
      status: 'ready',
      view: {
        ...view,
        ...(layout.kind === undefined ? {} : { kind: layout.kind }),
        config: {
          ...ungrouped,
          columns: layout.columns,
          pinnedCount: layout.pinnedCount,
          ...(layout.board === undefined ? {} : { board: layout.board }),
          ...(groupBy === undefined ? {} : { groupBy }),
        },
      },
      ...(layer.isLocal ? { isLayoutLocal: true } : {}),
    });
  };

  /** A view read or saved: replaces the held body unless that one is newer (the revision rule, for views). */
  const put = (workspace: string, view: View) => {
    const held = servers.get(key(workspace, view.id));
    if (held !== undefined && held.version > view.version) return;
    servers.set(key(workspace, view.id), view);
    show(workspace, view.id);
  };

  /** Reads the object's list again when a screen holds it, else marks it stale (after this tab's own write). */
  const refreshList = (workspace: string, objectId: string) => {
    const list = lists.get(key(workspace, objectId));
    if (list?.isRetained() === true) void list.reread();
    else list?.markStale();
  };

  /** A write's answer as the object's views in switcher order: the held list takes it, with no second read. */
  const takeSummaries = (workspace: string, objectId: string, summaries: readonly ViewSummary[]) => {
    const list = lists.get(key(workspace, objectId));
    const held = list?.get();
    if (list === undefined || held?.status !== 'ready') {
      list?.markStale();
      return;
    }
    const defaultViewId = summaries.find((each) => each.isDefault)?.id;
    const { defaultViewId: _old, ...rest } = held;
    list.set({ ...rest, views: summaries, ...(defaultViewId === undefined ? {} : { defaultViewId }) });
  };

  /** One server confirmed write: its mutation id is logged for its echo, and forgotten on a refusal. */
  const confirmed = async <T>(send: (mutationId: string) => Promise<T>, echoes = 1): Promise<T> => {
    const mutationId = deps.mintId();
    deps.mutations.sent(mutationId);
    try {
      const answer = await send(mutationId);
      deps.mutations.answered(mutationId, echoes);
      return answer;
    } catch (error) {
      deps.mutations.forget(mutationId);
      throw toDataError(error);
    }
  };

  /** Sends a view's queued layout, at most once per LAYOUT_SAVE_MS, the latest winning. */
  const sendLayout = (workspace: string, viewId: string) => {
    const saveKey = key(workspace, viewId);
    const state = saves.get(saveKey);
    if (state?.queued === undefined || state.inFlight || state.cancel !== undefined) return;
    const wait = state.lastSent + LAYOUT_SAVE_MS - now();
    if (wait > 0) {
      state.cancel = after(wait, () => {
        state.cancel = undefined;
        sendLayout(workspace, viewId);
      });
      return;
    }
    const layout = state.queued;
    state.queued = undefined;
    state.inFlight = true;
    state.lastSent = now();
    confirmed((mutationId) => deps.api.setLayout({ workspace, viewId, layout, mutationId })).then(
      (view) => {
        state.inFlight = false;
        // Nothing newer waits: the server's copy is what shows.
        if (state.queued === undefined && layers.get(saveKey)?.layout === layout) layers.delete(saveKey);
        put(workspace, view);
        sendLayout(workspace, viewId);
      },
      (error: unknown) => {
        state.inFlight = false;
        state.queued = undefined;
        layers.delete(saveKey);
        show(workspace, viewId);
        deps.onLayoutRefused?.(toDataError(error));
        // What the view holds now, from the server (someone may have locked it).
        const body = bodies.get(saveKey);
        if (body?.isRetained() === true) void body.reread();
      },
    );
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

  /** A held body's parent, when it has loaded. */
  const parentOfHeld = (view: View | undefined) => (view === undefined ? undefined : parentOf(view));

  /** The held bodies of one workspace whose view is on `objectId` (or, for a list's views, the list). */
  const bodiesOn = (workspace: string, objectId: string) =>
    [...bodies.entries()].flatMap(([bodyKey, body]) =>
      bodyKey.startsWith(`${workspace}\u0000`) && parentOfHeld(body.get().view) === objectId ? [body] : [],
    );

  /**
   * Reads one object's views again after a change: its list (when held),
   * then the bodies the event named, or (coarse) the held bodies whose
   * version in the list moved and those gone from it, which become not found.
   */
  const refresh = async (workspace: string, objectId: string, coarse: boolean, named: ReadonlySet<string>) => {
    const found = lists.get(key(workspace, objectId));
    // What no screen holds isn't read now: it reads when a screen holds it again.
    if (found !== undefined && !found.isRetained()) found.markStale();
    const list = found?.isRetained() === true ? found : undefined;
    if (list !== undefined) await list.reread();
    const listed = list?.get();
    const held = bodiesOn(workspace, objectId);
    for (const body of held) {
      const view = body.get().view;
      if (view === undefined) continue;
      if (!body.isRetained()) {
        if (coarse || named.has(view.id)) body.markStale();
        continue;
      }
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
      if (summary === undefined) {
        servers.delete(key(workspace, view.id));
        body.set({ status: 'not-found' });
      } else if (summary.version !== view.version) void body.reread();
    }
    // A named view held but not yet loaded with its object (opened by id) reads too.
    for (const id of named) {
      const body = bodies.get(key(workspace, id));
      if (body !== undefined && body.isRetained() && body.get().view === undefined) void body.reread();
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
    /** An object's views (or, with `listId`, one of its lists'), the same source for every screen that asks. */
    list: (workspace: string, objectId: string, listId?: string): ViewsListSource => {
      if (listId === undefined) return listOf(workspace, objectId).api;
      listObjects.set(key(workspace, listId), objectId);
      return listOf(workspace, listId).api;
    },
    /** One view whole, the same source for every screen that asks. */
    get: (workspace: string, viewId: string): SavedViewSource => bodyOf(workspace, viewId).api,
    /**
     * Saves a draft as the view's filter and sorts for everyone (AC-468),
     * waiting for the server: the answer replaces the held body and the
     * object's list is read again. Rejects with the server's refusal
     * (`VIEW_CHANGED`, `FORBIDDEN`, `FILTER_INVALID`) for the screen to show.
     */
    async saveQuery(workspace: string, viewId: string, input: SaveQueryInput): Promise<View> {
      const view = await confirmed((mutationId) =>
        deps.api.saveQuery({
          workspace,
          viewId,
          ...(input.filter === undefined ? {} : { filter: input.filter }),
          sorts: input.sorts,
          baseQueryVersion: input.baseQueryVersion,
          ...(input.force === true ? { force: true } : {}),
          mutationId,
        }),
      );
      // One views row for the view's object: its echo is skipped, so the list is read here.
      put(workspace, view);
      refreshList(workspace, parentOf(view));
      return view;
    },
    /**
     * Makes a view (AC-472), waiting for the server: it joins the held list
     * and its body is held. Rejects with the refusal (`NAME_TAKEN` on
     * `name`, `LIMIT_REACHED`, `ID_TAKEN`) for the dialog to show.
     */
    async create(workspace: string, input: NewView): Promise<View> {
      const view = await confirmed((mutationId) => deps.api.create({ workspace, mutationId, ...input }));
      put(workspace, view);
      refreshList(workspace, parentOf(view));
      return view;
    },
    /** Renames a view, or changes who sees it, waiting for the server. */
    async update(
      workspace: string,
      viewId: string,
      changes: { readonly name?: string; readonly visibility?: ViewVisibility },
    ): Promise<View> {
      const view = await confirmed((mutationId) =>
        deps.api.update({
          workspace,
          viewId,
          ...(changes.name === undefined ? {} : { name: changes.name }),
          ...(changes.visibility === undefined ? {} : { visibility: changes.visibility }),
          mutationId,
        }),
      );
      put(workspace, view);
      refreshList(workspace, parentOf(view));
      return view;
    },
    /**
     * A column change (AC-470): it shows at once in every screen holding the
     * view and is sent at most once per 500 ms, the latest winning; a
     * refusal puts the server's layout back and calls `onLayoutRefused`.
     * `isLocal` (a locked view the person may not change, AC-476) keeps it in
     * this tab and sends nothing, until `dropLocalLayout`.
     */
    setLayout(workspace: string, viewId: string, layout: ViewLayout, options: { readonly isLocal?: boolean } = {}) {
      const layerKey = key(workspace, viewId);
      if (!servers.has(layerKey)) return;
      const isLocal = options.isLocal === true;
      layers.set(layerKey, { layout, isLocal });
      show(workspace, viewId);
      if (isLocal) return;
      const state = saves.get(layerKey) ?? { inFlight: false, lastSent: Number.NEGATIVE_INFINITY };
      saves.set(layerKey, state);
      state.queued = layout;
      sendLayout(workspace, viewId);
    },
    /** Drops the layout kept in this tab only (the screen left a locked view). */
    dropLocalLayout(workspace: string, viewId: string) {
      const layerKey = key(workspace, viewId);
      if (layers.get(layerKey)?.isLocal !== true) return;
      layers.delete(layerKey);
      show(workspace, viewId);
    },
    /** Swaps a view with its neighbour in its group, waiting for the server; the list takes the new order. */
    async move(workspace: string, objectId: string, viewId: string, direction: 'up' | 'down'): Promise<void> {
      takeSummaries(
        workspace,
        objectId,
        await confirmed((mutationId) => deps.api.move({ workspace, viewId, direction, mutationId })),
      );
    },
    /** Locks or unlocks a shared view (`views.manage`), waiting for the server. */
    async setLocked(workspace: string, viewId: string, locked: boolean): Promise<View> {
      const view = await confirmed((mutationId) => deps.api.setLocked({ workspace, viewId, locked, mutationId }));
      put(workspace, view);
      refreshList(workspace, parentOf(view));
      return view;
    },
    /** Makes a shared view the object's default (`views.manage`), waiting for the server. */
    async setDefault(workspace: string, objectId: string, viewId: string): Promise<void> {
      takeSummaries(
        workspace,
        objectId,
        await confirmed((mutationId) =>
          deps.api.setDefault({ workspace, ...parentArgs(workspace, objectId), viewId, mutationId }),
        ),
      );
      // Both the old default and the new one changed: the held bodies of the object are read again.
      for (const body of bodiesOn(workspace, objectId)) {
        if (body.isRetained()) void body.reread();
        else body.markStale();
      }
    },
    /** Deletes a view for good (AC-474), waiting for the server: its body becomes not found. */
    async remove(workspace: string, objectId: string, viewId: string): Promise<void> {
      await confirmed((mutationId) => deps.api.remove({ workspace, viewId, mutationId }));
      const bodyKey = key(workspace, viewId);
      servers.delete(bodyKey);
      layers.delete(bodyKey);
      bodies.get(bodyKey)?.set({ status: 'not-found' });
      // The held list lets go of it now, and of the last opened mark on it, so the object's address can't land
      // on it while the list is read again (the delete's own navigation to the address raced that read).
      const list = lists.get(key(workspace, objectId));
      const held = list?.get();
      if (list !== undefined && held?.status === 'ready') {
        const { lastOpenedViewId, ...rest } = held;
        const views = held.views.filter((each) => each.id !== viewId);
        list.set(lastOpenedViewId === viewId ? { ...rest, views } : { ...held, views });
      }
      refreshList(workspace, objectId);
    },
    /**
     * Keeps a view as the person's last opened one for its object (AC-478):
     * fire and forget, at most once per view per 10 seconds; a failure is
     * quiet (the next open marks it again).
     */
    markOpened(workspace: string, viewId: string) {
      const held = servers.get(key(workspace, viewId));
      const objectId = held === undefined ? undefined : parentOf(held);
      // The held list lands on this view next time the object's address opens, in this tab too.
      const list = objectId === undefined ? undefined : lists.get(key(workspace, objectId));
      const shown = list?.get();
      if (list !== undefined && shown?.status === 'ready' && shown.lastOpenedViewId !== viewId) {
        list.set({ ...shown, lastOpenedViewId: viewId });
      }
      // Skipped only when this view is already the object's last mark, made under 10 seconds ago.
      const markKey = key(workspace, objectId ?? viewId);
      const last = opened.get(markKey);
      if (last !== undefined && last.viewId === viewId && now() - last.at < MARK_OPENED_MS) return;
      opened.set(markKey, { viewId, at: now() });
      deps.api.markOpened({ workspace, viewId }).catch(() => {
        opened.delete(markKey);
      });
    },
    /**
     * Keeps a view's unsaved filter and sorts for this tab (undefined forgets
     * them), so the view opened again shows the draft with Save and Discard.
     */
    keepDraft(workspace: string, viewId: string, draft: KeptDraft | undefined) {
      if (draft === undefined) drafts.delete(key(workspace, viewId));
      else drafts.set(key(workspace, viewId), draft);
    },
    /** The draft this tab kept for a view, if any. */
    keptDraft: (workspace: string, viewId: string): KeptDraft | undefined => drafts.get(key(workspace, viewId)),
    /** A live `views` event: the object's list and the bodies it concerns are read again, coalesced per object. */
    changed(workspace: string, event: LiveEventOf<'views'>) {
      const parent = event.listId ?? event.objectId;
      if (parent === undefined) return;
      changed(workspace, parent, event.coarse === true, event.viewIds);
    },
    /** Everything held of the workspace is read again (a resync after a gap the outbox no longer covers). */
    resync(workspace: string) {
      const all = [
        ...[...lists].filter(([sourceKey]) => sourceKey.startsWith(`${workspace}\u0000`)).map(([, list]) => list),
        ...[...bodies].filter(([sourceKey]) => sourceKey.startsWith(`${workspace}\u0000`)).map(([, body]) => body),
      ];
      for (const source of all) {
        if (source.isRetained()) void source.reread();
        else source.markStale();
      }
    },
    /** Forgets everything: the session ended, or the workspace changed. */
    clear() {
      for (const state of windows.values()) state.cancel();
      windows.clear();
      for (const state of saves.values()) state.cancel?.();
      saves.clear();
      layers.clear();
      servers.clear();
      opened.clear();
      drafts.clear();
      lists.clear();
      bodies.clear();
    },
  };
}

/** The views store. */
export type ViewsStore = ReturnType<typeof createViewsStore>;
