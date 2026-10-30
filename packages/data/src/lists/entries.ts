// A list's entries in the browser (spec 0048, AC-4809, AC-4810, AC-4839,
// AC-4840), loaded with the first list screen. Entries live in a store of
// their own (the plain record store's module, keyed by entry id, with its
// layers, so an entry edit shows at once and rolls back on a refusal); their
// records live in the records layer's one store, never here, so a record
// edited anywhere shows in every list row at once. A list row is the two
// joined: the record's values with the entry's own on top (their attribute
// ids never clash). Windows of entry ids page a list as an object's table is
// paged (spec 0006), always by cursor. A list board is its columns' first
// cards from `entries.groups`. Live `entries` events read the named entries
// again and settle the list's views once their rows may have moved.
import type {
  EntryGroups,
  EntryPage,
  EntryResults,
  EntryView,
  FilterGroup,
  RecordRefDisplay,
  RecordView,
  SortRule,
  WrittenEntry,
} from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import type { MutationLog } from '../live/mutations.ts';
import type { LiveEventOf } from '../live/router.ts';
import type { Notice } from '../notice.ts';
import type { ExternalEntry } from '../records/history.ts';
import type { NameState, RecordRef } from '../records/names.ts';
import { createPlainStore } from '../records/plain-store.ts';
import type { RecordBody, RecordStore, StoreListener } from '../records/store.ts';
import { createRecordView, nextFrame, type RecordSource, type RowNote, type Scheduler } from '../records/view.ts';
import { createWindows, type WindowCount } from '../records/windows.ts';

/** The calls the lists layer makes, each mapped to a DataError by the data layer. */
export interface EntriesApi {
  readonly query: (
    input: {
      readonly workspace: string;
      readonly listId: string;
      readonly cursor?: string;
      readonly limit: number;
      readonly filter?: FilterGroup;
      readonly sorts?: readonly SortRule[];
      readonly attributeIds: readonly string[];
    },
    signal: AbortSignal,
  ) => Promise<EntryPage>;
  readonly count: (
    input: { readonly workspace: string; readonly listId: string; readonly filter?: FilterGroup },
    signal: AbortSignal,
  ) => Promise<WindowCount>;
  readonly groups: (
    input: {
      readonly workspace: string;
      readonly listId: string;
      readonly groupBy: string;
      readonly groupIds: readonly (string | null)[];
      readonly filter?: FilterGroup;
      readonly sorts?: readonly SortRule[];
      readonly attributeIds: readonly string[];
    },
    signal: AbortSignal,
  ) => Promise<EntryGroups>;
  readonly get: (input: {
    readonly workspace: string;
    readonly ids: readonly string[];
  }) => Promise<Omit<EntryPage, 'nextCursor'>>;
  readonly membership: (input: {
    readonly workspace: string;
    readonly listId: string;
    readonly recordIds: readonly string[];
  }) => Promise<{ readonly recordIds: readonly string[] }>;
  readonly add: (input: {
    readonly workspace: string;
    readonly id: string;
    readonly listId: string;
    readonly recordId: string;
    readonly values?: Readonly<Record<string, unknown>>;
    readonly timeZone: string;
    readonly mutationId: string;
  }) => Promise<WrittenEntry>;
  readonly addMany: (input: {
    readonly workspace: string;
    readonly listId: string;
    readonly recordIds: readonly string[];
    readonly ids: readonly string[];
    readonly timeZone: string;
    readonly mutationId: string;
  }) => Promise<{
    readonly added: readonly { readonly recordId: string; readonly entryId: string }[];
    readonly alreadyIn: readonly string[];
    readonly refused: readonly { readonly recordId: string; readonly code: string; readonly message: string }[];
    readonly echoes: number;
  }>;
  readonly forRecord: (input: {
    readonly workspace: string;
    readonly recordId: string;
  }) => Promise<{ readonly entries: readonly EntryView[] }>;
  readonly setValues: (input: {
    readonly workspace: string;
    readonly entryId: string;
    readonly values: Readonly<Record<string, { readonly value: unknown; readonly baseVersionId?: string | null }>>;
    readonly mutationId: string;
  }) => Promise<WrittenEntry>;
  readonly remove: (input: {
    readonly workspace: string;
    readonly entryIds: readonly string[];
    readonly mutationId: string;
  }) => Promise<EntryResults>;
  readonly restore: (input: {
    readonly workspace: string;
    readonly entryIds: readonly string[];
    readonly mutationId: string;
  }) => Promise<EntryResults>;
}

/** The records layer's one store of records, and its undo stack, as a list's rows share them. */
export interface SharedRecords {
  readonly receive: (rows: readonly RecordView[], options?: { readonly hold?: boolean }) => void;
  readonly hold: (ids: Iterable<string>) => void;
  readonly release: (ids: Iterable<string>) => void;
  readonly get: (id: string) => RecordView | undefined;
  readonly subscribe: (listener: StoreListener) => () => void;
  readonly pushUndo: (workspace: string, entry: ExternalEntry) => void;
  /** The names of records a cell links to (read in the next frame when not known). */
  readonly displaysOf: (workspace: string, refs: readonly RecordRef[]) => readonly NameState[];
  /** Names arrived in a workspace; the answer stops listening. */
  readonly onNames: (listener: (workspace: string) => void) => () => void;
}

/** A list, as its entries' calls need it. */
export interface ListRef {
  readonly id: string;
  readonly objectId: string;
  readonly name: string;
}

/**
 * One row of a list (spec 0048, AC-4807): its entry and its record joined.
 * `values` holds the record's fields and the entry's own on top; `display` is
 * the record's chip (its name, tile and hue).
 */
export interface ListRow extends RecordBody {
  /** The entry's id: the row's key. */
  readonly id: string;
  readonly recordId: string;
  readonly entry: EntryView;
  /** The record, while the records store holds it (a row whose record is still on its way shows its entry). */
  readonly record?: RecordView;
  readonly display?: RecordRefDisplay;
  readonly values: Readonly<Record<string, unknown>>;
  readonly versions: Readonly<Record<string, string>>;
}

/** Where a list's rows stand. */
export type EntriesStatus = 'loading' | 'ready' | 'error';

/** What a list's table reads, one object per change. */
export interface EntriesState {
  readonly source: RecordSource<ListRow>;
  readonly status: EntriesStatus;
  readonly error?: DataError;
  readonly count: WindowCount;
  /** Refused list values by `${entryId}:${attributeId}`, to their sentence; each goes with the cell's next edit. */
  readonly cellErrors: ReadonlyMap<string, string>;
  /** The member's own new rows (AC-4813): pinned first, marked new. */
  readonly rowNotes: ReadonlyMap<string, RowNote>;
  /** How the records a cell links to show: each one's display, `loading`, or `unknown` (one field design). */
  readonly referenceDisplays: (refs: readonly RecordRef[]) => readonly NameState[];
}

/** A list's entries as one screen shows them, for useSyncExternalStore. */
export interface EntriesView {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => EntriesState;
  /** Loads the count and the rows on screen again, after a failure. */
  readonly retry: () => void;
  /** Settles once the count and the first rows have loaded, or failed. */
  readonly ready: () => Promise<void>;
  /** A screen shows it: the answer lets go. A view nobody shows for 30 seconds goes. */
  readonly retain: () => () => void;
}

/** One column of a list board: its first entries (by id, in order), its count, and whether more wait. */
export interface ListBoardColumn {
  readonly id: string | null;
  readonly entryIds: readonly string[];
  readonly count: number;
  readonly atLeast: boolean;
  readonly hasMore: boolean;
}

/** What a list board reads. */
export interface ListBoardState {
  readonly status: EntriesStatus;
  readonly error?: DataError;
  readonly columns: readonly ListBoardColumn[];
  /** The rows the board's cards show, by entry id. */
  readonly rowOf: (entryId: string) => ListRow | undefined;
  /** How the records a card's field links to show. */
  readonly referenceDisplays: (refs: readonly RecordRef[]) => readonly NameState[];
}

/** A list board, for useSyncExternalStore. */
export interface ListBoard {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ListBoardState;
  readonly retry: () => void;
  readonly retain: () => () => void;
}

/** What an add answered (AC-4813, AC-4814): the entry made, or the refusal's code and sentence. */
export type AddOutcome =
  | { readonly kind: 'added'; readonly entry: EntryView; readonly record?: RecordView }
  | { readonly kind: 'refused'; readonly code: string; readonly message: string };

/** What adding many records answered (AC-4825): counts, the first refusal's sentence, and the Undo for those added. */
export interface AddManyOutcome {
  readonly added: number;
  readonly alreadyIn: number;
  readonly refused: number;
  readonly reason?: string;
  readonly undoId?: string;
}

/** A record's entries as its page's Lists section reads them (AC-4822). */
export interface RecordEntriesState {
  readonly status: EntriesStatus;
  /** The record's live entries in readable lists, by list name then Added, as joined rows (an entry card's values). */
  readonly rows: readonly ListRow[];
}

/** A record's entries, for useSyncExternalStore. */
export interface RecordEntries {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => RecordEntriesState;
  readonly retry: () => void;
  readonly retain: () => () => void;
}

/** What a removal answered (AC-4817): how many left, how many stayed and why, and the Undo for those that left. */
export interface RemoveOutcome {
  readonly removed: number;
  readonly kept: number;
  readonly reason?: string;
  /** The undo stack's id for this removal: a toast's Undo passes it to `data.undo.run`. */
  readonly undoId?: string;
}

/** Every sentence the lists layer says itself (its toasts); the screens' words live with the screens. */
export const LIST_WORDS = {
  removed: (name: string, list: string) => `Removed ${name} from ${list}`,
  removedMany: (count: number, list: string) =>
    `Removed ${count.toLocaleString('en')} ${count === 1 ? 'entry' : 'entries'} from ${list}`,
  restored: (list: string) => `Put back in ${list}`,
  restoredSome: (back: number, kept: number, reason: string) =>
    `Put ${back.toLocaleString('en')} back. ${kept.toLocaleString('en')} stayed out: ${reason}`,
  undidCell: (title: string, name: string) => `Undid ${title} on ${name}`,
  undidAdd: (name: string, list: string) => `Took ${name} out of ${list} again`,
  undidAddMany: (count: number, list: string) =>
    `Took ${count.toLocaleString('en')} ${count === 1 ? 'entry' : 'entries'} out of ${list} again`,
  couldNotUndo: 'That change couldn’t be undone.',
} as const;

/** What the lists layer needs from createDataLayer. */
export interface EntriesLayerOptions {
  readonly api: EntriesApi;
  readonly records: SharedRecords;
  readonly notify: (notice: Notice) => void;
  readonly mintId: () => string;
  readonly mutations: MutationLog;
  /** Live updates for the workspace while a view holds it; the answer lets go. */
  readonly watch: (workspace: string) => () => void;
  readonly refusalSummary: (error: DataError) => string;
  /** The member's time zone in the workspace, for date defaults. */
  readonly timeZone: (workspace: string) => string;
  readonly schedule?: Scheduler;
  /** Runs `run` after `ms`; answers a cancel. */
  readonly later?: (run: () => void, ms: number) => () => void;
  /** How long a view nobody shows is kept: 30 seconds. */
  readonly keepUnusedMs?: number;
}

/** How long after a live change that may move rows a list's views settle (spec 0006's 1.5 s). */
export const ENTRIES_SETTLE_MS = 1500;

/** Rows per read: the API's most. */
const BLOCK = 100;

/** The calls one board read asks at most. */
const COLUMNS_PER_CALL = 12;

const timer = (run: () => void, ms: number) => {
  const id = setTimeout(run, ms);
  return () => {
    clearTimeout(id);
  };
};

/** One open view, as the layer keeps it. */
interface OpenView {
  readonly workspace: string;
  readonly listId: string;
  readonly view: EntriesView;
  readonly settle: () => void;
  readonly pin: (entryId: string) => void;
  readonly drop: (ids: ReadonlySet<string>) => void;
  readonly setCellError: (key: string, message: string | undefined) => void;
  readonly invalidate: () => void;
}

/** One open board, as the layer keeps it. */
interface OpenBoard {
  readonly workspace: string;
  readonly listId: string;
  readonly board: ListBoard;
  readonly settle: () => void;
  readonly invalidate: () => void;
}

/** One open record section, as the layer keeps it. */
interface OpenRecordEntries {
  readonly workspace: string;
  readonly recordId: string;
  readonly view: RecordEntries;
  readonly refresh: () => void;
  /** Shows an entry this tab is adding at once, after the held ones, until a read answers it or `hide`. */
  readonly show: (entryId: string) => void;
  readonly hide: (entryId: string) => void;
}

/** The lists layer: entries' views, boards and writes. */
export function createEntriesLayer({
  api,
  records,
  notify,
  mintId,
  mutations,
  watch,
  refusalSummary,
  timeZone,
  schedule = nextFrame,
  later = timer,
  keepUnusedMs = 30_000,
}: EntriesLayerOptions) {
  const entries = createPlainStore<EntryView>();
  // Each held entry's record, so a row knows which record to read and a record change finds its rows.
  const recordOf = new Map<string, string>();
  const rowsOfRecord = new Map<string, Set<string>>();
  const views = new Map<string, OpenView>();
  const boards = new Map<string, OpenBoard>();
  const rows = new WeakMap<EntryView, { record: RecordView | undefined; row: ListRow }>();
  // Entries on their way out (a removal sent), skipped at once in every view.
  const leaving = new Set<string>();

  const remember = (entry: EntryView) => {
    recordOf.set(entry.id, entry.recordId);
    const set = rowsOfRecord.get(entry.recordId) ?? new Set<string>();
    set.add(entry.id);
    rowsOfRecord.set(entry.recordId, set);
  };

  /** The row an entry shows as, joined with its record; the same object until either changes. */
  const rowOf = (entryId: string): ListRow | undefined => {
    const entry = entries.get(entryId);
    if (entry === undefined) return undefined;
    const record = records.get(entry.recordId);
    const known = rows.get(entry);
    if (known !== undefined && known.record === record) return known.row;
    const row: ListRow = {
      id: entry.id,
      recordId: entry.recordId,
      entry,
      ...(record === undefined ? {} : { record, display: record.display }),
      values: { ...(record?.values ?? {}), ...entry.values },
      versions: { ...(record?.versions ?? {}), ...entry.versions },
    };
    rows.set(entry, { record, row });
    return row;
  };

  /** The joined rows as a store, for the grid's view: entries by id, with each one's record held beside it. */
  const joined: RecordStore<ListRow> = {
    get: rowOf,
    base: rowOf,
    receive: () => undefined,
    hold: (ids) => {
      const list = [...ids];
      entries.hold(list);
      records.hold(list.flatMap((id) => (recordOf.has(id) ? [recordOf.get(id) ?? ''] : [])));
    },
    release: (ids) => {
      const list = [...ids];
      records.release(list.flatMap((id) => (recordOf.has(id) ? [recordOf.get(id) ?? ''] : [])));
      entries.release(list);
    },
    remove: (ids) => {
      entries.remove(ids);
    },
    edit: () => {
      throw new Error('A list row is edited through setCell.');
    },
    create: () => {
      throw new Error('A list row is made by adding an entry.');
    },
    pending: () => entries.pending(),
    subscribe: (listener) => {
      const stopEntries = entries.subscribe(listener);
      const stopRecords = records.subscribe((ids) => {
        const touched = new Set<string>();
        for (const id of ids) for (const entryId of rowsOfRecord.get(id) ?? []) touched.add(entryId);
        if (touched.size > 0) listener(touched);
      });
      return () => {
        stopEntries();
        stopRecords();
      };
    },
    size: () => entries.size(),
    clear: () => {
      entries.clear();
    },
  };

  /** Puts a read's entries and records in their stores, each entry and its record held once (a window's block). */
  const take = (
    page: { readonly entries: readonly EntryView[]; readonly records: readonly RecordView[] },
    hold: boolean,
  ) => {
    for (const entry of page.entries) remember(entry);
    // Held first, each record once per entry showing it, so the store keeps what it receives.
    if (hold) records.hold(page.entries.map((entry) => entry.recordId));
    records.receive(page.records);
    entries.receive(page.entries, { hold });
  };

  const keyOf = (workspace: string, listId: string, query: unknown, attributeIds: readonly string[]) =>
    `${workspace}\u0000${listId}\u0000${JSON.stringify(query)}\u0000${[...attributeIds].sort().join(',')}`;

  /**
   * A list's rows in the view's filter and sorts (AC-4808, AC-4809), the same
   * view for every screen asking it: a count, windows by cursor, and the
   * member's own new rows pinned first. `attributeIds` are the record fields
   * the rows show.
   */
  function view(
    workspace: string,
    list: ListRef,
    query: { readonly filter?: FilterGroup; readonly sorts?: readonly SortRule[] },
    attributeIds: readonly string[],
  ): EntriesView {
    const key = keyOf(workspace, list.id, query, attributeIds);
    const open = views.get(key);
    if (open !== undefined) return open.view;
    const listeners = new Set<() => void>();
    let status: EntriesStatus = 'loading';
    let error: DataError | undefined;
    let count: WindowCount = { count: 0, atLeast: false };
    let cellErrors: ReadonlyMap<string, string> = new Map();
    let rowNotes: ReadonlyMap<string, RowNote> = new Map();
    let countControl: AbortController | undefined;
    let readyWaiters: (() => void)[] = [];
    let held = 0;
    let stopWatch: (() => void) | undefined;
    let cancelDrop: (() => void) | undefined;
    let cancelSettle: (() => void) | undefined;
    const announce = () => {
      for (const listener of listeners) listener();
    };
    const windows = createWindows({
      mode: () => 'cursor',
      read: async (from, limit, signal) => {
        const page = await api.query(
          {
            workspace,
            listId: list.id,
            ...(from.cursor === undefined ? {} : { cursor: from.cursor }),
            limit: Math.min(limit, 200),
            ...(query.filter === undefined ? {} : { filter: query.filter }),
            ...(query.sorts === undefined ? {} : { sorts: query.sorts }),
            attributeIds,
          },
          signal,
        );
        take(page, true);
        return {
          ids: page.entries.map((entry) => entry.id),
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        };
      },
      blockSize: BLOCK,
      release: (ids) => {
        joined.release(ids);
      },
      onError: (failed) => {
        error = toDataError(failed);
        status = 'error';
        store.invalidate();
      },
      onRead: () => {
        if (status === 'error') {
          status = 'ready';
          error = undefined;
        }
      },
      onStale: () => {
        readCount();
      },
    });
    const store = createRecordView<ListRow>({
      store: joined,
      windows,
      schedule,
      gone: () => leaving,
    });
    let snapshot: EntriesState | undefined;
    const referenceDisplays = (refs: readonly RecordRef[]) => records.displaysOf(workspace, refs);
    const stateOf = (): EntriesState => ({
      source: store.getSnapshot(),
      status,
      ...(error === undefined ? {} : { error }),
      count,
      cellErrors,
      rowNotes,
      referenceDisplays,
    });
    store.subscribe(() => {
      snapshot = undefined;
      announce();
    });
    const settleReady = () => {
      const waiting = readyWaiters;
      readyWaiters = [];
      for (const resolve of waiting) resolve();
    };
    function readCount() {
      countControl?.abort();
      const control = new AbortController();
      countControl = control;
      api
        .count(
          { workspace, listId: list.id, ...(query.filter === undefined ? {} : { filter: query.filter }) },
          control.signal,
        )
        .then(
          (answer) => {
            if (control.signal.aborted) return;
            count = answer;
            windows.setCount(answer);
            if (status === 'loading') status = 'ready';
            store.invalidate();
            settleReady();
          },
          (failed: unknown) => {
            if (control.signal.aborted) return;
            error = toDataError(failed);
            status = 'error';
            store.invalidate();
            settleReady();
          },
        );
    }
    const settle = () => {
      cancelSettle?.();
      cancelSettle = later(() => {
        cancelSettle = undefined;
        readCount();
        const control = new AbortController();
        windows.reread(control.signal).catch(() => undefined);
      }, ENTRIES_SETTLE_MS);
    };
    const made: EntriesView = {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: () => {
        snapshot ??= stateOf();
        return snapshot;
      },
      retry: () => {
        error = undefined;
        status = 'loading';
        store.invalidate();
        readCount();
        windows.refresh();
      },
      ready: () =>
        status === 'loading'
          ? new Promise<void>((resolve) => {
              readyWaiters.push(resolve);
            })
          : Promise.resolve(),
      retain: () => {
        held += 1;
        cancelDrop?.();
        cancelDrop = undefined;
        stopWatch ??= watch(workspace);
        return () => {
          held -= 1;
          if (held > 0) return;
          cancelDrop = later(() => {
            if (held > 0) return;
            views.delete(key);
            countControl?.abort();
            cancelSettle?.();
            stopWatch?.();
            stopWatch = undefined;
            store.dispose();
          }, keepUnusedMs);
        };
      },
    };
    views.set(key, {
      workspace,
      listId: list.id,
      view: made,
      settle,
      pin: (entryId) => {
        store.setPins([
          { id: entryId, index: 0, note: 'new' },
          ...store.pins().map((pin) => ({ ...pin, index: pin.index + 1 })),
        ]);
        rowNotes = new Map([...rowNotes, [entryId, 'new']]);
        count = { ...count, count: count.count + 1 };
        store.invalidate();
      },
      drop: (ids) => {
        windows.drop(ids);
        const pins = store.pins().filter((pin) => !ids.has(pin.id));
        if (pins.length !== store.pins().length) store.setPins(pins);
        store.invalidate();
      },
      setCellError: (cell, message) => {
        const next = new Map(cellErrors);
        if (message === undefined) next.delete(cell);
        else next.set(cell, message);
        cellErrors = next;
        store.invalidate();
      },
      invalidate: () => {
        store.invalidate();
      },
    });
    readCount();
    return made;
  }

  /**
   * A list board (AC-4820): the first 25 cards of each column (`groupIds`,
   * each an option or member id of `groupBy`, or null for no value) and its
   * count, read 12 columns a call, read again when the list changes.
   */
  function board(
    workspace: string,
    list: ListRef,
    input: {
      readonly groupBy: string;
      readonly groupIds: readonly (string | null)[];
      readonly filter?: FilterGroup;
      readonly sorts?: readonly SortRule[];
    },
    attributeIds: readonly string[],
  ): ListBoard {
    const key = `board\u0000${keyOf(workspace, list.id, input, attributeIds)}`;
    const open = boards.get(key);
    if (open !== undefined) return open.board;
    const listeners = new Set<() => void>();
    const referenceDisplays = (refs: readonly RecordRef[]) => records.displaysOf(workspace, refs);
    let state: ListBoardState = { status: 'loading', columns: [], rowOf, referenceDisplays };
    let heldIds: readonly string[] = [];
    let control: AbortController | undefined;
    let held = 0;
    let stopWatch: (() => void) | undefined;
    let cancelDrop: (() => void) | undefined;
    let cancelSettle: (() => void) | undefined;
    let stopStores: (() => void) | undefined;
    const announce = () => {
      for (const listener of listeners) listener();
    };
    const set = (next: Omit<ListBoardState, 'rowOf' | 'referenceDisplays'>) => {
      state = { ...next, rowOf, referenceDisplays };
      announce();
    };
    const read = async () => {
      control?.abort();
      const current = new AbortController();
      control = current;
      try {
        const columns: ListBoardColumn[] = [];
        const kept: string[] = [];
        for (let start = 0; start < input.groupIds.length; start += COLUMNS_PER_CALL) {
          const answer = await api.groups(
            {
              workspace,
              listId: list.id,
              groupBy: input.groupBy,
              groupIds: input.groupIds.slice(start, start + COLUMNS_PER_CALL),
              ...(input.filter === undefined ? {} : { filter: input.filter }),
              ...(input.sorts === undefined ? {} : { sorts: input.sorts }),
              attributeIds,
            },
            current.signal,
          );
          if (current.signal.aborted) return;
          for (const group of answer.groups) {
            take({ entries: group.entries, records: group.records }, true);
            kept.push(...group.entries.map((entry) => entry.id));
            columns.push({
              id: group.id,
              entryIds: group.entries.map((entry) => entry.id),
              count: group.count,
              atLeast: group.atLeast,
              hasMore: group.nextCursor !== undefined,
            });
          }
        }
        joined.release(heldIds);
        heldIds = kept;
        set({
          status: 'ready',
          columns: columns.map((column) => ({ ...column, entryIds: column.entryIds.filter((id) => !leaving.has(id)) })),
        });
      } catch (failed) {
        if (current.signal.aborted) return;
        set({ status: 'error', error: toDataError(failed), columns: state.columns });
      }
    };
    const settle = () => {
      cancelSettle?.();
      cancelSettle = later(() => {
        cancelSettle = undefined;
        void read();
      }, 300);
    };
    const made: ListBoard = {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: () => state,
      retry: () => {
        set({ status: 'loading', columns: state.columns });
        void read();
      },
      retain: () => {
        held += 1;
        cancelDrop?.();
        cancelDrop = undefined;
        stopWatch ??= watch(workspace);
        // A held card's entry or record changed: the board draws again.
        stopStores ??= joined.subscribe((ids) => {
          if (heldIds.some((id) => ids.has(id))) set({ ...state });
        });
        return () => {
          held -= 1;
          if (held > 0) return;
          cancelDrop = later(() => {
            if (held > 0) return;
            boards.delete(key);
            control?.abort();
            cancelSettle?.();
            stopStores?.();
            stopStores = undefined;
            stopWatch?.();
            stopWatch = undefined;
            joined.release(heldIds);
            heldIds = [];
          }, keepUnusedMs);
        };
      },
    };
    boards.set(key, {
      workspace,
      listId: list.id,
      board: made,
      settle,
      invalidate: () => {
        set({ ...state });
      },
    });
    void read();
    return made;
  }

  // Names arrived: the rows and cards showing links in that workspace draw them.
  records.onNames((workspace) => {
    for (const open of views.values()) if (open.workspace === workspace) open.invalidate();
    for (const open of boards.values()) if (open.workspace === workspace) open.invalidate();
  });

  /** Every open view and board of a list settles: its count and rows read again. */
  const settleList = (workspace: string, listId: string) => {
    for (const open of views.values()) if (open.workspace === workspace && open.listId === listId) open.settle();
    for (const open of boards.values()) if (open.workspace === workspace && open.listId === listId) open.settle();
  };

  /** Runs one write with its mutation id logged, so its own echo is skipped (spec 0006, AC-60). */
  async function sent<T extends { readonly echoes: number }>(write: (mutationId: string) => Promise<T>): Promise<T> {
    const mutationId = mintId();
    mutations.sent(mutationId);
    try {
      const answer = await write(mutationId);
      mutations.answered(mutationId, answer.echoes);
      return answer;
    } catch (failed) {
      mutations.forget(mutationId);
      throw failed;
    }
  }

  /** An entry as the store holds it, from a write's answer. */
  const entryOf = (written: WrittenEntry): EntryView => ({
    id: written.id,
    listId: written.listId,
    recordId: written.recordId,
    createdAt: written.createdAt,
    createdBy: written.createdBy,
    updatedAt: written.updatedAt,
    updatedBy: written.updatedBy,
    values: written.values,
    versions: written.versions,
  });

  /**
   * Adds a record to a list (AC-4813, AC-4814): once the server answers, the
   * row shows first in every open view of the list, marked new, and Cmd+Z
   * takes it out again. A refusal (`ENTRY_EXISTS` when someone else added it
   * meanwhile) answers its sentence for the screen's toast.
   */
  async function add(
    workspace: string,
    list: ListRef,
    recordId: string,
    values: Readonly<Record<string, unknown>> = {},
    id: string = mintId(),
  ): Promise<AddOutcome> {
    // The record's open Lists sections show the card at once (AC-4823), from a draft that the answer replaces or a
    // refusal takes away.
    const sections = [...recordViews.values()].filter(
      (open) => open.workspace === workspace && open.recordId === recordId,
    );
    const now = new Date().toISOString();
    const draft: EntryView = {
      id,
      listId: list.id,
      recordId,
      createdAt: now,
      createdBy: { type: 'system', id: null },
      updatedAt: now,
      updatedBy: { type: 'system', id: null },
      values,
      versions: {},
    };
    const shown =
      sections.length === 0
        ? undefined
        : (() => {
            remember(draft);
            const layer = entries.create(draft, mintId());
            for (const open of sections) open.show(id);
            return layer;
          })();
    try {
      const written = await sent((mutationId) =>
        api.add({ workspace, id, listId: list.id, recordId, values, timeZone: timeZone(workspace), mutationId }),
      );
      const entry = entryOf(written);
      shown?.confirm(entry);
      // Held while the views pin it (each pin holds it too), then this hold lets go.
      take({ entries: [entry], records: written.record === undefined ? [] : [written.record] }, true);
      for (const open of views.values()) {
        if (open.workspace === workspace && open.listId === list.id) open.pin(entry.id);
      }
      joined.release([entry.id]);
      for (const open of boards.values()) if (open.workspace === workspace && open.listId === list.id) open.settle();
      const name = written.record?.display.name ?? '';
      records.pushUndo(workspace, {
        id: mintId(),
        kind: 'external',
        objectId: list.objectId,
        run: async () => {
          const outcome = await remove(workspace, list, [entry.id], false);
          return outcome.removed > 0
            ? { tone: 'success', message: LIST_WORDS.undidAdd(name, list.name) }
            : { tone: 'danger', message: outcome.reason ?? LIST_WORDS.couldNotUndo };
        },
      });
      refreshRecordEntries(workspace);
      return written.record === undefined ? { kind: 'added', entry } : { kind: 'added', entry, record: written.record };
    } catch (failed) {
      shown?.refuse();
      if (shown !== undefined) {
        // The draft's reverse index goes with it.
        recordOf.delete(id);
        rowsOfRecord.get(recordId)?.delete(id);
      }
      for (const open of sections) open.hide(id);
      const refusal = toDataError(failed);
      return { kind: 'refused', code: refusal.code, message: refusalSummary(refusal) };
    }
  }

  /**
   * Sets one list field of an entry (AC-4810): it shows at once in every row
   * and card showing the entry, saves, rolls back with the refusal's sentence
   * on the cell and in a toast, and goes on the undo stack. The last save wins;
   * the base version is sent so the server can name what it replaced.
   */
  async function setCell(
    workspace: string,
    list: ListRef,
    entryId: string,
    attribute: { readonly id: string; readonly title: string },
    value: unknown,
    options: { readonly undoable?: boolean } = {},
  ): Promise<boolean> {
    const base = entries.base(entryId);
    const before = base?.values[attribute.id] ?? null;
    const cell = `${entryId}:${attribute.id}`;
    for (const open of views.values()) open.setCellError(cell, undefined);
    const mutationId = mintId();
    const layer = entries.edit(entryId, { [attribute.id]: value }, mutationId);
    mutations.sent(mutationId);
    try {
      const written = await api.setValues({
        workspace,
        entryId,
        values: { [attribute.id]: { value, baseVersionId: base?.versions[attribute.id] ?? null } },
        mutationId,
      });
      mutations.answered(mutationId, written.echoes);
      layer.confirm(entryOf(written));
      if (written.record !== undefined) records.receive([written.record]);
      settleList(workspace, list.id);
      if (options.undoable !== false) {
        const name = records.get(written.recordId)?.display.name ?? '';
        records.pushUndo(workspace, {
          id: mintId(),
          kind: 'external',
          objectId: list.objectId,
          run: async () => {
            const done = await setCell(workspace, list, entryId, attribute, before, { undoable: false });
            return done
              ? { tone: 'success', message: LIST_WORDS.undidCell(attribute.title, name) }
              : { tone: 'danger', message: LIST_WORDS.couldNotUndo };
          },
        });
      }
      return true;
    } catch (failed) {
      mutations.forget(mutationId);
      layer.refuse();
      const message = refusalSummary(toDataError(failed));
      for (const open of views.values()) {
        if (open.workspace === workspace && open.listId === list.id) open.setCellError(cell, message);
      }
      notify({ tone: 'danger', message });
      return false;
    }
  }

  /**
   * Takes entries out of a list (AC-4817, AC-4818): their rows leave at once,
   * 500 a call; each refused one comes back, and the answer says how many and
   * why. With `undoable` (the default), Cmd+Z or the toast's Undo brings back
   * exactly those that left.
   */
  async function remove(
    workspace: string,
    list: ListRef,
    entryIds: readonly string[],
    undoable = true,
  ): Promise<RemoveOutcome> {
    const ids = [...new Set(entryIds)];
    for (const id of ids) leaving.add(id);
    const invalidate = () => {
      for (const open of views.values()) if (open.workspace === workspace && open.listId === list.id) open.invalidate();
    };
    invalidate();
    const left: string[] = [];
    let kept = 0;
    let reason: string | undefined;
    try {
      for (let start = 0; start < ids.length; start += 500) {
        const answer = await sent((mutationId) =>
          api.remove({ workspace, entryIds: ids.slice(start, start + 500), mutationId }),
        );
        for (const result of answer.results) {
          if (result.refusal === undefined) left.push(result.entryId);
          else {
            kept += 1;
            reason ??= result.refusal.message;
          }
        }
      }
    } catch (failed) {
      kept = ids.length - left.length;
      reason = refusalSummary(toDataError(failed));
    }
    for (const id of ids) leaving.delete(id);
    const gone = new Set(left);
    for (const open of views.values()) {
      if (open.workspace === workspace && open.listId === list.id) {
        open.drop(gone);
        open.settle();
      }
    }
    for (const open of boards.values()) if (open.workspace === workspace && open.listId === list.id) open.settle();
    invalidate();
    if (left.length === 0 || !undoable) {
      return { removed: left.length, kept, ...(reason === undefined ? {} : { reason }) };
    }
    const undoId = mintId();
    records.pushUndo(workspace, {
      id: undoId,
      kind: 'external',
      objectId: list.objectId,
      run: async () => {
        const back = await restore(workspace, list, left);
        if (back.kept === 0) return { tone: 'success', message: LIST_WORDS.restored(list.name) };
        return {
          tone: 'danger',
          message: LIST_WORDS.restoredSome(back.restored, back.kept, back.reason ?? LIST_WORDS.couldNotUndo),
        };
      },
    });
    return { removed: left.length, kept, ...(reason === undefined ? {} : { reason }), undoId };
  }

  /** Brings removed entries back with their values (AC-4818), 500 a call; the list's views settle. */
  async function restore(
    workspace: string,
    list: ListRef,
    entryIds: readonly string[],
  ): Promise<{ readonly restored: number; readonly kept: number; readonly reason?: string }> {
    let restored = 0;
    let kept = 0;
    let reason: string | undefined;
    try {
      for (let start = 0; start < entryIds.length; start += 500) {
        const answer = await sent((mutationId) =>
          api.restore({ workspace, entryIds: entryIds.slice(start, start + 500), mutationId }),
        );
        for (const result of answer.results) {
          if (result.refusal === undefined) restored += 1;
          else {
            kept += 1;
            reason ??= result.refusal.message;
          }
        }
      }
    } catch (failed) {
      kept = entryIds.length - restored;
      reason = refusalSummary(toDataError(failed));
    }
    settleList(workspace, list.id);
    return { restored, kept, ...(reason === undefined ? {} : { reason }) };
  }

  /**
   * Adds 1 to 500 records to a list in one request (AC-4825); more go in calls of 500. The list's open views and
   * boards settle, and the undo stack gets one entry that takes out exactly the entries made (no confirm).
   */
  async function addMany(workspace: string, list: ListRef, recordIds: readonly string[]): Promise<AddManyOutcome> {
    const unique = [...new Set(recordIds)];
    const made: string[] = [];
    let alreadyIn = 0;
    let refused = 0;
    let reason: string | undefined;
    try {
      for (let start = 0; start < unique.length; start += 500) {
        const part = unique.slice(start, start + 500);
        const answer = await sent((mutationId) =>
          api.addMany({
            workspace,
            listId: list.id,
            recordIds: part,
            ids: part.map(() => mintId()),
            timeZone: timeZone(workspace),
            mutationId,
          }),
        );
        for (const each of answer.added) made.push(each.entryId);
        alreadyIn += answer.alreadyIn.length;
        refused += answer.refused.length;
        reason ??= answer.refused[0]?.message;
      }
    } catch (failed) {
      refused += unique.length - made.length - alreadyIn - refused;
      reason = refusalSummary(toDataError(failed));
    }
    settleList(workspace, list.id);
    refreshRecordEntries(workspace);
    if (made.length === 0) {
      return { added: 0, alreadyIn, refused, ...(reason === undefined ? {} : { reason }) };
    }
    const undoId = mintId();
    records.pushUndo(workspace, {
      id: undoId,
      kind: 'external',
      objectId: list.objectId,
      run: async () => {
        const outcome = await remove(workspace, list, made, false);
        return outcome.removed > 0
          ? { tone: 'success', message: LIST_WORDS.undidAddMany(outcome.removed, list.name) }
          : { tone: 'danger', message: outcome.reason ?? LIST_WORDS.couldNotUndo };
      },
    });
    return { added: made.length, alreadyIn, refused, ...(reason === undefined ? {} : { reason }), undoId };
  }

  const recordViews = new Map<string, OpenRecordEntries>();

  /** Every open record section of the workspace reads again, in the next frame. */
  function refreshRecordEntries(workspace: string) {
    for (const open of recordViews.values()) if (open.workspace === workspace) open.refresh();
  }

  /**
   * A record's entries for its page's Lists section (AC-4822): one read of `entries.forRecord`, the entries held in
   * the one entry store (so an edit on a card shows in every row showing it, AC-4840), read again when an entry of the
   * workspace changes or this tab adds or removes one.
   */
  function forRecord(workspace: string, recordId: string): RecordEntries {
    const key = `${workspace}\u0000${recordId}`;
    const known = recordViews.get(key);
    if (known !== undefined) return known.view;
    const listeners = new Set<() => void>();
    let status: EntriesStatus = 'loading';
    let ids: readonly string[] = [];
    let held: readonly string[] = [];
    // Entries this tab is adding, shown after the read ones until a read answers them.
    let adding: readonly string[] = [];
    let shown = 0;
    let stopWatch: (() => void) | undefined;
    let stopStore: (() => void) | undefined;
    let cancelDrop: (() => void) | undefined;
    let isRefreshing = false;
    let version = 0;
    let state: RecordEntriesState = { status, rows: [] };
    const snapshot = () => {
      const rows = [...ids, ...adding.filter((id) => !ids.includes(id))].flatMap((id) => {
        const row = rowOf(id);
        return row === undefined ? [] : [row];
      });
      const same =
        state.status === status && state.rows.length === rows.length && state.rows.every((row, i) => row === rows[i]);
      if (!same) state = { status, rows };
      for (const listener of listeners) listener();
    };
    const read = async () => {
      version += 1;
      const mine = version;
      // The adds the server had answered before this read began: it answers for them, in or not (a section past 100,
      // or removed since). A draft still on its way (no base yet) waits for a later read.
      const answeredFor = adding.filter((id) => entries.base(id) !== undefined);
      try {
        const answer = await api.forRecord({ workspace, recordId });
        if (mine !== version) return;
        const next = answer.entries.map((entry) => entry.id);
        take({ entries: answer.entries, records: [] }, true);
        const previous = held;
        held = next;
        if (previous.length > 0) {
          records.release(previous.flatMap((id) => (recordOf.has(id) ? [recordOf.get(id) ?? ''] : [])));
          entries.release(previous);
        }
        ids = next;
        adding = adding.filter((id) => !next.includes(id) && !answeredFor.includes(id));
        status = 'ready';
      } catch {
        if (mine !== version) return;
        status = 'error';
      }
      snapshot();
    };
    // A live change reads again at most once a second and a half, so a busy list doesn't make every open record
    // page ask on every frame; held entries are patched in place by their own events already.
    const refresh = () => {
      if (shown === 0 || isRefreshing) return;
      isRefreshing = true;
      later(() => {
        isRefreshing = false;
        void read();
      }, ENTRIES_SETTLE_MS);
    };
    const show = (entryId: string) => {
      if (adding.includes(entryId)) return;
      adding = [...adding, entryId];
      snapshot();
    };
    const hide = (entryId: string) => {
      adding = adding.filter((id) => id !== entryId);
      snapshot();
    };
    const view: RecordEntries = {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: () => state,
      retry: () => {
        status = 'loading';
        snapshot();
        void read();
      },
      retain: () => {
        shown += 1;
        cancelDrop?.();
        cancelDrop = undefined;
        // Let go after its 30 seconds and shown again: the layer holds it once more, so live changes find it.
        recordViews.set(key, open);
        stopWatch ??= watch(workspace);
        stopStore ??= entries.subscribe((changedIds) => {
          if (ids.some((id) => changedIds.has(id)) || adding.some((id) => changedIds.has(id))) snapshot();
        });
        if (shown === 1) void read();
        return () => {
          shown -= 1;
          if (shown > 0) return;
          cancelDrop = later(() => {
            if (shown > 0) return;
            recordViews.delete(key);
            version += 1;
            stopStore?.();
            stopStore = undefined;
            stopWatch?.();
            stopWatch = undefined;
            records.release(held.flatMap((id) => (recordOf.has(id) ? [recordOf.get(id) ?? ''] : [])));
            entries.release(held);
            held = [];
          }, keepUnusedMs);
        };
      },
    };
    const open: OpenRecordEntries = { workspace, recordId, view, refresh, show, hide };
    recordViews.set(key, open);
    return view;
  }

  /** Which of these records (up to 50) are in the list already (AC-4814's "Already in this list"). */
  const membership = async (workspace: string, listId: string, recordIds: readonly string[]) =>
    recordIds.length === 0
      ? []
      : (await api.membership({ workspace, listId, recordIds: recordIds.slice(0, 50) })).recordIds;

  /**
   * A live `entries` event (AC-4839): the named entries this tab holds are
   * read again in place (one read a frame); ids the server no longer answers
   * leave every view; and the list's views settle when rows may have moved
   * (an entry made or gone, or a coarse change).
   */
  const changed = (workspace: string, event: LiveEventOf<'entries'>) => {
    const named = event.entryIds;
    refreshRecordEntries(workspace);
    const isHeld = (id: string) => entries.get(id) !== undefined;
    const heldIds = named.filter(isHeld);
    if (event.coarse === true || heldIds.length < named.length || named.length === 0)
      settleList(workspace, event.listId);
    if (heldIds.length === 0) return;
    schedule(() => {
      void api.get({ workspace, ids: heldIds }).then(
        (page) => {
          take(page, false);
          const answered = new Set(page.entries.map((entry) => entry.id));
          const gone = new Set(heldIds.filter((id) => !answered.has(id)));
          if (gone.size === 0) return;
          for (const open of views.values()) if (open.workspace === workspace) open.drop(gone);
          settleList(workspace, event.listId);
        },
        () => undefined,
      );
    });
  };

  /** Everything held of the workspace (or one list) settles: a resync after a gap, or a definitions change. */
  const reload = (workspace: string, listId?: string) => {
    refreshRecordEntries(workspace);
    for (const open of views.values())
      if (open.workspace === workspace && (listId === undefined || open.listId === listId)) open.settle();
    for (const open of boards.values())
      if (open.workspace === workspace && (listId === undefined || open.listId === listId)) open.settle();
  };

  return {
    view,
    board,
    add,
    setCell,
    remove,
    restore,
    membership,
    addMany,
    forRecord,
    changed,
    reload,
    /** The row an entry shows as now (a board card, a record page card). */
    rowOf,
    /** Forgets everything (sign out). */
    clear: () => {
      views.clear();
      boards.clear();
      entries.clear();
      recordOf.clear();
      rowsOfRecord.clear();
      leaving.clear();
    },
  };
}

/** The lists layer, as createDataLayer holds it once loaded. */
export type EntriesLayer = ReturnType<typeof createEntriesLayer>;
