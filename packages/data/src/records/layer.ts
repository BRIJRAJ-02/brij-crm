// The records part of the data layer (spec 0005, task 11): one store of
// RecordView bodies for the app, a view per object (windows over the store,
// with a count and a status), optimistic creates and edits with rollback, cell
// refusals and toasts, and live patches: a change event's records fetched
// again in place, a new one placed at the end. createDataLayer loads this
// module when a screen first asks for records, so it stays out of the first
// load.
import type { CreateRecordInput, RecordCount, RecordPage, RecordView, SetValuesInput } from '@crm/contracts';
import { refusalFor, refusalSummary, toDataError, type DataError } from '../errors.ts';
import type { Notice } from '../notice.ts';
import { createPlainStore } from './plain-store.ts';
import { createRecordView, nextFrame, type RecordSource, type Scheduler } from './view.ts';
import { createWindows, type Windows } from './windows.ts';

/** Rows per block: `records.query` with `position` = block × 100 (spec 0005, value sourcing). */
const BLOCK_SIZE = 100;
/** How many times a read the server turned away for being busy (429) is tried again. */
const BUSY_TRIES = 5;
/** How many times a write that never reached the server is sent again (the same ids, so nothing happens twice). */
const OFFLINE_TRIES = 2;
/** The wait before trying again when the answer named none, in seconds. */
const DEFAULT_WAIT_SECONDS = 1;
/** The longest wait before a block that failed to load is tried again, in ms. */
const MAX_BLOCK_RETRY_MS = 30_000;
/** The most ids `records.get` takes at once. */
const GET_LIMIT = 500;
/** The longest spread before a refetch many browsers make at once (a count after an unplaced change), in ms. */
const SPREAD_MS = 2000;
/** How long a changed id is remembered, so a block that was loading when it changed fetches it again, in ms. */
const RECENT_MS = 10_000;
/** How far a record id's mint time may be from now for a change to it to count as a create, in ms. */
const NEW_ID_MS = 10 * 60_000;

/**
 * Whether a change to an id nobody here holds may be its create: a UUID v7
 * minted within 10 minutes of now (ids carry their mint time). An older id
 * is a record that already existed, so an edit to it out of sight leaves the
 * count alone. Anything else (not v7) may be new.
 */
export function mayBeNew(id: string, now: number): boolean {
  if (id.length !== 36 || id[14] !== '7') return true;
  const minted = Number.parseInt(`${id.slice(0, 8)}${id.slice(9, 13)}`, 16);
  return Number.isNaN(minted) || Math.abs(now - minted) <= NEW_ID_MS;
}

/** The calls the records layer makes, each mapped to a DataError on failure (a 401 has already signed out). */
export interface RecordsApi {
  readonly query: (
    input: { readonly workspace: string; readonly objectId: string; readonly position: number; readonly limit: number },
    signal: AbortSignal,
  ) => Promise<RecordPage>;
  readonly count: (
    input: { readonly workspace: string; readonly objectId: string },
    signal: AbortSignal,
  ) => Promise<RecordCount>;
  readonly get: (input: { readonly workspace: string; readonly ids: readonly string[] }) => Promise<RecordView[]>;
  readonly create: (input: CreateRecordInput) => Promise<RecordView>;
  readonly setValues: (input: SetValuesInput) => Promise<RecordView>;
}

/** One cell's new value, as the grid hands it over (structurally the library's `CellChange`). */
export interface CellChange {
  readonly rowId: string;
  readonly columnId: string;
  readonly value: unknown;
}

/** Where a view stands: loading its count and first rows, ready, or failed (with Retry). */
export type ViewStatus = 'loading' | 'ready' | 'error';

/** What a screen reads from a view, one object per change. */
export interface ViewState {
  /** The grid's RowSource. */
  readonly source: RecordSource<RecordView>;
  readonly status: ViewStatus;
  /** Why it failed, while `status` is `error`. */
  readonly error?: DataError;
  /** Refused values by `${recordId}:${attributeId}`, to a sentence; each goes with the cell's next edit. */
  readonly cellErrors: ReadonlyMap<string, string>;
}

/** An object's records as one screen shows them, for useSyncExternalStore (`useView` in `@crm/data/react`). */
export interface RecordsView {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ViewState;
  /** Loads the count and every block on screen again, after a failure. */
  readonly retry: () => void;
  /** Settles once the count and the first block have loaded, or failed (the status then says so). */
  readonly ready: () => Promise<void>;
  /** The row a record sits on, while a loaded block holds it (a record just made sits at the end). */
  readonly indexOf: (recordId: string) => number | undefined;
  /**
   * A screen shows the view (`useView` calls it in an effect); the answer
   * lets go. A view nobody shows for a minute lets go of its rows, and the
   * next `view()` makes a fresh one. Counted, so StrictMode's second effect
   * changes nothing.
   */
  readonly retain: () => () => void;
}

/** What the records layer needs from createDataLayer. */
export interface RecordsLayerOptions {
  readonly api: RecordsApi;
  readonly notify: (notice: Notice) => void;
  readonly mintId: () => string;
  /** When views announce changes: once a frame in the browser. */
  readonly schedule?: Scheduler;
  /** Waits `ms`, or rejects when `signal` aborts first. A timer by default; tests pass their own. */
  readonly wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Unix milliseconds now, for a draft's timestamps. */
  readonly now?: () => number;
  /** A number in [0, 1), to spread retries out so many browsers don't retry in step (`Math.random`). */
  readonly random?: () => number;
  /** How long a view nobody shows is kept before it lets go of its rows, in ms: a minute. */
  readonly keepUnusedViewMs?: number;
  /** Listens to a workspace's live changes while one of its views is open; the answer stops (`live.watch`). */
  readonly watch?: (workspace: string) => () => void;
  /** Mutation ids about to go out (`MutationLog.sent`), and ones refused, which will never echo (`forget`). */
  readonly mutations?: { readonly sent: (mutationId: string) => void; readonly forget: (mutationId: string) => void };
}

/** The words the records layer raises itself. */
export const RECORD_WORDS = {
  retry: 'Retry',
  draftRefused: 'That record wasn’t created, so the change to it wasn’t saved.',
  recordGone: 'That record was deleted, so the change wasn’t saved.',
  notSaved: (count: number) => `${String(count)} changes weren’t saved.`,
} as const;

const timer = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(toDataError(signal.reason));
      return;
    }
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(toDataError(signal.reason));
      },
      { once: true },
    );
  });

interface ViewEntry {
  readonly workspace: string;
  readonly objectId: string;
  readonly windows: Windows;
  readonly view: RecordsView;
  readonly invalidate: () => void;
  readonly refreshCount: () => void;
  /** The count again after a random 0 to 2 seconds, once however many ask meanwhile. */
  readonly refreshCountSoon: () => void;
  /** The count and every loaded block again, keeping the table (live changes may have been missed). */
  readonly reload: () => void;
  readonly isReady: () => boolean;
  readonly dispose: () => void;
}

/** Splits `items` into runs of at most `size`. */
const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/** The records layer: one store for the app, a view per object, and the writes that change them. */
export function createRecordsLayer({
  api,
  notify,
  mintId,
  schedule = nextFrame,
  wait = timer,
  now = () => Date.now(),
  random = Math.random,
  keepUnusedViewMs = 60_000,
  watch = () => () => undefined,
  mutations = { sent: () => undefined, forget: () => undefined },
}: RecordsLayerOptions) {
  const store = createPlainStore<RecordView>();
  const views = new Map<string, ViewEntry>();
  // Creates still waiting on the server, by record id: an edit to the draft is sent after it.
  const creating = new Map<string, Promise<boolean>>();
  // Each record's last write still out: the next one is sent after it, so the server applies a
  // record's edits in the order they were made and the later value gets the later version.
  const sending = new Map<string, Promise<unknown>>();
  let cellErrors: ReadonlyMap<string, string> = new Map();

  const keyOf = (workspace: string, objectId: string) => `${workspace}\u0000${objectId}`;
  const viewsOf = (workspace: string) => [...views.values()].filter((entry) => entry.workspace === workspace);

  const setCellErrors = (changes: readonly (readonly [string, string | undefined])[]) => {
    if (!changes.some(([key, message]) => cellErrors.get(key) !== message)) return;
    const next = new Map(cellErrors);
    for (const [key, message] of changes) {
      if (message === undefined) next.delete(key);
      else next.set(key, message);
    }
    cellErrors = next;
    for (const entry of views.values()) entry.invalidate();
  };

  /** Runs a read, trying again after the server's `Retry-After` while it answers that it's busy (429). */
  async function whenFree<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        const failure = toDataError(error);
        if (failure.code !== 'TOO_MANY_REQUESTS' || attempt >= BUSY_TRIES || signal?.aborted === true) throw failure;
        // At least the server's wait, longer each try, and spread out, so busy browsers don't retry in step.
        const seconds = failure.retryAfterSeconds ?? DEFAULT_WAIT_SECONDS;
        await wait(Math.round(seconds * 1000 * attempt * (1 + random())), signal);
      }
    }
  }

  /** Sends a write, sending it again when it never reached the server (its ids make a repeat harmless). */
  async function delivered<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        const failure = toDataError(error);
        if (failure.code !== 'API_UNAVAILABLE' || attempt > OFFLINE_TRIES) throw failure;
        await wait((failure.retryAfterSeconds ?? DEFAULT_WAIT_SECONDS) * 1000);
      }
    }
  }

  /** Records gone on the server: out of the store and out of every window, whose later rows reload. */
  const dropRecords = (ids: readonly string[]) => {
    if (ids.length === 0) return;
    store.remove(ids);
    const gone = new Set(ids);
    for (const entry of views.values()) entry.windows.drop(gone);
  };

  function openView(workspace: string, objectId: string): ViewEntry {
    let status: ViewStatus = 'loading';
    let error: DataError | undefined;
    let isCounted = false;
    let settleReady: () => void = () => undefined;
    let readyPromise = new Promise<void>((resolve) => {
      settleReady = resolve;
    });
    let countController = new AbortController();
    let blockFailures = 0;
    let blockRetry: AbortController | undefined;

    const setStatus = (next: ViewStatus, failure?: DataError) => {
      if (status === next && error === failure) return;
      status = next;
      error = failure;
      inner.invalidate();
      if (next === 'loading') return;
      // Whoever awaits `ready` reads the snapshot next: it must already show the rows.
      inner.flush();
      settleReady();
    };
    const fail = (failure: unknown) => {
      setStatus('error', toDataError(failure));
    };
    /**
     * A block failed. Before the view is ready that is the view failing (Retry).
     * After, the table stays and the block is tried again, later each time it fails.
     */
    const blockFailed = (failure: unknown) => {
      if (status !== 'ready') {
        fail(failure);
        return;
      }
      if (blockRetry !== undefined) return;
      blockFailures += 1;
      const controller = new AbortController();
      blockRetry = controller;
      const delay = Math.min(MAX_BLOCK_RETRY_MS, 1000 * 2 ** (blockFailures - 1)) * (1 + random());
      wait(Math.round(delay), controller.signal).then(
        () => {
          blockRetry = undefined;
          windows.loadMissing();
        },
        () => {
          blockRetry = undefined;
        },
      );
    };
    /** Ready once the count is in and the first row has loaded (or there are none). */
    const checkReady = () => {
      if (status !== 'loading' || !isCounted) return;
      if (windows.count() === 0 || windows.idAt(0) !== undefined) setStatus('ready');
    };

    const windows = createWindows({
      count: 0,
      blockSize: BLOCK_SIZE,
      load: async (offset, limit, signal) => {
        const asked = now();
        const page = await whenFree(() => api.query({ workspace, objectId, position: offset, limit }, signal), signal);
        store.receive(page.records, { hold: true });
        // Changed while this block was on its way: its rows may be older than the change.
        const stale = page.records.map((record) => record.id).filter((id) => changedSince(workspace, id, asked));
        if (stale.length > 0) {
          whenFree(() => api.get({ workspace, ids: stale })).then(
            (rows) => {
              store.receive(rows);
            },
            // Left as loaded: the next change to it, or a reload, brings it up to date.
            () => undefined,
          );
        }
        return page.records.map((record) => record.id);
      },
      onError: blockFailed,
      hold: store.hold,
      release: store.release,
      onStale: () => {
        refreshCount();
      },
    });
    const inner = createRecordView({ store, windows, schedule });
    windows.subscribe(checkReady);
    // A block that lands ends the run of failures.
    windows.subscribe(() => {
      blockFailures = 0;
    });

    function refreshCount() {
      countController.abort();
      const controller = new AbortController();
      countController = controller;
      whenFree(() => api.count({ workspace, objectId }, controller.signal), controller.signal).then(
        ({ count }) => {
          if (countController !== controller) return;
          countFailures = 0;
          const isFirst = !isCounted;
          isCounted = true;
          windows.setCount(count);
          // The first block, so the grid has rows the moment it mounts (the router loader waits for this).
          // Only the first time: a later count must never move the windows back to the top.
          if (isFirst && count > 0) windows.show({ start: 0, end: Math.min(count, BLOCK_SIZE) });
          checkReady();
        },
        (failure: unknown) => {
          if (countController !== controller || controller.signal.aborted) return;
          if (status !== 'ready') {
            fail(failure);
            return;
          }
          // Ready: the table and its count stay, and the count is asked again later, longer each time.
          countFailures += 1;
          const delay = Math.min(MAX_BLOCK_RETRY_MS, 1000 * 2 ** (countFailures - 1)) * (1 + random());
          void wait(Math.round(delay)).then(() => {
            if (countController === controller && views.get(keyOf(workspace, objectId))?.view === view) refreshCount();
          });
        },
      );
    }
    let countFailures = 0;

    let isCountDue = false;
    const refreshCountSoon = () => {
      if (isCountDue) return;
      isCountDue = true;
      void wait(Math.round(random() * SPREAD_MS)).then(() => {
        isCountDue = false;
        if (views.get(keyOf(workspace, objectId))?.view === view) refreshCount();
      });
    };

    let lastSource: RecordSource<RecordView> | undefined;
    let lastErrors = cellErrors;
    let lastStatus: ViewStatus = status;
    let snapshot: ViewState | undefined;
    const view: RecordsView = {
      subscribe: inner.subscribe,
      getSnapshot: () => {
        const source = inner.getSnapshot();
        if (snapshot === undefined || source !== lastSource || cellErrors !== lastErrors || status !== lastStatus) {
          lastSource = source;
          lastErrors = cellErrors;
          lastStatus = status;
          snapshot = { source, status, cellErrors, ...(error === undefined ? {} : { error }) };
        }
        return snapshot;
      },
      retry: () => {
        if (status === 'error') {
          readyPromise = new Promise<void>((resolve) => {
            settleReady = resolve;
          });
        }
        setStatus('loading');
        refreshCount();
        windows.refresh();
      },
      ready: () => readyPromise,
      indexOf: windows.indexOf,
      retain: () => {
        retains += 1;
        clearTimeout(unused);
        let isReleased = false;
        return () => {
          if (isReleased) return;
          isReleased = true;
          retains -= 1;
          if (retains === 0) letGoLater();
        };
      },
    };
    let retains = 0;
    let unused: ReturnType<typeof setTimeout> | undefined;
    // Live changes to this workspace reach the view while it is open.
    const unwatch = watch(workspace);
    const dispose = () => {
      countController.abort();
      blockRetry?.abort();
      inner.dispose();
      unwatch();
    };
    /** Nobody shows the view: after a while it leaves the layer and lets go of its rows. */
    const letGoLater = () => {
      clearTimeout(unused);
      unused = setTimeout(() => {
        if (retains > 0) return;
        const key = keyOf(workspace, objectId);
        if (views.get(key)?.view === view) views.delete(key);
        dispose();
      }, keepUnusedViewMs);
    };
    refreshCount();
    // A view the router warmed but no screen ever showed goes too.
    letGoLater();
    return {
      workspace,
      objectId,
      windows,
      view,
      invalidate: inner.invalidate,
      refreshCount,
      refreshCountSoon,
      reload: () => {
        // Still loading: what it loads is already newer than what was missed.
        if (status !== 'ready') return;
        refreshCount();
        // The blocks on screen again; the others load when scrolled back to.
        windows.refreshShown();
      },
      isReady: () => status === 'ready',
      dispose: () => {
        clearTimeout(unused);
        dispose();
      },
    };
  }

  /** Sends one record's changes once its create (if it is still being made) is in. */
  async function sendEdit(
    workspace: string,
    recordId: string,
    changes: readonly CellChange[],
  ): Promise<DataError | undefined> {
    const values = Object.fromEntries(changes.map((change) => [change.columnId, change.value]));
    setCellErrors(changes.map((change) => [`${recordId}:${change.columnId}`, undefined]));
    const mutationId = mintId();
    const layer = store.edit(recordId, values, mutationId);
    mutations.sent(mutationId);
    // After the record's last write (and its create, if it is still being made).
    const before = sending.get(recordId);
    const turn = (before ?? Promise.resolve()).then(
      () => undefined,
      () => undefined,
    );
    const mine = turn.then(() => send());
    sending.set(recordId, mine);
    void mine.finally(() => {
      if (sending.get(recordId) === mine) sending.delete(recordId);
    });
    return mine;

    async function send(): Promise<DataError | undefined> {
      const pendingCreate = creating.get(recordId);
      if (pendingCreate !== undefined && !(await pendingCreate)) {
        // The create was refused, and the draft went with this edit on it.
        mutations.forget(mutationId);
        notify({ tone: 'danger', message: RECORD_WORDS.draftRefused });
        return undefined;
      }
      try {
        const row = await delivered(() =>
          api.setValues({
            workspace,
            recordId,
            mutationId,
            values: Object.fromEntries(changes.map((change) => [change.columnId, { value: change.value }])),
          }),
        );
        layer.confirm(row);
        return undefined;
      } catch (error) {
        const failure = toDataError(error);
        mutations.forget(mutationId);
        layer.refuse();
        // Signed out: the layer already said so, and sign in comes next.
        if (failure.code === 'UNAUTHENTICATED') return undefined;
        if (failure.code === 'RECORD_DELETED' || failure.code === 'NOT_FOUND') {
          dropRecords([recordId]);
          notify({ tone: 'danger', message: RECORD_WORDS.recordGone });
          return undefined;
        }
        setCellErrors(
          changes.map((change) => [`${recordId}:${change.columnId}`, refusalFor(failure, change.columnId)]),
        );
        return failure;
      }
    }
  }

  /** Reads records again by id, 500 at a time; ids the server leaves out are gone and leave every window. */
  async function refetch(workspace: string, ids: readonly string[]): Promise<void> {
    const held = ids.filter((id) => isHeldIn(workspace, id));
    await Promise.all(
      chunks(held, GET_LIMIT).map(async (part) => {
        const rows = await whenFree(() => api.get({ workspace, ids: part }));
        // Only rows this workspace's views still show: the store is keyed by record id alone.
        store.receive(rows.filter((row) => isHeldIn(workspace, row.id)));
        const found = new Set(rows.map((row) => row.id));
        const gone = new Set(part.filter((id) => !found.has(id) && !store.pending().has(id)));
        if (gone.size === 0) return;
        for (const entry of viewsOf(workspace)) entry.windows.drop(gone);
        store.remove([...gone].filter((id) => ![...views.values()].some((entry) => entry.windows.has(id))));
      }),
    );
  }

  /**
   * Whether one of `workspace`'s views shows `id`. Record ids are unique per
   * workspace only, so a change event from one workspace never touches a
   * record another workspace's view holds under the same id.
   */
  function isHeldIn(workspace: string, id: string): boolean {
    return viewsOf(workspace).some((entry) => entry.windows.has(id));
  }

  /** Records new to a view, fetched and placed at its end in id order (the loop's order is creation order). */
  async function place(entry: ViewEntry, ids: readonly string[]): Promise<void> {
    const rows = (
      await Promise.all(
        chunks(ids, GET_LIMIT).map((part) => whenFree(() => api.get({ workspace: entry.workspace, ids: part }))),
      )
    ).flat();
    if (views.get(keyOf(entry.workspace, entry.objectId)) !== entry) return;
    for (const row of [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      if (row.objectId !== entry.objectId) continue;
      // Placed meanwhile (a later event for it): this row may be the newer one, and versions keep the newest cells.
      if (entry.windows.has(row.id)) {
        store.receive([row]);
        continue;
      }
      // The same id held for another workspace: leave that row alone, and let the count say a row was added.
      if (store.get(row.id) !== undefined) {
        entry.refreshCountSoon();
        continue;
      }
      entry.windows.add(row.id);
      store.receive([row]);
    }
  }

  // Ids change events named in the last 10 seconds, by workspace, with when: a block in flight checks them.
  let recent = new Map<string, Map<string, number>>();
  function remember(workspace: string, ids: readonly string[]) {
    const time = now();
    for (const [key, changed] of recent) {
      for (const [id, at] of changed) if (time - at > RECENT_MS) changed.delete(id);
      if (changed.size === 0) recent.delete(key);
    }
    const changed = recent.get(workspace) ?? new Map<string, number>();
    recent.set(workspace, changed);
    for (const id of ids) changed.set(id, time);
  }
  function changedSince(workspace: string, id: string, since: number): boolean {
    const at = recent.get(workspace)?.get(id);
    return at !== undefined && at >= since;
  }

  // Change events' record ids, by workspace and object, gathered for one frame.
  let incoming = new Map<string, Map<string, Set<string>>>();
  let isGathering = false;
  function applyIncoming() {
    isGathering = false;
    const gathered = incoming;
    incoming = new Map();
    for (const [workspace, objects] of gathered) {
      const all = [...objects.values()].flatMap((ids) => [...ids]);
      const held = all.filter((id) => isHeldIn(workspace, id));
      // A refetch that fails leaves rows out of date: load the workspace's views again a moment later.
      if (held.length > 0) {
        refetch(workspace, held).catch(() => {
          // Once more a moment later; failing again, the views load what they show again.
          void wait(Math.round((1 + random()) * SPREAD_MS))
            .then(() => refetch(workspace, held))
            .catch(() => {
              records.reload(workspace);
            });
        });
      }
      const heldIds = new Set(held);
      for (const [objectId, ids] of objects) {
        const entry = views.get(keyOf(workspace, objectId));
        if (entry === undefined || !entry.isReady()) continue;
        const unheld = [...ids].filter((id) => !heldIds.has(id) && !entry.windows.has(id));
        if (unheld.length === 0) continue;
        const count = entry.windows.count();
        // The last row on screen (or none at all): an id past it is a record made since.
        const last = count === 0 ? '' : entry.windows.idAt(count - 1);
        const fresh = last === undefined ? [] : unheld.filter((id) => id > last);
        // Out of sight: only a record made since moves the count (an edit to an older one doesn't).
        const time = now();
        if (unheld.some((id) => !fresh.includes(id) && mayBeNew(id, time))) entry.refreshCountSoon();
        if (fresh.length > 0) {
          place(entry, fresh).catch(() => {
            entry.refreshCountSoon();
          });
        }
      }
    }
  }

  const records = {
    /**
     * An object's records for one screen: the same view for every screen
     * that asks, made on first use, its count and first block loading.
     */
    view: (workspace: string, objectId: string): RecordsView => {
      const key = keyOf(workspace, objectId);
      const existing = views.get(key);
      if (existing !== undefined) return existing.view;
      const entry = openView(workspace, objectId);
      views.set(key, entry);
      return entry.view;
    },

    /**
     * Makes a record at once: a draft joins the end of every view of its
     * object and the count goes up, then the server's row replaces it. A
     * refusal takes it out again (and the count back) and rejects with the
     * refusals, so a form can mark its fields. A write that never reached the
     * server is sent again with the same id, which the server answers with the
     * record it already made. A form that may send again (Create pressed after
     * a lost answer) mints `id` once (`newId`) and passes it each time.
     */
    create: async (
      workspace: string,
      objectId: string,
      values: Readonly<Record<string, unknown>>,
      id: string = mintId(),
    ): Promise<RecordView> => {
      const mutationId = mintId();
      const at = new Date(now()).toISOString();
      // Who made it is the server's to say; the draft shows only its values until the answer.
      const nobody = { type: 'system' as const, id: null };
      const draft: RecordView = {
        id,
        objectId,
        createdAt: at,
        createdBy: nobody,
        updatedAt: at,
        updatedBy: nobody,
        display: { objectId, recordId: id, name: '', kind: 'other' },
        values,
        versions: {},
        linkTotals: {},
      };
      const layer = store.create(draft, mutationId);
      mutations.sent(mutationId);
      const placed = viewsOf(workspace).filter((entry) => entry.objectId === objectId);
      for (const entry of placed) entry.windows.add(id);
      let settle: (made: boolean) => void = () => undefined;
      creating.set(
        id,
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
      );
      try {
        const row = await delivered(() => api.create({ workspace, objectId, id, values, mutationId }));
        layer.confirm(row);
        settle(true);
        return row;
      } catch (error) {
        mutations.forget(mutationId);
        layer.refuse();
        for (const entry of placed) entry.windows.withdraw(id);
        settle(false);
        throw toDataError(error);
      } finally {
        creating.delete(id);
      }
    },

    /**
     * Edits cells at once, then sends one write per record. A refusal rolls
     * that record's changes back, marks each refused cell with its message,
     * and raises one toast with Retry. A second edit to a cell while the first
     * is in flight shows on top of it, and no late answer brings the older
     * value back.
     */
    setValues: (workspace: string, changes: readonly CellChange[]): void => {
      const byRecord = new Map<string, CellChange[]>();
      for (const change of changes) byRecord.set(change.rowId, [...(byRecord.get(change.rowId) ?? []), change]);
      void Promise.all(
        [...byRecord].map(async ([recordId, own]) => ({ own, failure: await sendEdit(workspace, recordId, own) })),
      ).then((results) => {
        const refused = results.filter((result) => result.failure !== undefined);
        const [first] = refused;
        if (first?.failure === undefined) return;
        const again = refused.flatMap((result) => result.own);
        notify({
          tone: 'danger',
          message: refused.length === 1 ? refusalSummary(first.failure) : RECORD_WORDS.notSaved(refused.length),
          action: {
            label: RECORD_WORDS.retry,
            onAction: () => {
              records.setValues(workspace, again);
            },
          },
        });
      });
    },

    /** Reads records again by id (a change event's ids); ids the server leaves out are gone and leave every window. */
    refetch,

    /**
     * Another tab or person changed these records of an object (a change
     * event). Gathered for one frame, then: the ones held are fetched again
     * in place; one past the end of a view whose last row is loaded is new,
     * so it joins the end; any other is out of sight, and may have changed
     * the count (made or deleted elsewhere), so the count is asked again.
     */
    changed: (workspace: string, objectId: string, ids: readonly string[]): void => {
      if (ids.length === 0) return;
      remember(workspace, ids);
      const objects = incoming.get(workspace) ?? new Map<string, Set<string>>();
      incoming.set(workspace, objects);
      const gathered = objects.get(objectId) ?? new Set<string>();
      objects.set(objectId, gathered);
      for (const id of ids) gathered.add(id);
      if (isGathering) return;
      isGathering = true;
      schedule(applyIncoming);
    },

    /**
     * Changes may have been missed (a gap, a lost recovery, a coarse event):
     * the workspace's views (or one object's) load their count and blocks
     * again, keeping the table on screen.
     */
    reload: (workspace: string, objectId?: string): void => {
      for (const entry of viewsOf(workspace)) if (objectId === undefined || entry.objectId === objectId) entry.reload();
    },

    /** Forgets every record and view (sign out, or someone else signed in). */
    clear: () => {
      for (const entry of views.values()) entry.dispose();
      views.clear();
      incoming = new Map();
      recent = new Map();
      creating.clear();
      sending.clear();
      store.clear();
      cellErrors = new Map();
    },

    /** How many record bodies the store holds now (for tests and the gate). */
    size: () => store.size(),
  };
  return records;
}

/** The records layer, as createDataLayer holds it once loaded. */
export type RecordsLayer = ReturnType<typeof createRecordsLayer>;
