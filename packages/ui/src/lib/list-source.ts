// Long lists come from outside through one shape (AC-9): the grid, board
// columns, async menus and pickers, the palette, the timeline, task lists and
// the inbox. Items not loaded yet draw a skeleton; nothing needs every item.

/** A range of item indexes, `start` included and `end` excluded. */
export interface ListRange {
  readonly start: number;
  readonly end: number;
}

/** Items from outside: how many there are, each by index once loaded, and word of which range is on screen. */
export interface ListSource<T> {
  /** How many items there are in all, loaded or not. */
  readonly count: number;
  /** The item at `index`, or `undefined` while it is still loading (a skeleton draws in its place). */
  readonly getItem: (index: number) => T | undefined;
  /** A stable key for an item. */
  readonly getKey: (item: T) => string;
  /** Called with the range on screen, so the source can load it. */
  readonly onRangeChange?: (range: ListRange) => void;
}

/** A ListSource over items already in memory, for short lists, stories and tests. */
export function arraySource<T>(items: readonly T[], getKey: (item: T) => string): ListSource<T> {
  return { count: items.length, getItem: (index) => items[index], getKey };
}
