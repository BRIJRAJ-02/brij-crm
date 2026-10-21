// Grouped rows (13 Oct reference batch 4): the grid's rows in runs, each under
// a tinted header with its count, that folds. The grid keeps numbering its
// data rows as before; this maps them to and from the drawn lines, where
// each group's header takes a line before its first row. Pure.
import type { Hue } from '../../hue.ts';

/**
 * One run of rows under a header. `start` is where its rows begin in the
 * grid's `rows`; a collapsed group's rows are left out of `rows` by the
 * screen, so it starts where the next group does. Groups come in order.
 */
export interface GridGroup {
  readonly id: string;
  readonly title: string;
  readonly hue?: Hue;
  /** All of its rows, shown or folded away. */
  readonly count: number;
  /** The count is a floor (a filtered count past its cap): it shows as "10,000+". */
  readonly isCountAtLeast?: boolean;
  readonly start: number;
  readonly isCollapsed?: boolean;
}

/** A drawn line: a group's header, or a data row. */
export type GroupLine =
  | { readonly kind: 'group'; readonly group: GridGroup; readonly index: number }
  | { readonly kind: 'row'; readonly row: number };

/** The drawn lines of `count` rows under `groups`: how many, and the way between lines and rows. */
export interface GroupMap {
  /** Lines drawn: the rows plus a header per group. */
  readonly size: number;
  /** The line a data row is drawn on. */
  readonly lineOf: (row: number) => number;
  /** What a line holds. */
  readonly at: (line: number) => GroupLine;
  /** How many data rows come before a line: the first row at or after it. */
  readonly rowsBefore: (line: number) => number;
}

/** The last index in `sorted` whose value is at most `value`, or -1. */
function lastAtMost(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] ?? 0) <= value) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

/** The lines for `count` rows under `groups` (none: each row on its own line). Groups' starts never go down. */
export function groupMap(groups: readonly GridGroup[], count: number): GroupMap {
  const starts = groups.map((group) => Math.min(Math.max(group.start, 0), count));
  // Header k sits on line start + k: the k headers before it each push it down one.
  const headers = starts.map((start, index) => start + index);
  return {
    size: count + groups.length,
    lineOf: (row) => row + lastAtMost(starts, row) + 1,
    at: (line) => {
      const before = lastAtMost(headers, line);
      const group = groups[before];
      if (before >= 0 && headers[before] === line && group !== undefined) {
        return { kind: 'group', group, index: before };
      }
      return { kind: 'row', row: line - (before + 1) };
    },
    rowsBefore: (line) => {
      const before = lastAtMost(headers, line - 1);
      return Math.min(count, Math.max(0, line - (before + 1)));
    },
  };
}
