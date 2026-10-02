// Moving items within a list by drop target: what a reorderable GridList
// (sorts, view settings, board cards) hands back from React Aria's drag and
// drop, applied to the list. Pure.

/** The list with the items whose keys are `moving` placed before or after `target`, in their order. */
export function reorder<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  moving: ReadonlySet<string>,
  target: string,
  position: 'before' | 'after',
): readonly T[] {
  if (moving.has(target)) return items;
  const moved = items.filter((item) => moving.has(keyOf(item)));
  const rest = items.filter((item) => !moving.has(keyOf(item)));
  const at = rest.findIndex((item) => keyOf(item) === target);
  if (at < 0 || moved.length === 0) return items;
  const index = position === 'before' ? at : at + 1;
  return [...rest.slice(0, index), ...moved, ...rest.slice(index)];
}

/** The list with the item at `from` one place earlier (-1) or later (1), for a Move up or Move down. */
export function moveBy<T>(items: readonly T[], from: number, direction: -1 | 1): readonly T[] {
  const to = from + direction;
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return items;
  next.splice(to, 0, item);
  return next;
}
