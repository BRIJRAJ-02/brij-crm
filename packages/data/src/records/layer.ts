// The records part of the data layer (spec 0005, task 11): one store of
// RecordView bodies for the app, a view per object (windows over the store,
// with a count and a status), optimistic creates and edits with rollback, cell
// refusals and toasts. createDataLayer loads this module when a screen first
// asks for records, so it stays out of the first load.
import type {
  ApiRefusal,
  CreateRecordInput,
  RecordCount,
  RecordPage,
  RecordView,
  SetValuesInput,
} from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
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

/** The message a refusal gives one cell: its own refusal, else (for a refusal about nothing in particular) the whole answer's. */
function cellMessage(failure: DataError, attributeId: string): string | undefined {
  const refusals: readonly ApiRefusal[] = failure.data?.refusals ?? [];
  const own = refusals.find((refusal) => refusal.attributeId === attributeId);
  if (own !== undefined) return own.message;
  const issue = failure.data?.issues?.find((each) => each.path[0] === 'values' && each.path[1] === attributeId);
  if (issue !== undefined) return issue.message;
  const aboutCells = refusals.some((refusal) => refusal.attributeId !== undefined);
  return aboutCells ? undefined : failure.message;
}

/** The sentence a toast gives a refused write: its first refusal's, else the answer's. */
const toastMessage = (failure: DataError) => failure.data?.refusals?.[0]?.message ?? failure.message;

interface ViewEntry {
  readonly workspace: string;
  readonly objectId: string;
  readonly windows: Windows;
  readonly view: RecordsView;
  readonly invalidate: () => void;
  readonly refreshCount: () => void;
  readonly dispose: () => void;
}

/** The records layer: one store for the app, a view per object, and the writes that change them. */
export function createRecordsLayer({
  api,
  notify,
  mintId,
  schedule = nextFrame,
  wait = timer,
  now = () => Date.now(),
}: RecordsLayerOptions) {
  const store = createPlainStore<RecordView>();
  const views = new Map<string, ViewEntry>();
  // Creates still waiting on the server, by record id: an edit to the draft is sent after it.
  const creating = new Map<string, Promise<boolean>>();
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
        await wait((failure.retryAfterSeconds ?? DEFAULT_WAIT_SECONDS) * 1000, signal);
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
    /** Ready once the count is in and the first row has loaded (or there are none). */
    const checkReady = () => {
      if (status !== 'loading' || !isCounted) return;
      if (windows.count() === 0 || windows.idAt(0) !== undefined) setStatus('ready');
    };

    const windows = createWindows({
      count: 0,
      blockSize: BLOCK_SIZE,
      load: async (offset, limit, signal) => {
        const page = await whenFree(() => api.query({ workspace, objectId, position: offset, limit }, signal), signal);
        store.receive(page.records, { hold: true });
        return page.records.map((record) => record.id);
      },
      onError: fail,
      hold: store.hold,
      release: store.release,
      onStale: () => {
        refreshCount();
      },
    });
    const inner = createRecordView({ store, windows, schedule });
    windows.subscribe(checkReady);

    function refreshCount() {
      countController.abort();
      const controller = new AbortController();
      countController = controller;
      whenFree(() => api.count({ workspace, objectId }, controller.signal), controller.signal).then(
        ({ count }) => {
          if (countController !== controller) return;
          isCounted = true;
          windows.setCount(count);
          // The first block, so the grid has rows the moment it mounts (the router loader waits for this).
          if (count > 0) windows.show({ start: 0, end: Math.min(count, BLOCK_SIZE) });
          checkReady();
        },
        (failure: unknown) => {
          if (countController === controller && !controller.signal.aborted) fail(failure);
        },
      );
    }

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
    };
    refreshCount();
    return {
      workspace,
      objectId,
      windows,
      view,
      invalidate: inner.invalidate,
      refreshCount,
      dispose: () => {
        countController.abort();
        inner.dispose();
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
    const pendingCreate = creating.get(recordId);
    if (pendingCreate !== undefined && !(await pendingCreate)) {
      // The create was refused, and the draft went with this edit on it.
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
      layer.refuse();
      // Signed out: the layer already said so, and sign in comes next.
      if (failure.code === 'UNAUTHENTICATED') return undefined;
      if (failure.code === 'RECORD_DELETED' || failure.code === 'NOT_FOUND') {
        dropRecords([recordId]);
        notify({ tone: 'danger', message: RECORD_WORDS.recordGone });
        return undefined;
      }
      setCellErrors(changes.map((change) => [`${recordId}:${change.columnId}`, cellMessage(failure, change.columnId)]));
      return failure;
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
     * record it already made.
     */
    create: async (
      workspace: string,
      objectId: string,
      values: Readonly<Record<string, unknown>>,
    ): Promise<RecordView> => {
      const id = mintId();
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
          message: refused.length === 1 ? toastMessage(first.failure) : RECORD_WORDS.notSaved(refused.length),
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
    refetch: async (workspace: string, ids: readonly string[]): Promise<void> => {
      const held = ids.filter((id) => store.get(id) !== undefined);
      if (held.length === 0) return;
      const rows = await whenFree(() => api.get({ workspace, ids: held }));
      store.receive(rows);
      const found = new Set(rows.map((row) => row.id));
      dropRecords(held.filter((id) => !found.has(id) && !store.pending().has(id)));
    },

    /** Forgets every record and view (sign out, or someone else signed in). */
    clear: () => {
      for (const entry of views.values()) entry.dispose();
      views.clear();
      creating.clear();
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
