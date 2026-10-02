// The rows a React Aria collection draws from a ListSource, keyed by each
// item's own key once loaded (by place until then), so a row's focus and state
// follow its item when items above it come or go.
import type { Key } from 'react-aria-components';
import type { ListSource } from './list-source.ts';

/** One row: its key, and its place in the source. */
export interface KeyedRow {
  readonly id: string;
  readonly index: number;
}

/** The key a row has before its item loads. */
const placeKey = (index: number) => `\u0000${String(index)}`;

/** Every row of `source`, keyed by item once loaded. */
export function keyedRows<T>(source: ListSource<T>): readonly KeyedRow[] {
  return Array.from({ length: source.count }, (_, index) => {
    const item = source.getItem(index);
    return { id: item === undefined ? placeKey(index) : source.getKey(item), index };
  });
}

/** The item behind a collection key, through the rows it came from. */
export function itemOfKey<T>(source: ListSource<T>, rows: readonly KeyedRow[], key: Key): T | undefined {
  const row = rows.find((each) => each.id === String(key));
  return row === undefined ? undefined : source.getItem(row.index);
}
