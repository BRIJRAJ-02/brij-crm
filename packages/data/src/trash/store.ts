// The trash (spec 0022): the workspace's trashed records the member may see,
// newest first, in windows like a table (`trash.query` by cursor, 100 a
// block, and `trash.count`), and restoring some of them. A restore takes its
// rows out at once; a refused record comes back with its reason on its name
// cell, kept until the member leaves the screen. Live: any records event that
// deletes, restores or names a record the trash shows (or a coarse one)
// settles the open trash views 1.5 s after the last, spread 0 to 2 s, so
// records deleted, restored or purged anywhere appear and vanish. Loaded
// lazily, with the records layer's windows, view and store.
import type { ChangeEvent, RestoreResults, TrashCount, TrashItem, TrashPage } from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import { createPlainStore } from '../records/plain-store.ts';
import { TRASH_NAME_COLUMN } from './columns.ts';
import type { RecordBody } from '../records/store.ts';
import { createRecordView, nextFrame, type RecordSource, type Scheduler } from '../records/view.ts';
import { createWindows, type WindowCount } from '../records/windows.ts';

/** Rows per block of the trash. */
const BLOCK_SIZE = 100;
/** A settle's wait after the last change, and its random spread (spec 0006's settle). */
const SETTLE_MS = 1500;
const SPREAD_MS = 2000;

/** The most records one restore brings back (spec 0022): more waits for background jobs. */
export const MAX_RESTORE_RECORDS = 500;

/** A records change event (spec 0007's union), as the live router hands it over. */
type RecordsEvent = Extract<ChangeEvent, { kind: 'records' }>;

/** One row of the trash: the trashed record, as the store keeps it (by its record id). */
export interface TrashRow extends RecordBody {
  readonly id: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly item: TrashItem;
}

/** Where a trash view stands. */
export type TrashStatus = 'loading' | 'ready' | 'error';

/** What a screen reads from a trash view, one object per change. */
export interface TrashState {
  /** The grid's RowSource. */
  readonly source: RecordSource<TrashRow>;
  readonly status: TrashStatus;
  readonly error?: DataError;
  /** The count for the label: exact, or "10,000+" when `atLeast`. */
  readonly count: WindowCount;
  /** A refused restore's reason, on the record's name cell (`${recordId}:name`). */
  readonly cellErrors: ReadonlyMap<string, string>;
}

/** The trash of one object, or of every object, for useSyncExternalStore (`useTrash`). */
export interface TrashView {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => TrashState;
  /** Loads the count and the blocks on screen again, after a failure. */
  readonly retry: () => void;
  /** Settles once the count and the first block are in, or failed. */
  readonly ready: () => Promise<void>;
  /** A screen shows it; the answer lets go (and forgets its refusals once nobody shows it). */
  readonly retain: () => () => void;
}

/** What a restore came to, for the screen's toast. */
export type RestoreSummary =
  | { readonly kind: 'too-many'; readonly limit: number }
  | { readonly kind: 'failed'; readonly error: DataError }
  | {
      readonly kind: 'done';
      readonly restored: number;
      readonly refused: number;
      /** The objects of the records restored, so their tables read again. */
      readonly objectIds: readonly string[];
    };

/** The calls the trash makes, each mapped to a DataError on failure. */
export interface TrashApi {
  readonly query: (
    input: { readonly workspace: string; readonly objectId?: string; readonly cursor?: string; readonly limit: number },
    signal: AbortSignal,
  ) => Promise<TrashPage>;
  readonly count: (
    input: { readonly workspace: string; readonly objectId?: string },
    signal: AbortSignal,
  ) => Promise<TrashCount>;
  readonly restore: (input: {
    readonly workspace: string;
    readonly recordIds: readonly string[];
    readonly mutationId: string;
  }) => Promise<RestoreResults>;
}

/** What the trash needs from createDataLayer. */
export interface TrashOptions {
  readonly api: TrashApi;
  readonly mintId: () => string;
  readonly schedule?: Scheduler;
  readonly later?: (run: () => void, ms: number) => () => void;
  readonly random?: () => number;
  /** Listens to a workspace's live changes while a trash view of it is shown; the answer stops. */
  readonly watch?: (workspace: string) => () => void;
  /** Settles once the workspace's head is read (spec 0007). */
  readonly beforeRead?: (workspace: string) => Promise<void>;
  readonly mutations?: {
    readonly sent: (mutationId: string) => void;
    readonly answered: (mutationId: string, echoes: number) => void;
    readonly forget: (mutationId: string) => void;
  };
}

/** One trash view and what the store needs to reach it. */
interface Entry {
  readonly workspace: string;
  readonly view: TrashView;
  /** Whether a loaded block holds the record. */
  readonly shows: (id: string) => boolean;
  /** Something changed: settle 1.5 s after the last change, spread. */
  readonly markDirty: () => void;
  /** Records gone from the trash (restored here): out of the rows, and the later blocks read again. */
  readonly drop: (ids: ReadonlySet<string>) => void;
  readonly invalidate: () => void;
  readonly dispose: () => void;
}

const row = (item: TrashItem): TrashRow => ({ id: item.recordId, values: {}, item });

/** The trash: a view per workspace and object filter, restores, and the live settle. */
export function createTrash({
  api,
  mintId,
  schedule = nextFrame,
  later = (run, ms) => {
    const id = setTimeout(run, ms);
    return () => {
      clearTimeout(id);
    };
  },
  random = Math.random,
  watch = () => () => undefined,
  beforeRead = () => Promise.resolve(),
  mutations = { sent: () => undefined, answered: () => undefined, forget: () => undefined },
}: TrashOptions) {
  const store = createPlainStore<TrashRow>();
  const entries = new Map<string, Entry>();
  // Rows on their way out (a restore under way), skipped by every view; refusals, by record and column.
  let leaving: ReadonlySet<string> = new Set();
  let cellErrors: ReadonlyMap<string, string> = new Map();
  const keyOf = (workspace: string, objectId: string | undefined) => `${workspace}\u0000${objectId ?? ''}`;
  const of = (workspace: string) => [...entries.values()].filter((entry) => entry.workspace === workspace);
  const invalidateAll = () => {
    for (const entry of entries.values()) entry.invalidate();
  };

  function open(workspace: string, objectId: string | undefined): Entry {
    let status: TrashStatus = 'loading';
    let error: DataError | undefined;
    let isCounted = false;
    let settleReady: () => void = () => undefined;
    let readyPromise = new Promise<void>((resolve) => {
      settleReady = resolve;
    });
    let countController = new AbortController();
    let retains = 0;
    let unwatch: (() => void) | undefined;
    let settleTimer: (() => void) | undefined;
    // An object, so a change that lands while a settle reads is seen after it (the linter can't see the await).
    const dirt = { isDirty: false };
    const isMarked = () => dirt.isDirty;
    let isSettling = false;

    const setStatus = (next: TrashStatus, failure?: DataError) => {
      if (status === next && error === failure) return;
      status = next;
      error = failure;
      inner.invalidate();
      if (next === 'loading') return;
      inner.flush();
      settleReady();
    };
    const windows = createWindows({
      mode: () => 'cursor',
      blockSize: BLOCK_SIZE,
      read: async (from, limit, signal) => {
        const page = await api.query(
          {
            workspace,
            ...(objectId === undefined ? {} : { objectId }),
            ...(from.cursor === undefined ? {} : { cursor: from.cursor }),
            limit,
          },
          signal,
        );
        store.receive(page.items.map(row), { hold: true });
        const ids = page.items.map((item) => item.recordId);
        return page.nextCursor === undefined ? { ids } : { ids, nextCursor: page.nextCursor };
      },
      onError: (failure) => {
        // Before it is ready, or a cursor refused, the view fails (Retry); after, the next scroll or settle asks again.
        if (status !== 'ready' || toDataError(failure).code === 'FILTER_INVALID') {
          setStatus('error', toDataError(failure));
        }
      },
      release: store.release,
      onStale: () => {
        markDirty();
      },
    });
    const inner = createRecordView({ store, windows, schedule, gone: () => leaving });
    const checkReady = () => {
      if (status !== 'loading' || !isCounted) return;
      if (windows.count() === 0 || windows.idAt(0) !== undefined) setStatus('ready');
    };
    windows.subscribe(checkReady);

    function refreshCount(): Promise<void> {
      countController.abort();
      const controller = new AbortController();
      countController = controller;
      return api.count({ workspace, ...(objectId === undefined ? {} : { objectId }) }, controller.signal).then(
        (told) => {
          if (countController !== controller) return;
          const isFirst = !isCounted;
          isCounted = true;
          windows.setCount(told);
          if (isFirst && windows.count() > 0) windows.show({ start: 0, end: Math.min(windows.count(), BLOCK_SIZE) });
          checkReady();
          inner.invalidate();
        },
        (failure: unknown) => {
          if (countController !== controller || controller.signal.aborted) return;
          if (status !== 'ready') setStatus('error', toDataError(failure));
        },
      );
    }

    async function settle(): Promise<void> {
      if (!dirt.isDirty || isSettling || status !== 'ready' || retains === 0) return;
      dirt.isDirty = false;
      isSettling = true;
      const controller = new AbortController();
      try {
        await Promise.all([windows.reread(controller.signal), refreshCount()]);
      } catch {
        // Left as it was: the next change, or Retry, asks again.
      } finally {
        isSettling = false;
      }
      if (isMarked()) markDirty();
    }
    function markDirty() {
      dirt.isDirty = true;
      if (retains === 0 || isSettling) return;
      settleTimer?.();
      settleTimer = later(
        () => {
          settleTimer = undefined;
          void settle();
        },
        SETTLE_MS + Math.round(random() * SPREAD_MS),
      );
    }

    function start() {
      void beforeRead(workspace).then(() => refreshCount());
    }

    let lastSource: RecordSource<TrashRow> | undefined;
    let lastErrors = cellErrors;
    let lastStatus: TrashStatus = status;
    let snapshot: TrashState | undefined;
    const view: TrashView = {
      subscribe: inner.subscribe,
      getSnapshot: () => {
        const source = inner.getSnapshot();
        if (snapshot === undefined || source !== lastSource || cellErrors !== lastErrors || status !== lastStatus) {
          lastSource = source;
          lastErrors = cellErrors;
          lastStatus = status;
          const told = windows.told();
          const goneHere = [...leaving].filter((id) => windows.has(id)).length;
          snapshot = {
            source,
            status,
            cellErrors,
            count: goneHere === 0 ? told : { ...told, count: Math.max(0, told.count - goneHere) },
            ...(error === undefined ? {} : { error }),
          };
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
        isCounted = false;
        windows.restart();
        void refreshCount();
      },
      ready: () => readyPromise,
      retain: () => {
        retains += 1;
        if (retains === 1) {
          unwatch = watch(workspace);
          if (dirt.isDirty) markDirty();
        }
        let isReleased = false;
        return () => {
          if (isReleased) return;
          isReleased = true;
          retains -= 1;
          if (retains > 0) return;
          unwatch?.();
          unwatch = undefined;
          // The member left the trash: its refusals go with it, and it reads afresh next time.
          const key = keyOf(workspace, objectId);
          later(() => {
            if (retains > 0 || entries.get(key) !== entry) return;
            entries.delete(key);
            entry.dispose();
          }, 30_000);
          setCellErrors([...cellErrors.keys()]);
        };
      },
    };
    const entry: Entry = {
      workspace,
      view,
      shows: (id) => windows.has(id),
      markDirty,
      drop: (ids) => {
        windows.drop(ids);
      },
      invalidate: inner.invalidate,
      dispose: () => {
        countController.abort();
        settleTimer?.();
        unwatch?.();
        inner.dispose();
      },
    };
    start();
    return entry;
  }

  /** Clears the refusals on these cells. */
  function setCellErrors(clear: readonly string[], add: readonly (readonly [string, string])[] = []) {
    if (clear.length === 0 && add.length === 0) return;
    const next = new Map(cellErrors);
    for (const key of clear) next.delete(key);
    for (const [key, message] of add) next.set(key, message);
    cellErrors = next;
    invalidateAll();
  }

  return {
    /** The trash of one object, or every object, for one screen (the same view for each screen asking). */
    view: (workspace: string, objectId?: string): TrashView => {
      const key = keyOf(workspace, objectId);
      const held = entries.get(key);
      if (held !== undefined) return held.view;
      const entry = open(workspace, objectId);
      entries.set(key, entry);
      return entry.view;
    },

    /**
     * Restores up to 500 trashed records (spec 0022, AC-534): their rows
     * leave at once; what came back leaves the trash for good, and a refused
     * record returns with its reason on its name cell. Answers how many came
     * back and how many were refused, and the objects restored into.
     */
    restore: async (workspace: string, recordIds: readonly string[]): Promise<RestoreSummary> => {
      const ids = [...new Set(recordIds)];
      if (ids.length > MAX_RESTORE_RECORDS) return { kind: 'too-many', limit: MAX_RESTORE_RECORDS };
      if (ids.length === 0) return { kind: 'done', restored: 0, refused: 0, objectIds: [] };
      const objectOf = new Map(ids.map((id) => [id, store.get(id)?.item.objectId]));
      const nameCell = (id: string) => `${id}:${TRASH_NAME_COLUMN}`;
      setCellErrors(ids.map(nameCell));
      leaving = new Set([...leaving, ...ids]);
      invalidateAll();
      const mutationId = mintId();
      mutations.sent(mutationId);
      const stop = () => {
        const done = new Set(ids);
        leaving = new Set([...leaving].filter((id) => !done.has(id)));
      };
      let results: RestoreResults['results'];
      try {
        const answer = await api.restore({ workspace, recordIds: ids, mutationId });
        mutations.answered(mutationId, answer.echoes);
        results = answer.results;
      } catch (error) {
        mutations.forget(mutationId);
        stop();
        invalidateAll();
        return { kind: 'failed', error: toDataError(error) };
      }
      const back = new Set(results.filter((result) => result.state !== 'refused').map((result) => result.recordId));
      const refused = results.filter((result) => result.state === 'refused');
      for (const entry of of(workspace)) {
        entry.drop(back);
        entry.markDirty();
      }
      store.remove([...back]);
      stop();
      setCellErrors(
        [],
        refused.flatMap((result) =>
          result.refusal === undefined ? [] : [[nameCell(result.recordId), result.refusal.message] as const],
        ),
      );
      const objectIds = [
        ...new Set(
          [...back].flatMap((id) => {
            const objectId = objectOf.get(id);
            return objectId === undefined ? [] : [objectId];
          }),
        ),
      ];
      return { kind: 'done', restored: back.size, refused: refused.length, objectIds };
    },

    /**
     * A records event (spec 0007): one that deletes or restores records,
     * names a record a trash view shows (a purge, a rename), or is coarse
     * settles the workspace's open trash views.
     */
    changed: (workspace: string, event: RecordsEvent): void => {
      const moves =
        event.coarse === true ||
        (event.deletedIds?.length ?? 0) > 0 ||
        (event.restoredIds?.length ?? 0) > 0 ||
        event.recordIds.some((id) => of(workspace).some((entry) => entry.shows(id)));
      if (!moves) return;
      for (const entry of of(workspace)) entry.markDirty();
    },

    /** Changes may have been missed, or this tab deleted or restored records: the open trash views settle. */
    reload: (workspace: string): void => {
      for (const entry of of(workspace)) entry.markDirty();
    },

    /** Forgets everything (sign out, or a workspace switch). */
    clear: (): void => {
      for (const entry of entries.values()) entry.dispose();
      entries.clear();
      store.clear();
      leaving = new Set();
      cellErrors = new Map();
    },
  };
}

/** The trash, as createDataLayer holds it once loaded. */
export type Trash = ReturnType<typeof createTrash>;
