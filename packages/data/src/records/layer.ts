// The records part of the data layer (spec 0005, task 11; spec 0006,
// milestone 1): one store of RecordView bodies for the app, a view per object
// (windows over the store, with a count and a status), optimistic creates and
// edits with rollback, cell refusals and toasts, and live patches: a change
// event's records fetched again in place, a new one placed at the end. Every
// edit names the base version it started from, a paste or a range clear is one
// batch write, the tab keeps its own written versions (the replaced notice)
// and an undo stack. createDataLayer loads this module when a screen first
// asks for records, so it stays out of the first load.
import type {
  BatchResults,
  CreateRecordInput,
  RecordCount,
  RecordPage,
  RecordView,
  ChangeEvent,
  SetValuesBatchInput,
  SetValuesInput,
  WrittenRecord,
} from '@crm/contracts';
import { canJump, type JumpAttribute } from '@crm/contracts/jump';
import type { FilterGroup, SortRules } from '@crm/contracts/values';
import { dataError, refusalFor, refusalSummary, toDataError, type DataError } from '../errors.ts';
import type { Notice } from '../notice.ts';
import { createOwnVersions, createUndoStack, type UndoCell, type UndoKind } from './history.ts';
import { createPlainStore, sameData } from './plain-store.ts';
import type { Layer } from './store.ts';

/** A records change event (spec 0007's union), as the live router hands it over. */
type RecordsEvent = Extract<ChangeEvent, { kind: 'records' }>;
import { createRecordView, nextFrame, type Pin, type RecordSource, type RowNote, type Scheduler } from './view.ts';
import { createWindows, type ReadFrom, type WindowCount, type WindowMode, type Windows } from './windows.ts';

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
/** The most records one paste, range clear or undo writes at once (`MAX_BATCH_RECORDS` in the contract, AC-50). */
export const MAX_BATCH_RECORDS = 500;
/** The most cells one write changes (`MAX_BATCH_CELLS` in the contract). */
export const MAX_BATCH_CELLS = 5_000;
/** The most a write may carry, under the API's 1 MB body limit with room for the ids around it. */
export const MAX_WRITE_BYTES = 900_000;
/** What each cell adds to a write besides its value: its attribute id, base version and the JSON around them. */
const CELL_OVERHEAD_BYTES = 120;
/** The longest spread before a refetch many browsers make at once (a count after an unplaced change), in ms. */
const SPREAD_MS = 2000;
/** How long a changed id is remembered, so a block that was loading when it changed fetches it again, in ms. */
const RECENT_MS = 10_000;
/** How long a window waits after the last change in it before it settles order and membership, in ms (AC-56). */
export const SETTLE_MS = 1500;
/** Read refusals that mean the view itself is wrong (a bad filter or sort, a gone object): its error state, Retry. */
const REFUSED_READS: ReadonlySet<string> = new Set(['FILTER_INVALID', 'NOT_FOUND', 'INPUT_INVALID']);

/** The question a view asks (spec 0006, AC-51): its filter and sorts. Two screens asking the same one share a window. */
export interface ViewQuery {
  readonly filter?: FilterGroup;
  readonly sorts?: SortRules;
}

/** What a window needs to know of its object: the primary attribute (always read) and each attribute's kind (its mode). */
export interface ObjectShape {
  readonly primaryAttributeId?: string;
  readonly attributes: readonly (JumpAttribute & { readonly id: string })[];
}

/** `value` as JSON with every object's keys in order and nothing undefined, so two spellings of one query match. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([name, item]) => `${JSON.stringify(name)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The attribute ids a filter names, at any depth (a through chain's own attribute included). */
function filterAttributes(group: FilterGroup | undefined): readonly string[] {
  if (group === undefined) return [];
  return group.conditions.flatMap((condition): readonly string[] => {
    if ('conditions' in condition) return filterAttributes(condition);
    return 'attributeId' in condition && typeof condition.attributeId === 'string' ? [condition.attributeId] : [];
  });
}

/**
 * What a change must touch to move a window's order or membership: the
 * attributes its filter and sorts name. `any` when every write can (a sort or
 * filter on updated at or updated by, which every write moves).
 */
function orderAttributesOf(query: ViewQuery, shape: ObjectShape | undefined): OrderAttributes {
  const ids = new Set([...filterAttributes(query.filter), ...(query.sorts ?? []).map((sort) => sort.attributeId)]);
  const moving = (shape?.attributes ?? []).filter(
    (attribute) => attribute.isSystem && (attribute.apiSlug === 'updated_at' || attribute.apiSlug === 'updated_by'),
  );
  return {
    ids,
    any: moving.some((attribute) => ids.has(attribute.id)),
    moving: new Set(moving.map((attribute) => attribute.id)),
  };
}

/** The attributes a window's order and membership depend on (`orderAttributesOf`). */
interface OrderAttributes {
  readonly ids: ReadonlySet<string>;
  readonly any: boolean;
  /** The object's updated at and updated by: every write moves them. */
  readonly moving: ReadonlySet<string>;
}

/** The calls the records layer makes, each mapped to a DataError on failure (a 401 has already signed out). */
export interface RecordsApi {
  readonly query: (
    input: ReadFrom &
      ViewQuery & {
        readonly workspace: string;
        readonly objectId: string;
        readonly limit: number;
        readonly attributeIds: readonly string[];
        readonly now: string;
        readonly timeZone: string;
      },
    signal: AbortSignal,
  ) => Promise<RecordPage>;
  readonly count: (
    input: {
      readonly workspace: string;
      readonly objectId: string;
      readonly filter?: FilterGroup;
      readonly now: string;
      readonly timeZone: string;
    },
    signal: AbortSignal,
  ) => Promise<RecordCount>;
  /** Records by id; with `attributeIds`, only those and the primary. */
  readonly get: (input: {
    readonly workspace: string;
    readonly ids: readonly string[];
    readonly attributeIds?: readonly string[];
  }) => Promise<RecordView[]>;
  readonly create: (input: CreateRecordInput) => Promise<WrittenRecord>;
  readonly setValues: (input: SetValuesInput) => Promise<WrittenRecord>;
  readonly setValuesBatch: (input: SetValuesBatchInput) => Promise<BatchResults>;
}

/** One cell a write changes: its value, and for an undo the version it must still be at (`ifVersionId`). */
interface CellWrite {
  readonly attributeId: string;
  readonly value: unknown;
  readonly ifVersionId?: string;
}

/** One record's cells in a write. */
interface RecordWrite {
  readonly recordId: string;
  readonly cells: readonly CellWrite[];
}

/** How a write is treated: pushed on the undo stack as this kind of action, and codes that roll back quietly. */
interface WriteOptions {
  readonly undo?: UndoKind;
  /** The action's mutation id, when the caller needs to know it (the undo entry's id); minted otherwise. */
  readonly mutationId?: string;
  /** Refusals that roll back with no cell mark (an undo's `VERSION_CHANGED`, which its own toast counts). */
  readonly quiet?: ReadonlySet<string>;
}

/** How one record's part of a write ended: landed (`row`), refused (`failure`), or gone on the server. */
interface RecordOutcome {
  readonly recordId: string;
  readonly cells: readonly CellWrite[];
  readonly row?: RecordView;
  /** With `row`: the version the write made for each attribute it changed (the answer's `written`). */
  readonly written?: Readonly<Record<string, string>>;
  /** With `row`: each cell's version in the base when the write went out, which it replaced. */
  readonly sentFrom?: ReadonlyMap<string, string>;
  readonly failure?: DataError;
  readonly gone?: boolean;
}

/** What an edit came to, for the screen's toast: refused whole over 500 records, or how many cells landed. */
export type EditOutcome =
  | { readonly kind: 'too-many'; readonly limit: number }
  /** More cells, or more data, than one write carries (5,000 cells, about 900 kB): refused before anything shows. */
  | { readonly kind: 'too-big' }
  | {
      readonly kind: 'done';
      readonly cells: number;
      readonly landed: number;
      /** The undo entry this action pushed, for a toast's Undo (`undo.run(workspace, undoId)`); absent when none. */
      readonly undoId?: string;
    };

/**
 * What an undo did, for the screen's toast (spec 0006, AC-48, AC-49):
 * nothing to undo, or the action it undid, how many of its cells went back,
 * how many were kept because they changed since, and how many were refused
 * for another reason (those already raised their own toast).
 */
export type UndoOutcome =
  | { readonly kind: 'nothing' }
  /** A toast's Undo whose action is no longer the newest (a later change, or already undone): nothing was done. */
  | { readonly kind: 'stale' }
  | {
      readonly kind: 'undone';
      readonly action: UndoKind;
      readonly objectId: string;
      readonly cells: number;
      readonly undone: number;
      readonly kept: number;
      readonly failed: number;
      /** The action's first cell, which a one cell undo names ("Undid Email on Jane Doe"). */
      readonly first: { readonly recordId: string; readonly attributeId: string; readonly recordName: string };
    };

/**
 * The facts of a "your value was replaced" notice (spec 0006, AC-46): which
 * record, the cells replaced (the first is named, "and 2 more" for the rest),
 * who replaced them, and "Use mine", which saves this tab's values again as a
 * normal, undoable edit. The screen words it.
 */
export interface ReplacedNotice {
  readonly workspace: string;
  readonly objectId: string;
  readonly recordId: string;
  readonly recordName: string;
  readonly attributeIds: readonly string[];
  readonly by: { readonly type: 'member' | 'api_key' | 'automation'; readonly id: string | null };
  readonly useMine: () => void;
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
  /** The count for the label: exact, or "10,000+" when `atLeast` (a filtered view past 10,000). */
  readonly count: WindowCount;
  /** How the view reads: jumping by position, or paging by cursor (spec 0006, AC-52, AC-53). */
  readonly mode: WindowMode;
  /** Notes on the member's own rows (spec 0006, AC-56): made here, or no longer matching the view. */
  readonly rowNotes: ReadonlyMap<string, RowNote>;
}

/** One screen reading a view: the columns it shows (`columns`), and `release` when it goes. */
export interface ViewReader {
  /** The attributes this screen shows now; a newly shown one is fetched for the loaded rows only. */
  readonly columns: (attributeIds: readonly string[]) => void;
  readonly release: () => void;
}

/** An object's records as one screen shows them, for useSyncExternalStore (`useView` in `@crm/data/react`). */
export interface RecordsView {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ViewState;
  /** Loads the count and every block on screen again, after a failure. */
  readonly retry: () => void;
  /** Settles once the count and the first block have loaded, or failed (the status then says so). */
  readonly ready: () => Promise<void>;
  /** The row a record shows at, while a loaded block or a pin holds it (a record just made here sits first). */
  readonly indexOf: (recordId: string) => number | undefined;
  /**
   * A screen shows the view with these columns (`useView` calls it in an
   * effect); the reader's `release` lets go. A view nobody shows for a minute
   * lets go of its rows, and the next `view()` makes a fresh one. Counted, so
   * StrictMode's second effect changes nothing. The member's own rows stay
   * in place until the last reader leaves.
   */
  readonly retain: (attributeIds?: readonly string[]) => ViewReader;
  /** A cell editor opened (true) or closed (false) in the view: order and membership don't settle while one is open. */
  readonly holdSettle: (isHeld: boolean) => void;
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
  /**
   * Settles once the workspace's head is read (spec 0007), so a view's first
   * read comes after its first watermark. At once by default.
   */
  readonly beforeRead?: (workspace: string) => Promise<void>;
  /**
   * Mutation ids about to go out (`MutationLog.sent`), how many echoes each
   * answer named (`answered`), and ones refused, which will never echo (`forget`).
   */
  readonly mutations?: {
    readonly sent: (mutationId: string) => void;
    readonly answered: (mutationId: string, echoes: number) => void;
    readonly forget: (mutationId: string) => void;
  };
  /** This person's member id in a workspace (`access.mine`), so their own saves never raise a replaced notice. */
  readonly memberOf?: (workspace: string) => Promise<string | undefined>;
  /** A value this tab wrote was replaced by someone else's later save (spec 0006, AC-46): the screen words it. */
  readonly onReplaced?: (notice: ReplacedNotice) => void;
  /** The object's primary attribute and its attributes' kinds (spec 0005's `attributes.list` cache until milestone 3). */
  readonly describe?: (workspace: string, objectId: string) => Promise<ObjectShape>;
  /** The browser's time zone, which relative date filters resolve in (AC-51). */
  readonly timeZone?: () => string;
  /** Runs `run` after `ms`, answering a cancel: settle's timer. A timer by default; tests pass their own. */
  readonly later?: (run: () => void, ms: number) => () => void;
}

/** The words the records layer raises itself. */
export const RECORD_WORDS = {
  retry: 'Retry',
  draftRefused: 'That record wasn’t created, so the change to it wasn’t saved.',
  recordGone: 'That record was deleted, so the change wasn’t saved.',
  notSaved: (count: number) => `${String(count)} changes weren’t saved.`,
  /** A refused undo, sent again from its toast's Retry. */
  undoRetried: (count: number) => (count === 1 ? 'Undid 1 change' : `Undid ${String(count)} changes`),
  kept: (count: number) =>
    count === 1
      ? '1 cell was changed since, so it was kept.'
      : `${String(count)} cells were changed since, so they were kept.`,
} as const;

/** UTF-8, as a request body counts its bytes. */
const UTF8 = new TextEncoder();

/** How many bytes a cell adds to a write: its value as JSON in UTF-8, and its ids and version around it. */
function cellBytes(value: unknown): number {
  // A cell's value is JSON shaped; `undefined` (nothing at all) is the one that stringifies to nothing.
  return CELL_OVERHEAD_BYTES + (value === undefined ? 0 : UTF8.encode(JSON.stringify(value)).byteLength);
}

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
  readonly query: ViewQuery;
  readonly windows: Windows;
  readonly view: RecordsView;
  readonly invalidate: () => void;
  /** Settles now: the blocks on screen and the count again (live changes may have been missed). */
  readonly reread: () => void;
  /** Something may have moved the order or membership: settle 1.5 s after the last such change. */
  readonly markDirty: () => void;
  readonly orderAttributes: () => OrderAttributes;
  /** The attributes the window reads now: its readers' columns and the primary. */
  readonly attributes: () => readonly string[];
  /** The member edited these records here: those on screen keep their place through the next settle. */
  readonly edited: (ids: readonly string[]) => void;
  /** The member made this record here: it sits first, marked new, until they leave. */
  readonly created: (id: string) => void;
  /** A record made here was refused: it leaves. */
  readonly withdrawn: (id: string) => void;
  readonly isRetained: () => boolean;
  /** Whether a loaded block or a pin holds `id`. */
  readonly shows: (id: string) => boolean;
  readonly isReady: () => boolean;
  readonly dispose: () => void;
}

/** Splits `items` into runs of at most `size`. */
const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/** One object's changes gathered for a frame: its record ids, and the attributes they name ('all' when one didn't say). */
interface Gathered {
  readonly ids: Set<string>;
  readonly attributes: Set<string> | 'all';
}

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
  beforeRead = () => Promise.resolve(),
  mutations = { sent: () => undefined, answered: () => undefined, forget: () => undefined },
  memberOf = () => Promise.resolve(undefined),
  onReplaced = () => undefined,
  describe = () => Promise.resolve({ attributes: [] }),
  timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  later = (run, ms) => {
    const id = setTimeout(run, ms);
    return () => {
      clearTimeout(id);
    };
  },
}: RecordsLayerOptions) {
  const store = createPlainStore<RecordView>({ now, later });
  // The versions this tab wrote (the last 500), its undo stack, and the undoable writes still out, by workspace.
  const own = createOwnVersions();
  const undo = createUndoStack();
  const inflight = new Map<string, Set<Promise<void>>>();
  // Each workspace's undo work, one press at a time.
  const undoing = new Map<string, Promise<void>>();
  const views = new Map<string, ViewEntry>();
  // Creates still waiting on the server, by record id: an edit to the draft is sent after it.
  const creating = new Map<string, Promise<boolean>>();
  // Each record's last write still out: the next one is sent after it, so the server applies a
  // record's edits in the order they were made and the later value gets the later version.
  const sending = new Map<string, Promise<unknown>>();
  let cellErrors: ReadonlyMap<string, string> = new Map();

  const keyOf = (workspace: string, objectId: string, query: ViewQuery = {}) => {
    const filter = query.filter === undefined || query.filter.conditions.length === 0 ? null : query.filter;
    const sorts = query.sorts === undefined || query.sorts.length === 0 ? null : query.sorts;
    return `${workspace}\u0000${objectId}\u0000${canonicalJson({ filter, sorts })}`;
  };
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

  function openView(workspace: string, objectId: string, query: ViewQuery, warm: readonly string[]): ViewEntry {
    const key = keyOf(workspace, objectId, query);
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
    // What the object looks like: its primary attribute, and its attributes' kinds, which pick the mode.
    let shape: ObjectShape | undefined;
    let mode: WindowMode = 'position';
    // The window's clock (spec 0006, AC-51): one `now` for every block and count, refreshed at each settle.
    let clock = now();
    // A refused cursor restarts the chain once; a read that lands allows it again.
    let hasRestarted = false;
    const isOpen = () => views.get(key)?.view === view;

    // Visible attributes (spec 0006, AC-55): each reader's columns, unioned, plus the primary.
    const readers = new Map<symbol, readonly string[]>();
    const attributeSet = (): readonly string[] => {
      const shown = readers.size === 0 ? warm : [...readers.values()].flat();
      const primary = shape?.primaryAttributeId;
      return [...new Set([...shown, ...(primary === undefined ? [] : [primary])])];
    };
    let readSet = attributeSet();

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
     * A read failed. Before the view is ready, or refused outright (a bad
     * filter, a cursor the restart didn't fix), that is the view failing
     * (Retry). Otherwise the table stays and the block is tried again later.
     */
    const blockFailed = (failure: unknown, read: { readonly withCursor: boolean }) => {
      const problem = toDataError(failure);
      const isCursorRefused =
        read.withCursor &&
        problem.code === 'INPUT_INVALID' &&
        (problem.data?.issues ?? []).some((issue) => issue.path[0] === 'cursor');
      // A cursor the server refused (another view's, or one it can no longer read): the chain starts again, once.
      if (isCursorRefused && !hasRestarted) {
        hasRestarted = true;
        windows.restart();
        return;
      }
      if (status !== 'ready' || isCursorRefused || REFUSED_READS.has(problem.code)) {
        fail(problem);
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
      if (windows.count() === 0 || inner.getSnapshot().getItem(0) !== undefined || windows.idAt(0) !== undefined)
        setStatus('ready');
    };

    /** The clock and filter every block and count of this window carries. */
    const clockInput = () => ({ now: new Date(clock).toISOString(), timeZone: timeZone() });

    const windows = createWindows({
      mode: () => mode,
      blockSize: BLOCK_SIZE,
      read: async (from, limit, signal) => {
        const asked = now();
        readSet = attributeSet();
        const page = await whenFree(
          () =>
            api.query(
              {
                workspace,
                objectId,
                ...from,
                limit,
                ...(query.filter === undefined ? {} : { filter: query.filter }),
                ...(query.sorts === undefined ? {} : { sorts: query.sorts }),
                attributeIds: readSet,
                ...clockInput(),
              },
              signal,
            ),
          signal,
        );
        store.receive(page.records, { hold: true });
        // Changed while this block was on its way: its rows may be older than the change.
        const stale = page.records.map((record) => record.id).filter((id) => changedSince(workspace, id, asked));
        if (stale.length > 0) {
          whenFree(() => api.get({ workspace, ids: stale, attributeIds: attributeSet() })).then(
            (rows) => {
              store.receive(rows);
            },
            // Left as loaded: the next change to it, or a settle, brings it up to date.
            () => undefined,
          );
        }
        const ids = page.records.map((record) => record.id);
        return page.nextCursor === undefined ? { ids } : { ids, nextCursor: page.nextCursor };
      },
      onError: blockFailed,
      onRead: () => {
        hasRestarted = false;
        blockFailures = 0;
      },
      release: store.release,
      onStale: () => {
        void refreshCount();
      },
    });
    const inner = createRecordView({
      store,
      windows,
      schedule,
      onShown: (range) => {
        // An edited row held in place lets go once it scrolls out of sight (spec 0006, AC-56).
        const kept = inner
          .pins()
          .filter((pin) => created.has(pin.id) || (pin.index >= range.start && pin.index < range.end));
        if (kept.length !== inner.pins().length) inner.setPins(kept);
      },
    });
    windows.subscribe(checkReady);

    function refreshCount(): Promise<void> {
      countController.abort();
      const controller = new AbortController();
      countController = controller;
      return whenFree(
        () =>
          api.count(
            {
              workspace,
              objectId,
              ...(query.filter === undefined ? {} : { filter: query.filter }),
              ...clockInput(),
            },
            controller.signal,
          ),
        controller.signal,
      ).then(
        (told) => {
          if (countController !== controller) return;
          countFailures = 0;
          const isFirst = !isCounted;
          isCounted = true;
          windows.setCount(told);
          // The first block, so the grid has rows the moment it mounts (the router loader waits for this).
          // Only the first time: a later count must never move the windows back to the top.
          if (isFirst && windows.count() > 0) windows.show({ start: 0, end: Math.min(windows.count(), BLOCK_SIZE) });
          checkReady();
          inner.invalidate();
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
            if (countController === controller && isOpen()) void refreshCount();
          });
        },
      );
    }
    let countFailures = 0;

    // Settle (spec 0006, AC-56): order and membership reread 1.5 s after the last change, never under an editor.
    const created = new Set<string>();
    const edited = new Set<string>();
    const dirt = { isDirty: false };
    const isMarked = () => dirt.isDirty;
    let isSettling = false;
    let editors = 0;
    let settleTimer: (() => void) | undefined;
    let settleController: AbortController | undefined;
    const isFiltered = () => query.filter !== undefined && query.filter.conditions.length > 0;

    const scheduleSettle = (ms: number) => {
      settleTimer?.();
      settleTimer = later(() => {
        settleTimer = undefined;
        void settle();
      }, ms);
    };
    const markDirty = () => {
      dirt.isDirty = true;
      if (!isSettling) scheduleSettle(SETTLE_MS);
    };
    /** Rereads the blocks on screen and the count with a fresh clock, then holds the member's own rows in place. */
    async function settle(): Promise<void> {
      if (!dirt.isDirty || isSettling || editors > 0 || status !== 'ready' || !isOpen()) return;
      dirt.isDirty = false;
      isSettling = true;
      clock = now();
      const controller = new AbortController();
      settleController = controller;
      // Rows the member edited here and can see now: each keeps the screen row it is at.
      const range = inner.shown();
      const held = [...edited].flatMap((id): Pin[] => {
        const index = inner.rowOf(id);
        return index !== undefined && index >= range.start && index < range.end ? [{ id, index }] : [];
      });
      edited.clear();
      try {
        await Promise.all([windows.reread(controller.signal), refreshCount()]);
      } catch {
        // Left as it was; the next change settles again.
        isSettling = false;
        settleController = undefined;
        return;
      }
      settleController = undefined;
      isSettling = false;
      if (!isOpen()) return;
      const noteOf = (id: string, fallback?: RowNote): RowNote | undefined =>
        isFiltered() && !windows.has(id) ? 'no-longer-matches' : fallback;
      const before = inner.pins().filter((pin) => !held.some((each) => each.id === pin.id));
      const next = [...before, ...held].map((pin) => {
        const note = noteOf(pin.id, created.has(pin.id) ? 'new' : undefined);
        return note === undefined ? { id: pin.id, index: pin.index } : { ...pin, note };
      });
      inner.setPins(next);
      // Changed again while it settled (an event or an edit set the mark meanwhile): settle once more.
      if (isMarked()) scheduleSettle(SETTLE_MS);
    }

    let lastSource: RecordSource<RecordView> | undefined;
    let lastErrors = cellErrors;
    let lastStatus: ViewStatus = status;
    let snapshot: ViewState | undefined;
    const rowNotesOf = (): ReadonlyMap<string, RowNote> =>
      new Map(inner.pins().flatMap((pin) => (pin.note === undefined ? [] : [[pin.id, pin.note] as const])));
    const view: RecordsView = {
      subscribe: inner.subscribe,
      getSnapshot: () => {
        const source = inner.getSnapshot();
        if (snapshot === undefined || source !== lastSource || cellErrors !== lastErrors || status !== lastStatus) {
          lastSource = source;
          lastErrors = cellErrors;
          lastStatus = status;
          snapshot = {
            source,
            status,
            cellErrors,
            count: windows.told(),
            mode,
            rowNotes: rowNotesOf(),
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
        hasRestarted = false;
        setStatus('loading');
        void refreshCount();
        windows.refresh();
      },
      ready: () => readyPromise,
      indexOf: (id) => inner.rowOf(id),
      retain: (attributeIds = []) => {
        retains += 1;
        clearTimeout(unused);
        const reader = Symbol('reader');
        readers.set(reader, attributeIds);
        showColumns();
        let isReleased = false;
        return {
          columns: (next) => {
            if (isReleased) return;
            readers.set(reader, next);
            showColumns();
          },
          release: () => {
            if (isReleased) return;
            isReleased = true;
            retains -= 1;
            readers.delete(reader);
            if (retains === 0) {
              // The member left the view: the rows they made or edited here go back to the server's order.
              created.clear();
              edited.clear();
              inner.setPins([]);
              letGoLater();
            }
          },
        };
      },
      holdSettle: (isHeld) => {
        editors = Math.max(0, editors + (isHeld ? 1 : -1));
        if (editors === 0 && dirt.isDirty && !isSettling) scheduleSettle(SETTLE_MS);
      },
    };

    /** Columns shown since the blocks were read: fetched for the loaded rows only, 500 ids a call. */
    function showColumns() {
      const next = attributeSet();
      const added = next.filter((id) => !readSet.includes(id));
      readSet = next;
      if (added.length === 0 || status !== 'ready') return;
      const ids = [...new Set([...windows.loadedIds(), ...inner.pins().map((pin) => pin.id)])];
      for (const part of chunks(ids, GET_LIMIT)) {
        whenFree(() => api.get({ workspace, ids: part, attributeIds: added })).then(
          (rows) => {
            store.receive(rows.filter((row) => store.get(row.id) !== undefined));
          },
          // The cells stay unknown (skeletons) until the next read of their rows.
          () => undefined,
        );
      }
    }

    let retains = 0;
    let unused: ReturnType<typeof setTimeout> | undefined;
    // Live changes to this workspace reach the view while it is open.
    const unwatch = watch(workspace);
    const dispose = () => {
      countController.abort();
      blockRetry?.abort();
      settleTimer?.();
      settleController?.abort();
      inner.dispose();
      unwatch();
    };
    /** Nobody shows the view: after a while it leaves the layer and lets go of its rows. */
    const letGoLater = () => {
      clearTimeout(unused);
      unused = setTimeout(() => {
        if (retains > 0) return;
        if (views.get(key)?.view === view) views.delete(key);
        dispose();
      }, keepUnusedViewMs);
    };
    // The first read waits for the workspace's head, so nothing written meanwhile is missed, and for the
    // object's shape, which picks the mode (spec 0006, AC-52) and names the primary attribute.
    void Promise.all([beforeRead(workspace), describe(workspace, objectId)]).then(
      ([, described]) => {
        shape = described;
        const byId = new Map(described.attributes.map((attribute) => [attribute.id, attribute]));
        mode = canJump(query.filter, query.sorts, (id) => byId.get(id)) ? 'position' : 'cursor';
        readSet = attributeSet();
        if (!isCounted && isOpen()) void refreshCount();
      },
      (failure: unknown) => {
        if (isOpen()) fail(failure);
      },
    );
    // A view the router warmed but no screen ever showed goes too.
    letGoLater();
    return {
      workspace,
      objectId,
      query,
      windows,
      view,
      invalidate: inner.invalidate,
      reread: () => {
        // Still loading: what it loads is already newer than what was missed.
        if (status !== 'ready') return;
        dirt.isDirty = true;
        void settle();
      },
      markDirty,
      orderAttributes: () => orderAttributesOf(query, shape),
      attributes: () => readSet,
      edited: (ids) => {
        for (const id of ids) if (windows.has(id) || created.has(id)) edited.add(id);
      },
      created: (id) => {
        created.add(id);
        // First in the view, marked new, until the member leaves it (spec 0006, AC-56).
        const shifted = inner.pins().map((pin) => (created.has(pin.id) ? pin : { ...pin, index: pin.index + 1 }));
        const made = shifted.filter((pin) => created.has(pin.id)).map((pin) => ({ ...pin, index: pin.index + 1 }));
        const others = shifted.filter((pin) => !created.has(pin.id));
        inner.setPins([{ id, index: 0, note: 'new' }, ...made, ...others]);
        markDirty();
      },
      withdrawn: (id) => {
        if (!created.delete(id)) return;
        const rest = inner.pins().filter((pin) => pin.id !== id);
        inner.setPins(rest.map((pin) => ({ ...pin, index: pin.index - 1 })));
      },
      isRetained: () => retains > 0,
      shows: (id) => windows.has(id) || inner.pins().some((pin) => pin.id === id),
      isReady: () => status === 'ready',
      dispose: () => {
        clearTimeout(unused);
        dispose();
      },
    };
  }

  /** The version an edit names as its base for each cell (spec 0006, AC-45): the base's, never a layer's. */
  function baseVersionsOf(base: RecordView | undefined, cells: readonly CellWrite[]) {
    const bases = new Map<string, string | null>();
    if (base === undefined) return bases;
    for (const cell of cells) {
      // Unknown (never read) has no base to name; read with no version means never set.
      if (Object.hasOwn(base.values, cell.attributeId))
        bases.set(cell.attributeId, base.versions[cell.attributeId] ?? null);
    }
    return bases;
  }

  /** One record's part of a write: its cells, its layer, and what the record showed and held when it began. */
  interface Prepared {
    readonly recordId: string;
    readonly cells: readonly CellWrite[];
    readonly layer: Layer<RecordView>;
    /** What the screen showed for each cell when the action began: what undo puts back. */
    readonly before: ReadonlyMap<string, unknown>;
    /** The base's version for each cell when the edit began; empty when the record had no base yet (a draft). */
    readonly bases: ReadonlyMap<string, string | null>;
  }

  /**
   * Writes cells of one or more records as one action (spec 0006): each
   * record's cells show at once as one optimistic layer, and the whole action
   * is one write with one `mutationId` (`records.setValues` for one record,
   * `records.setValuesBatch` for several), sent after each record's last
   * write and its create. Each record lands or rolls back on its own: a
   * refusal rolls its cells back and marks them (a `quiet` code rolls back
   * with no mark), and a record gone on the server leaves every window. The
   * versions the write made (its answer's `written`, never the read back)
   * join the tab's own versions; with `undo`, the cells it changed go on the
   * undo stack as one entry.
   */
  function write(
    workspace: string,
    objectId: string | undefined,
    writes: readonly RecordWrite[],
    options: WriteOptions = {},
  ): Promise<readonly RecordOutcome[]> {
    const mutationId = options.mutationId ?? mintId();
    // Every cell's old refusal goes in one change, so a big paste invalidates the views once.
    setCellErrors(
      writes.flatMap((each) => each.cells.map((cell) => [`${each.recordId}:${cell.attributeId}`, undefined] as const)),
    );
    const prepared = writes.map((each): Prepared => {
      const shown = store.get(each.recordId);
      const values = Object.fromEntries(each.cells.map((cell) => [cell.attributeId, cell.value]));
      return {
        recordId: each.recordId,
        cells: each.cells,
        before: new Map(each.cells.map((cell) => [cell.attributeId, shown?.values[cell.attributeId] ?? null])),
        bases: baseVersionsOf(store.base(each.recordId), each.cells),
        layer: store.edit(each.recordId, values, mutationId),
      };
    });
    mutations.sent(mutationId);
    // After each record's last write (and its create, if it is still being made), so the server applies one
    // record's edits in the order they were made and the later value gets the later version.
    const turn = Promise.all(
      prepared.map((each) =>
        (sending.get(each.recordId) ?? Promise.resolve()).then(
          () => undefined,
          () => undefined,
        ),
      ),
    );
    const mine = turn.then(() => send(workspace, mutationId, prepared, options));
    // What lands may move rows in a filtered or sorted window: those settle, and the edited rows keep their place.
    void mine.then((outcomes) => {
      const landedIds = outcomes.flatMap((outcome) => (outcome.row === undefined ? [] : [outcome.recordId]));
      if (landedIds.length === 0) return;
      const written = new Set(
        outcomes.flatMap((outcome) => (outcome.row === undefined ? [] : outcome.cells.map((cell) => cell.attributeId))),
      );
      for (const entry of viewsOf(workspace)) {
        if (!landedIds.some((id) => entry.shows(id))) continue;
        entry.edited(landedIds);
        const order = entry.orderAttributes();
        if (order.any || [...written].some((id) => order.ids.has(id))) entry.markDirty();
      }
    });
    for (const each of prepared) sending.set(each.recordId, mine);
    void mine.finally(() => {
      for (const each of prepared) if (sending.get(each.recordId) === mine) sending.delete(each.recordId);
    });
    if (options.undo !== undefined && objectId !== undefined) {
      const kind = options.undo;
      const entry = mine.then((outcomes) => {
        undo.push(workspace, { id: mutationId, kind, objectId, cells: undoCells(prepared, outcomes) });
      });
      // An undo pressed meanwhile waits for this write's answer first (spec 0006).
      const waiting = inflight.get(workspace) ?? new Set<Promise<void>>();
      inflight.set(workspace, waiting);
      waiting.add(entry);
      void entry.finally(() => waiting.delete(entry));
    }
    return mine;
  }

  /**
   * The cells of an action that the write changed (its answer's `written`):
   * what its undo puts back, the version it must find, and the version it
   * replaced, so undoing a later action on the same cell can hand this one
   * the version that undo wrote.
   */
  function undoCells(prepared: readonly Prepared[], outcomes: readonly RecordOutcome[]): UndoCell[] {
    const byRecord = new Map(outcomes.map((outcome) => [outcome.recordId, outcome]));
    return prepared.flatMap((each) => {
      const outcome = byRecord.get(each.recordId);
      if (outcome?.row === undefined) return [];
      return each.cells.flatMap((cell): UndoCell[] => {
        const written = outcome.written?.[cell.attributeId];
        // Unchanged (no new version) is left out: there is nothing to undo.
        if (written === undefined) return [];
        const replaced = outcome.sentFrom?.get(cell.attributeId);
        return [
          {
            recordId: each.recordId,
            attributeId: cell.attributeId,
            before: each.before.get(cell.attributeId) ?? null,
            writtenVersionId: written,
            ...(replaced === undefined ? {} : { replacedVersionId: replaced }),
          },
        ];
      });
    });
  }

  /** Each cell's version in the record's base now: what a write sent after its turn replaces. */
  function versionsNow(each: Prepared): ReadonlyMap<string, string> {
    const versions = store.base(each.recordId)?.versions ?? {};
    return new Map(
      each.cells.flatMap((cell) => {
        const version = versions[cell.attributeId];
        return version === undefined ? [] : [[cell.attributeId, version] as const];
      }),
    );
  }

  /** Sends a prepared action once the creates it waits on are in, and settles each record's layer by its outcome. */
  async function send(
    workspace: string,
    mutationId: string,
    prepared: readonly Prepared[],
    options: WriteOptions,
  ): Promise<readonly RecordOutcome[]> {
    const outcomes: RecordOutcome[] = [];
    const live: Prepared[] = [];
    for (const each of prepared) {
      const pendingCreate = creating.get(each.recordId);
      if (pendingCreate !== undefined && !(await pendingCreate)) {
        // The create was refused, and the draft went with this edit on it.
        notify({ tone: 'danger', message: RECORD_WORDS.draftRefused });
        outcomes.push({ recordId: each.recordId, cells: each.cells });
        continue;
      }
      live.push(each);
    }
    if (live.length === 0) {
      mutations.forget(mutationId);
      return outcomes;
    }
    // After the record's turn: the base now holds the record's last confirmed write, which this one replaces.
    const sentFrom = new Map(live.map((each) => [each.recordId, versionsNow(each)]));
    const itemOf = (each: Prepared) => {
      // A draft's edit names the base its create answered.
      const bases = each.bases.size > 0 ? each.bases : baseVersionsOf(store.base(each.recordId), each.cells);
      return {
        recordId: each.recordId,
        values: Object.fromEntries(
          each.cells.map((cell) => {
            const base = bases.get(cell.attributeId);
            return [
              cell.attributeId,
              {
                value: cell.value,
                ...(cell.ifVersionId !== undefined
                  ? { ifVersionId: cell.ifVersionId }
                  : base === undefined
                    ? {}
                    : { baseVersionId: base }),
              },
            ];
          }),
        ),
      };
    };
    const landedAs = (each: Prepared, row: RecordView, written: Readonly<Record<string, string>>) =>
      landed(workspace, each, row, written, sentFrom.get(each.recordId));
    try {
      const [only] = live;
      if (live.length === 1 && only !== undefined) {
        const answer = await delivered(() => api.setValues({ workspace, mutationId, ...itemOf(only) }));
        const { echoes, written, ...row } = answer;
        mutations.answered(mutationId, echoes);
        return [...outcomes, landedAs(only, row, written)];
      }
      const answer = await delivered(() => api.setValuesBatch({ workspace, mutationId, items: live.map(itemOf) }));
      mutations.answered(mutationId, answer.echoes);
      const results = new Map(answer.results.map((result) => [result.recordId, result]));
      for (const each of live) {
        const result = results.get(each.recordId);
        if (result?.record !== undefined) {
          outcomes.push(landedAs(each, result.record, result.written ?? {}));
          continue;
        }
        const [first] = result?.refusals ?? [];
        const failure =
          first === undefined
            ? dataError('INTERNAL', RECORD_WORDS.notSaved(1))
            : dataError(first.code, first.message, { refusals: result?.refusals ?? [] });
        outcomes.push(refused(each, failure, options));
      }
      return outcomes;
    } catch (error) {
      const failure = toDataError(error);
      mutations.forget(mutationId);
      return [...outcomes, ...live.map((each) => refused(each, failure, options))];
    }
  }

  /**
   * A record's part landed: its row becomes the base, and each version the
   * write itself made (`written`, never the read back, which may already hold
   * someone else's) joins the tab's own versions.
   */
  function landed(
    workspace: string,
    each: Prepared,
    row: RecordView,
    written: Readonly<Record<string, string>>,
    sentFrom: ReadonlyMap<string, string> | undefined,
  ): RecordOutcome {
    each.layer.confirm(row);
    for (const cell of each.cells) {
      const versionId = written[cell.attributeId];
      if (versionId === undefined) continue;
      own.add(versionId, {
        workspace,
        objectId: row.objectId,
        recordId: row.id,
        attributeId: cell.attributeId,
        value: cell.value,
        recordName: row.display.name,
      });
    }
    return {
      recordId: each.recordId,
      cells: each.cells,
      row,
      written,
      ...(sentFrom === undefined ? {} : { sentFrom }),
    };
  }

  /** A record's part was refused: its cells roll back, marked with why unless the code is quiet. */
  function refused(each: Prepared, failure: DataError, options: WriteOptions): RecordOutcome {
    each.layer.refuse();
    const outcome = { recordId: each.recordId, cells: each.cells, failure };
    // Signed out: the layer already said so, and sign in comes next.
    if (failure.code === 'UNAUTHENTICATED') return { recordId: each.recordId, cells: each.cells };
    if (failure.code === 'RECORD_DELETED' || failure.code === 'NOT_FOUND') {
      dropRecords([each.recordId]);
      return { ...outcome, gone: true };
    }
    if (options.quiet?.has(failure.code) === true) return outcome;
    setCellErrors(
      each.cells.map((cell) => [`${each.recordId}:${cell.attributeId}`, refusalFor(failure, cell.attributeId)]),
    );
    return outcome;
  }

  /**
   * One toast for an action's refusals: a gone record says so, the rest are
   * summed up with Retry, which sends their cells again (`retry`): an edit as
   * a new edit, an undo as the same undo, still checked by its versions.
   */
  function tellRefusals(outcomes: readonly RecordOutcome[], retry: (refused: readonly RecordOutcome[]) => void) {
    if (outcomes.some((outcome) => outcome.gone === true)) notify({ tone: 'danger', message: RECORD_WORDS.recordGone });
    const refusedOnes = outcomes.filter((outcome) => outcome.failure !== undefined && outcome.gone !== true);
    const [first] = refusedOnes;
    if (first?.failure === undefined) return;
    notify({
      tone: 'danger',
      message: refusedOnes.length === 1 ? refusalSummary(first.failure) : RECORD_WORDS.notSaved(refusedOnes.length),
      action: {
        label: RECORD_WORDS.retry,
        onAction: () => {
          retry(refusedOnes);
        },
      },
    });
  }

  /** Roughly how many bytes a write of these cells sends: their values in UTF-8, and each cell's ids and version. */
  const encodedSize = (changes: readonly CellChange[]): number =>
    changes.reduce((sum, change) => sum + cellBytes(change.value), 0);

  /**
   * Edits cells as one action (spec 0006, AC-48, AC-50): a cell, a paste or a
   * range clear. Over 500 records, or more than one request can carry, it is
   * refused before anything shows. Each record's cells show at once and land
   * or roll back on their own; one toast with Retry covers the refused ones;
   * what landed goes on the undo stack.
   */
  async function edit(
    workspace: string,
    objectId: string | undefined,
    changes: readonly CellChange[],
    kind: UndoKind,
  ): Promise<EditOutcome> {
    const byRecord = new Map<string, CellWrite[]>();
    for (const change of changes) {
      byRecord.set(change.rowId, [
        ...(byRecord.get(change.rowId) ?? []),
        { attributeId: change.columnId, value: change.value },
      ]);
    }
    if (byRecord.size > MAX_BATCH_RECORDS) return { kind: 'too-many', limit: MAX_BATCH_RECORDS };
    if (changes.length > MAX_BATCH_CELLS || encodedSize(changes) > MAX_WRITE_BYTES) return { kind: 'too-big' };
    const object = objectId ?? store.get(changes[0]?.rowId ?? '')?.objectId;
    const mutationId = mintId();
    const outcomes = await write(
      workspace,
      object,
      [...byRecord].map(([recordId, cells]) => ({ recordId, cells })),
      { undo: kind, mutationId },
    );
    tellRefusals(outcomes, (refusedOnes) => {
      const again = refusedOnes.flatMap((outcome) =>
        outcome.cells.map((cell) => ({ rowId: outcome.recordId, columnId: cell.attributeId, value: cell.value })),
      );
      void edit(workspace, object, again, kind);
    });
    const landedCells = outcomes.reduce(
      (sum, outcome) => sum + (outcome.row === undefined ? 0 : outcome.cells.length),
      0,
    );
    // Its entry went on the stack before this answer (the push runs first): a toast's Undo names it.
    const pushed = undo.top(workspace)?.id === mutationId;
    return { kind: 'done', cells: changes.length, landed: landedCells, ...(pushed ? { undoId: mutationId } : {}) };
  }

  /** Splits record writes into runs whose encoded size stays under one request's limit; each record stays whole. */
  function bySize(writes: readonly RecordWrite[]): RecordWrite[][] {
    const runs: RecordWrite[][] = [];
    let run: RecordWrite[] = [];
    let size = 0;
    for (const each of writes) {
      const own = each.cells.reduce((sum, cell) => sum + cellBytes(cell.value), 0);
      if (run.length > 0 && (size + own > MAX_WRITE_BYTES || run.length >= MAX_BATCH_RECORDS)) {
        runs.push(run);
        run = [];
        size = 0;
      }
      run.push(each);
      size += own;
    }
    if (run.length > 0) runs.push(run);
    return runs;
  }

  /** Writes record writes in runs a request can carry (an undo's old values can be far bigger than the change). */
  async function writeInRuns(
    workspace: string,
    objectId: string,
    writes: readonly RecordWrite[],
    options: WriteOptions,
  ): Promise<readonly RecordOutcome[]> {
    const outcomes = await Promise.all(bySize(writes).map((run) => write(workspace, objectId, run, options)));
    return outcomes.flat();
  }

  /**
   * Writes undo cells back, each checked by the version its action wrote
   * (`ifVersionId`): a record refused only because some of its cells changed
   * since sends its other cells once more without them. Answers what landed,
   * what was kept and what was refused for another reason. A landed cell
   * hands the version it wrote to any older entry that wrote the version this
   * one replaced, so repeated presses walk back one cell's own changes.
   */
  async function undoCellsBack(
    workspace: string,
    objectId: string,
    cells: readonly UndoCell[],
  ): Promise<{ readonly landed: number; readonly kept: number; readonly failed: readonly RecordOutcome[] }> {
    const byRecord = new Map<string, CellWrite[]>();
    for (const cell of cells) {
      byRecord.set(cell.recordId, [
        ...(byRecord.get(cell.recordId) ?? []),
        { attributeId: cell.attributeId, value: cell.before, ifVersionId: cell.writtenVersionId },
      ]);
    }
    const quiet = new Set(['VERSION_CHANGED']);
    const first = await writeInRuns(
      workspace,
      objectId,
      [...byRecord].map(([recordId, writes]) => ({ recordId, cells: writes })),
      { quiet },
    );
    let kept = 0;
    const retry: RecordWrite[] = [];
    const settled: RecordOutcome[] = [];
    for (const outcome of first) {
      if (outcome.failure?.code !== 'VERSION_CHANGED') {
        settled.push(outcome);
        continue;
      }
      const changed = new Set(
        (outcome.failure.data?.refusals ?? []).flatMap((refusal) =>
          refusal.code === 'VERSION_CHANGED' && refusal.attributeId !== undefined ? [refusal.attributeId] : [],
        ),
      );
      const rest = outcome.cells.filter((cell) => !changed.has(cell.attributeId));
      kept += outcome.cells.length - rest.length;
      if (rest.length > 0) retry.push({ recordId: outcome.recordId, cells: rest });
    }
    const second = retry.length === 0 ? [] : await writeInRuns(workspace, objectId, retry, { quiet });
    for (const outcome of second) {
      if (outcome.failure?.code === 'VERSION_CHANGED') kept += outcome.cells.length;
      else settled.push(outcome);
    }
    // Each cell put back hands its new version to the older entry that wrote what this one replaced, in one pass.
    // A cell that landed writing nothing (a resend whose first try had landed) holds the value at the row's version.
    const byCell = new Map(cells.map((cell) => [`${cell.recordId}:${cell.attributeId}`, cell]));
    const handOver = new Map<string, string>();
    for (const outcome of settled) {
      const { row } = outcome;
      if (row === undefined) continue;
      for (const cell of outcome.cells) {
        const undone = byCell.get(`${outcome.recordId}:${cell.attributeId}`);
        const now =
          outcome.written?.[cell.attributeId] ??
          (sameData(row.values[cell.attributeId] ?? null, cell.value) ? row.versions[cell.attributeId] : undefined);
        if (undone?.replacedVersionId !== undefined && now !== undefined) {
          handOver.set(`${outcome.recordId}:${cell.attributeId}:${undone.replacedVersionId}`, now);
        }
      }
    }
    undo.rewrite(workspace, handOver);
    const landedCells = settled.reduce(
      (sum, outcome) => sum + (outcome.row === undefined ? 0 : outcome.cells.length),
      0,
    );
    const failed = settled.filter((outcome) => outcome.failure !== undefined);
    // Retry sends the same undo again, after any undo still running, still checked by the versions its action wrote.
    tellRefusals(failed, (refusedOnes) => {
      const ids = new Set(
        refusedOnes.flatMap((outcome) => outcome.cells.map((cell) => `${outcome.recordId}:${cell.attributeId}`)),
      );
      void inTurn(workspace, async () => {
        const again = await undoCellsBack(
          workspace,
          objectId,
          cells.filter((cell) => ids.has(`${cell.recordId}:${cell.attributeId}`)),
        );
        // No screen asked for this one: the layer says what it did.
        if (again.landed > 0) notify({ tone: 'success', message: RECORD_WORDS.undoRetried(again.landed) });
        if (again.kept > 0) notify({ tone: 'success', message: RECORD_WORDS.kept(again.kept) });
      });
    });
    return { landed: landedCells, kept, failed };
  }

  /**
   * Runs undo work for a workspace one at a time, after every undoable write
   * still out: a second press waits until the first press's writes have
   * answered and handed their versions on, so a quick double press walks
   * back two changes to one cell.
   */
  function inTurn<T>(workspace: string, work: () => Promise<T>): Promise<T> {
    const before = undoing.get(workspace) ?? Promise.resolve();
    const mine = before.then(async () => {
      await Promise.all([...(inflight.get(workspace) ?? [])]);
      return work();
    });
    const done = mine.then(
      () => undefined,
      () => undefined,
    );
    undoing.set(workspace, done);
    void done.then(() => {
      if (undoing.get(workspace) === done) undoing.delete(workspace);
    });
    return mine;
  }

  /**
   * Undoes the newest action on this tab's stack for the workspace (spec
   * 0006, AC-48, AC-49), after any undoable write and any undo still out has
   * answered; with `only`, that action alone and only while it is the newest
   * (a toast's Undo). Each cell is written back only while it still holds the
   * version the action wrote (checked on the server): a cell changed since is
   * kept. The undo shows at once, rolls back what is refused, is live to
   * others, and is never pushed itself (no redo).
   */
  function runUndo(workspace: string, only?: string): Promise<UndoOutcome> {
    return inTurn(workspace, async (): Promise<UndoOutcome> => {
      // A toast's Undo undoes its own action or nothing: once a newer one sits on top (or it was undone), it is stale.
      if (only !== undefined && undo.top(workspace)?.id !== only) return { kind: 'stale' };
      const entry = undo.pop(workspace);
      const [firstCell] = entry?.cells ?? [];
      if (entry === undefined || firstCell === undefined) return { kind: 'nothing' };
      const { landed: undone, kept, failed } = await undoCellsBack(workspace, entry.objectId, entry.cells);
      const shown = store.get(firstCell.recordId) ?? store.base(firstCell.recordId);
      return {
        kind: 'undone',
        action: entry.kind,
        objectId: entry.objectId,
        cells: entry.cells.length,
        undone,
        kept,
        failed: failed.reduce((sum, outcome) => sum + outcome.cells.length, 0),
        first: {
          recordId: firstCell.recordId,
          attributeId: firstCell.attributeId,
          recordName: shown?.display.name ?? '',
        },
      };
    });
  }

  /**
   * What an event says this tab's values were replaced by (spec 0006, AC-46,
   * AC-47): for each entry whose version this tab wrote, replaced by someone
   * other than this member and not the system, one notice per record, naming
   * its first cell. A catch up carries no `replaced`, so a tab that was away
   * hears nothing.
   */
  async function replacedIn(workspace: string, event: RecordsEvent): Promise<void> {
    // No list (none replaced, or more than 200 cells): the records are refetched, and nothing is said.
    const replaced = event.replaced;
    if (replaced === undefined) return;
    const by = replaced.by;
    if (by.type === 'system') return;
    const mine = replaced.cells.flatMap((entry) => {
      const written = own.get(entry.versionId);
      if (written === undefined || written.workspace !== workspace || entry.recordId !== written.recordId) return [];
      return [{ entry, written }];
    });
    if (mine.length === 0) return;
    const me = await memberOf(workspace);
    // Not knowing who this is, a save from the person's own other tab can't be told apart: say nothing.
    if (me === undefined) return;
    if (by.type === 'member' && by.id === me) return;
    const byRecord = new Map<string, typeof mine>();
    for (const each of mine) {
      byRecord.set(each.entry.recordId, [...(byRecord.get(each.entry.recordId) ?? []), each]);
    }
    for (const [recordId, cells] of byRecord) {
      const [firstCell] = cells;
      if (firstCell === undefined) continue;
      onReplaced({
        workspace,
        objectId: firstCell.written.objectId,
        recordId,
        recordName: store.get(recordId)?.display.name ?? firstCell.written.recordName,
        attributeIds: cells.map((each) => each.entry.attributeId),
        by: { type: by.type, id: by.id },
        useMine: () => {
          void edit(
            workspace,
            firstCell.written.objectId,
            cells.map((each) => ({ rowId: recordId, columnId: each.entry.attributeId, value: each.written.value })),
            'cell',
          );
        },
      });
    }
  }

  /**
   * Reads records again by id, 500 at a time, with only `attributeIds` when
   * given; ids the server leaves out are gone and leave every window.
   */
  async function refetch(workspace: string, ids: readonly string[], attributeIds?: readonly string[]): Promise<void> {
    const held = ids.filter((id) => isHeldIn(workspace, id));
    await Promise.all(
      chunks(held, GET_LIMIT).map(async (part) => {
        const rows = await whenFree(() =>
          api.get({ workspace, ids: part, ...(attributeIds === undefined ? {} : { attributeIds }) }),
        );
        // Only rows this workspace's views still show: the store is keyed by record id alone.
        store.receive(rows.filter((row) => isHeldIn(workspace, row.id)));
        const found = new Set(rows.map((row) => row.id));
        const gone = new Set(part.filter((id) => !found.has(id) && !store.pending().has(id)));
        if (gone.size === 0) return;
        for (const entry of viewsOf(workspace)) entry.windows.drop(gone);
        store.remove([...gone].filter((id) => ![...views.values()].some((entry) => entry.shows(id))));
      }),
    );
  }

  /**
   * Whether one of `workspace`'s views shows `id`. Record ids are unique per
   * workspace only, so a change event from one workspace never touches a
   * record another workspace's view holds under the same id.
   */
  function isHeldIn(workspace: string, id: string): boolean {
    return viewsOf(workspace).some((entry) => entry.shows(id));
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

  // Change events' record and attribute ids, by workspace and object, gathered for one frame.
  let incoming = new Map<string, Map<string, Gathered>>();
  let isGathering = false;

  function applyIncoming() {
    isGathering = false;
    const gathered = incoming;
    incoming = new Map();
    for (const [workspace, objects] of gathered) {
      for (const [objectId, change] of objects) {
        const entries = viewsOf(workspace).filter((entry) => entry.objectId === objectId);
        const ids = [...change.ids];
        const held = ids.filter((id) => isHeldIn(workspace, id));
        // Visible attributes (spec 0006, AC-55): only what the event names and the windows read, plus what every
        // write moves when a window shows it. An event naming only attributes no window reads fetches nothing.
        const read = new Set(entries.flatMap((entry) => entry.attributes()));
        const moving = new Set(entries.flatMap((entry) => [...entry.orderAttributes().moving]));
        const always = [...read].filter((id) => moving.has(id));
        const wanted =
          change.attributes === 'all'
            ? undefined
            : [
                ...new Set([
                  ...[...change.attributes].filter((id) => read.has(id)),
                  ...(change.attributes.size > 0 ? always : []),
                ]),
              ];
        if (held.length > 0 && (wanted === undefined || wanted.length > 0)) {
          const attributeIds = wanted === undefined ? [...read] : wanted;
          // A refetch that fails leaves rows out of date: once more a moment later, then the views settle again.
          refetch(workspace, held, attributeIds).catch(() => {
            void wait(Math.round((1 + random()) * SPREAD_MS))
              .then(() => refetch(workspace, held, attributeIds))
              .catch(() => {
                records.reload(workspace, objectId);
              });
          });
        }
        // Order and membership (spec 0006, AC-56): settle a window when a change may move its rows.
        for (const entry of entries) {
          if (!entry.isReady()) continue;
          const order = entry.orderAttributes();
          const touches =
            change.attributes === 'all' ||
            change.attributes.size === 0 ||
            order.any ||
            [...change.attributes].some((id) => order.ids.has(id));
          // An id the window doesn't show may be a record made or restored elsewhere: its count and rows may move.
          if (touches || ids.some((id) => !entry.shows(id))) entry.markDirty();
        }
      }
    }
  }

  const records = {
    /**
     * An object's records as one question asks for them (spec 0006, AC-51):
     * its filter and sorts. Every screen asking the same question shares one
     * window, made on first use, its count and first block loading; a new
     * filter or sort opens a new window, and the old one goes once nobody
     * shows it. `attributeIds` are the columns the first block reads until a
     * screen names its own (`retain`); the primary attribute always comes.
     */
    view: (
      workspace: string,
      objectId: string,
      query: ViewQuery = {},
      attributeIds: readonly string[] = [],
    ): RecordsView => {
      const key = keyOf(workspace, objectId, query);
      const existing = views.get(key);
      if (existing !== undefined) return existing.view;
      const entry = openView(workspace, objectId, query, attributeIds);
      views.set(key, entry);
      return entry.view;
    },

    /**
     * Makes a record at once: a draft sits first in every view of its object
     * a screen shows, marked new, until the member leaves it (spec 0006,
     * AC-56); the server's row then replaces it. A refusal takes it out
     * again and rejects with the
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
        revision: 0,
        values,
        versions: {},
        linkTotals: {},
      };
      const layer = store.create(draft, mutationId);
      mutations.sent(mutationId);
      const placed = viewsOf(workspace).filter((entry) => entry.objectId === objectId && entry.isRetained());
      for (const entry of placed) entry.created(id);
      let settle: (made: boolean) => void = () => undefined;
      creating.set(
        id,
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
      );
      try {
        const {
          echoes,
          written: _written,
          ...row
        } = await delivered(() => api.create({ workspace, objectId, id, values, mutationId }));
        mutations.answered(mutationId, echoes);
        layer.confirm(row);
        settle(true);
        return row;
      } catch (error) {
        mutations.forget(mutationId);
        layer.refuse();
        for (const entry of placed) entry.withdrawn(id);
        settle(false);
        throw toDataError(error);
      } finally {
        creating.delete(id);
      }
    },

    /**
     * Edits cells as one action (a cell, a paste, a range clear): they show at
     * once, then go as one write (`records.setValues` for one record,
     * `records.setValuesBatch` for up to 500), each naming the base version it
     * started from. A refused record rolls back, marks each refused cell with
     * its message, and one toast with Retry covers them all. A second edit to
     * a cell while the first is in flight shows on top of it, and no late
     * answer brings the older value back. What lands goes on the undo stack.
     */
    setValues: (
      workspace: string,
      changes: readonly CellChange[],
      kind: UndoKind = changes.length > 1 ? 'paste' : 'cell',
    ): Promise<EditOutcome> => edit(workspace, undefined, changes, kind),

    undo: {
      /**
       * Undoes this tab's newest action in the workspace (see `runUndo`);
       * with `only`, that action alone, and only while it is the newest.
       */
      run: (workspace: string, only?: string): Promise<UndoOutcome> => runUndo(workspace, only),
      /** How many actions this tab can undo in the workspace (for tests). */
      depth: (workspace: string): number => undo.size(workspace),
    },

    /** A records event named values its write replaced: raises the notice for the ones this tab wrote. */
    replaced: (workspace: string, event: RecordsEvent): void => {
      void replacedIn(workspace, event);
    },

    /** Reads records again by id (a change event's ids); ids the server leaves out are gone and leave every window. */
    refetch,

    /**
     * Another tab or person changed these records of an object (a change
     * event naming `attributeIds`). Gathered for one frame, then: the ones
     * held are fetched again in place, with only the changed attributes the
     * windows read (none when the event names only others); and every window
     * a change may reorder (its filter or sort attributes, or an id it doesn't
     * show, which may be a record made elsewhere) settles 1.5 s later.
     */
    changed: (workspace: string, objectId: string, ids: readonly string[], attributeIds?: readonly string[]): void => {
      if (ids.length === 0) return;
      remember(workspace, ids);
      const objects = incoming.get(workspace) ?? new Map<string, Gathered>();
      incoming.set(workspace, objects);
      const gathered = objects.get(objectId) ?? { ids: new Set<string>(), attributes: new Set<string>() };
      for (const id of ids) gathered.ids.add(id);
      // An event that doesn't say which attributes changed reads everything the windows show.
      const attributes =
        attributeIds === undefined || gathered.attributes === 'all'
          ? 'all'
          : new Set([...gathered.attributes, ...attributeIds]);
      objects.set(objectId, { ids: gathered.ids, attributes });
      if (isGathering) return;
      isGathering = true;
      schedule(applyIncoming);
    },

    /**
     * Changes may have been missed (a gap, a lost recovery, a coarse event):
     * the workspace's views (or one object's) settle now, reading the blocks
     * on screen and the count again and keeping the table on screen.
     */
    reload: (workspace: string, objectId?: string): void => {
      for (const entry of viewsOf(workspace)) if (objectId === undefined || entry.objectId === objectId) entry.reread();
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
      own.clear();
      undo.clear();
      inflight.clear();
      undoing.clear();
    },

    /** How many record bodies the store holds now (for tests and the gate). */
    size: () => store.size(),
  };
  return records;
}

/** The records layer, as createDataLayer holds it once loaded. */
export type RecordsLayer = ReturnType<typeof createRecordsLayer>;
