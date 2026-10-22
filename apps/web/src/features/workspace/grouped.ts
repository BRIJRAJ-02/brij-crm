// A table grouped by a status or single select (13 Oct reference batch 4): the
// view's rows in runs, one per option, read through the board's per group
// windows (spec 0021). One `records.groups` aggregate gives every group its
// count and first page; each open group's window then pages on as the grid
// scrolls into it, and a folded group's rows are never asked for. The grid
// reads the open groups' windows end to end as one source.
import {
  isGroupable,
  type AttributeDefinition,
  type BoardStore,
  type RecordView,
  type RecordsView,
  type ViewQuery,
  type ViewState,
} from '@crm/data';
import { useBoard } from '@crm/data/react';
import type { GridGroup, RowSource } from '@crm/ui/grid';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { planBoard, type BoardPlan } from '../board/plan.ts';
import { strings as boardStrings } from '../board/strings.ts';

/** A grouped table's rows and their groups, or why it has none yet. */
export interface GroupedRows {
  readonly status: 'loading' | 'ready' | 'error';
  readonly source: RowSource<RecordView>;
  readonly groups: readonly GridGroup[];
  readonly retry: () => void;
}

/** The board plan grouping a table by `groupBy`, or undefined when it can't (gone, archived, not a status or select). */
export function groupPlan(
  attributes: readonly AttributeDefinition[],
  groupBy: string | undefined,
): BoardPlan | undefined {
  if (groupBy === undefined) return undefined;
  const attribute = attributes.find((each) => each.id === groupBy);
  if (attribute === undefined || !isGroupable(attribute)) return undefined;
  const plan = planBoard(attributes, { groupByAttributeId: groupBy, cardFields: [], showEmptyColumns: false });
  return plan.kind === 'board' && plan.groupBy.id === groupBy ? plan : undefined;
}

/** One group as the table runs it: its column's window (when in), and where its rows start. */
interface Run {
  readonly group: GridGroup;
  readonly state: ViewState | undefined;
  readonly start: number;
  readonly shown: number;
}

/** The last run starting at or before `index`. Runs are in order, by start. */
function runAt(runs: readonly Run[], index: number): Run | undefined {
  let low = 0;
  let high = runs.length - 1;
  let found: Run | undefined;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const run = runs[middle];
    if (run === undefined) break;
    if (run.start <= index) {
      found = run;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

/** Opens and holds the board store for the grouped table's question; the one shown stays until the next exists. */
function useGroupStore(
  slug: string,
  objectId: string,
  plan: BoardPlan | undefined,
  query: ViewQuery,
  attributeIds: readonly string[],
): BoardStore<RecordsView> | undefined {
  const { data } = useRouteContext({ from: '__root__' });
  const asked = useMemo(
    () =>
      plan === undefined
        ? undefined
        : {
            groupBy: plan.groupBy.id,
            columnIds: plan.columnIds,
            archivedIds: plan.archivedIds,
            ...(query.filter === undefined ? {} : { filter: query.filter }),
            ...(query.sorts === undefined ? {} : { sorts: query.sorts }),
          },
    [plan, query.filter, query.sorts],
  );
  const key = asked === undefined ? undefined : JSON.stringify([objectId, asked]);
  const [held, setHeld] = useState<{ readonly key: string; readonly store: BoardStore<RecordsView> }>();
  useEffect(() => {
    if (asked === undefined || key === undefined) return undefined;
    let isCurrent = true;
    void data.records.board(slug, objectId, asked, attributeIds).then((store) => {
      if (isCurrent) setHeld({ key, store });
    });
    return () => {
      isCurrent = false;
    };
    // The question is `key`; the columns shown reach the windows through useBoard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, slug, key]);
  return key === undefined ? undefined : held?.store;
}

/** The empty board's one snapshot: the same object every read, as useSyncExternalStore needs. */
const NO_BOARD_SNAPSHOT: ReturnType<BoardStore<RecordsView>['getSnapshot']> = { status: 'loading', columns: [] };

/** An empty board while none is held: nothing to read. */
const NO_BOARD: BoardStore<RecordsView> = {
  subscribe: () => () => undefined,
  getSnapshot: () => NO_BOARD_SNAPSHOT,
  retry: () => undefined,
  retain: () => () => undefined,
  isRetained: () => false,
  move: () => Promise.resolve(false),
  holdStill: () => undefined,
  dispose: () => undefined,
};

/**
 * The rows of a table grouped by `plan`'s attribute, for the grid: the open
 * groups' windows end to end, and a header per group with its count. A
 * group with no rows is left out (an archived option too); `folded` groups
 * keep their header and count, and their rows are never read.
 */
export function useGroupedRows(
  slug: string,
  objectId: string,
  plan: BoardPlan | undefined,
  query: ViewQuery,
  attributeIds: readonly string[],
  folded: ReadonlySet<string>,
): GroupedRows | undefined {
  const store = useGroupStore(slug, objectId, plan, query, attributeIds);
  const board = useBoard(store ?? NO_BOARD, attributeIds);
  return useMemo(() => {
    if (plan === undefined || store === undefined) return undefined;
    const options = new Map((plan.groupBy.options ?? []).map((option) => [option.id, option]));
    const runs: Run[] = [];
    let start = 0;
    for (const column of board.columns) {
      const count = column.state?.count.count ?? 0;
      if (column.state !== undefined && count === 0) continue;
      const id = column.id ?? '';
      const option = column.id === null ? undefined : options.get(column.id);
      const isCollapsed = folded.has(id);
      const shown = isCollapsed || column.state === undefined ? 0 : column.state.source.count;
      runs.push({
        group: {
          id,
          title: option?.label ?? boardStrings.noValue(plan.groupBy.title),
          ...(option === undefined ? {} : { hue: option.hue }),
          count,
          ...(column.state?.count.atLeast === true ? { isCountAtLeast: true } : {}),
          start,
          isCollapsed,
        },
        state: column.state,
        start,
        shown,
      });
      start += shown;
    }
    const open = runs.filter((run) => run.shown > 0);
    const source: RowSource<RecordView> = {
      count: start,
      getItem: (index) => {
        const run = runAt(open, index);
        return run?.state?.source.getItem(index - run.start);
      },
      getKey: (row) => row.id,
      // The grid's range, handed to each open group it covers in that group's own rows.
      onRangeChange: (range) => {
        for (const run of open) {
          const from = Math.max(range.start, run.start);
          const to = Math.min(range.end, run.start + run.shown);
          if (from < to) run.state?.source.onRangeChange({ start: from - run.start, end: to - run.start });
        }
      },
    };
    return {
      status: board.status,
      source,
      groups: runs.map((run) => run.group),
      retry: () => {
        store.retry();
      },
    };
  }, [plan, store, board, folded]);
}
