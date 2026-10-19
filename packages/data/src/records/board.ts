// A board's columns (spec 0021, `0021-columns-and-moves.md`): a row of
// windows, one per column, each the view's filter and one option of the
// grouping attribute, in the view's sorts. The first cards and counts of up
// to 12 columns come from one `records.groups` call, the calls sent one after
// another left to right, so a board never holds more than one of the
// workspace's read places for its first load; each answer seeds its
// columns' windows (cursor mode, blocks of 25), which page on by themselves
// with `records.query`. The store holds ids only: bodies stay in the one
// record store. Archived options show as columns only once the first call's
// probe says a live record still holds them.
import { BOARD_BLOCK, BOARD_GROUPS_PER_CALL, columnFilter } from '@crm/contracts/board';
import type { FilterGroup, SortRules } from '@crm/contracts/values';
import type { RecordView } from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';

/** One column's first cards and count, as `records.groups` answers it. */
export interface ColumnSeed {
  readonly records: readonly RecordView[];
  readonly nextCursor?: string;
  readonly count: number;
  readonly atLeast: boolean;
}

/** What a board asks the server for one call: up to 12 columns' first cards and counts. */
export interface GroupsRequest {
  readonly workspace: string;
  readonly objectId: string;
  readonly groupBy: string;
  readonly groupIds: readonly (string | null)[];
  readonly filter?: FilterGroup;
  readonly sorts?: SortRules;
  readonly attributeIds: readonly string[];
  readonly limit: number;
  readonly probeArchived?: boolean;
  readonly now: string;
  readonly timeZone: string;
}

/** What one call answers: each column asked, in order, and the archived options still held when probed. */
export interface GroupsAnswer {
  readonly groups: readonly (ColumnSeed & { readonly id: string | null })[];
  readonly archivedHolding?: readonly string[];
}

/** What a board is: its object, grouping attribute, columns in order (archived ones among them), filter and sorts. */
export interface BoardQuery {
  readonly groupBy: string;
  /** Every column in order: `null` (no value) first, then the options by position, archived ones included. */
  readonly columnIds: readonly (string | null)[];
  /** The archived options among `columnIds`: shown only while a live record holds them. */
  readonly archivedIds?: readonly string[];
  /** The view's effective filter and sorts (spec 0020). */
  readonly filter?: FilterGroup;
  readonly sorts?: SortRules;
}

/** One column the board shows: its option (or `null`), and its window once its first cards are in. */
export interface BoardColumnState<View> {
  readonly id: string | null;
  /** Undefined while its first call is on its way. */
  readonly view?: View;
}

/** Whether the board's first call is on its way, landed, or failed (Retry sends again from the call that failed). */
export type BoardStatus = 'loading' | 'ready' | 'error';

/** A board as a screen reads it. */
export interface BoardState<View> {
  readonly status: BoardStatus;
  readonly error?: DataError;
  readonly columns: readonly BoardColumnState<View>[];
}

/** A board's store: its state, a retry, and a hold while a screen shows it. */
export interface BoardStore<View> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => BoardState<View>;
  /** After a failed call: sends the calls again from the one that failed, keeping the columns already in. */
  readonly retry: () => void;
  /** Holds the board while a screen shows it; the returned function lets go. */
  readonly retain: () => () => void;
  /** Whether a screen holds it. */
  readonly isRetained: () => boolean;
  /** Aborts its call on the way and forgets it. */
  readonly dispose: () => void;
}

/** What a board needs from the records layer. */
export interface BoardDeps<View> {
  readonly workspace: string;
  readonly objectId: string;
  readonly query: BoardQuery;
  /** The attributes the first cards read (card fields, the grouping attribute; the primary always comes). */
  readonly attributeIds: readonly string[];
  /** One `records.groups` call, waiting out a busy server (429) as every read does. */
  readonly groups: (request: GroupsRequest, signal: AbortSignal) => Promise<GroupsAnswer>;
  /** The column's window over `filter` and `sorts`, seeded with its first cards (an open one is shared as is). */
  readonly column: (filter: FilterGroup, sorts: SortRules | undefined, seed: ColumnSeed) => View;
  /** Waits for the workspace's head before the first read (live updates). */
  readonly beforeRead: () => Promise<void>;
  readonly now: () => number;
  readonly timeZone: () => string;
  /** The cards each column reads first: `BOARD_BLOCK`. */
  readonly limit?: number;
}

/** A board over `deps`: its first call goes out at once. */
export function createBoard<View>(deps: BoardDeps<View>): BoardStore<View> {
  const { query } = deps;
  const archived = new Set(query.archivedIds ?? []);
  // The archived options a live record holds, once the first call's probe answered.
  let holding: ReadonlySet<string> | undefined;
  // Columns whose first cards are in, by option id (`null` keyed as '').
  const views = new Map<string, View>();
  let status: BoardStatus = 'loading';
  let error: DataError | undefined;
  let controller = new AbortController();
  let isDisposed = false;
  let isRunning = false;
  let retains = 0;
  const listeners = new Set<() => void>();
  let snapshot: BoardState<View> | undefined;

  const keyOf = (id: string | null) => id ?? '';
  /** Whether a call's answer comes too late: aborted, or the board gone (read fresh, as a call). */
  const isStopped = (signal: AbortSignal) => signal.aborted || isDisposed;
  /** The columns that show: every one but the archived options no live record holds (unknown until probed). */
  const shownIds = () => query.columnIds.filter((id) => id === null || !archived.has(id) || holding?.has(id) === true);
  /** The columns still waiting for their first cards, in order. */
  const waiting = () => shownIds().filter((id) => !views.has(keyOf(id)));

  const changed = () => {
    snapshot = undefined;
    for (const listener of listeners) listener();
  };

  async function run(): Promise<void> {
    if (isRunning || isDisposed) return;
    isRunning = true;
    const { signal } = controller;
    try {
      await deps.beforeRead();
      for (;;) {
        // Before the probe, the first call asks for the first 12 columns as listed, archived ones too.
        const next = (holding === undefined ? query.columnIds : waiting()).slice(0, BOARD_GROUPS_PER_CALL);
        if (next.length === 0 || signal.aborted) break;
        const answer = await deps.groups(
          {
            workspace: deps.workspace,
            objectId: deps.objectId,
            groupBy: query.groupBy,
            groupIds: next,
            ...(query.filter === undefined ? {} : { filter: query.filter }),
            ...(query.sorts === undefined ? {} : { sorts: query.sorts }),
            attributeIds: deps.attributeIds,
            limit: deps.limit ?? BOARD_BLOCK,
            ...(holding === undefined ? { probeArchived: true } : {}),
            now: new Date(deps.now()).toISOString(),
            timeZone: deps.timeZone(),
          },
          signal,
        );
        if (isStopped(signal)) return;
        if (holding === undefined) holding = new Set(answer.archivedHolding ?? []);
        const shown = new Set(shownIds());
        for (const group of answer.groups) {
          if (!shown.has(group.id) || views.has(keyOf(group.id))) continue;
          views.set(
            keyOf(group.id),
            deps.column(columnFilter(query.filter, query.groupBy, group.id), query.sorts, group),
          );
        }
        status = 'ready';
        error = undefined;
        changed();
        // An answer short of what was asked would ask again forever: a column it left out stays loading.
        if (next.some((id) => shown.has(id) && !views.has(keyOf(id)))) break;
      }
    } catch (failure) {
      if (isStopped(signal)) return;
      status = 'error';
      error = toDataError(failure);
      changed();
    } finally {
      isRunning = false;
    }
  }

  void run();

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => {
      snapshot ??= {
        status,
        ...(error === undefined ? {} : { error }),
        columns: shownIds().map((id) => {
          const view = views.get(keyOf(id));
          return view === undefined ? { id } : { id, view };
        }),
      };
      return snapshot;
    },
    retry: () => {
      if (status !== 'error' || isDisposed) return;
      status = views.size === 0 ? 'loading' : 'ready';
      error = undefined;
      controller = new AbortController();
      changed();
      void run();
    },
    retain: () => {
      retains += 1;
      let isReleased = false;
      return () => {
        if (isReleased) return;
        isReleased = true;
        retains -= 1;
      };
    },
    isRetained: () => retains > 0,
    dispose: () => {
      isDisposed = true;
      controller.abort();
      listeners.clear();
    },
  };
}
