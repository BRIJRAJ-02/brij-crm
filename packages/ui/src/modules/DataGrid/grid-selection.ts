// Which rows are selected (spec 0003): some rows by id, or every row that
// matches the view except some, so "select all 1,000,000" never lists ids.

/** The grid's row selection. */
export type GridSelection =
  | { readonly kind: 'some'; readonly ids: ReadonlySet<string> }
  | { readonly kind: 'all-matching'; readonly except: ReadonlySet<string> };

/** No rows selected. */
export function noRows(): GridSelection {
  return { kind: 'some', ids: new Set() };
}

/** Every row matching the view. */
export function allMatching(): GridSelection {
  return { kind: 'all-matching', except: new Set() };
}

/** True when the row is selected. */
export function isRowSelected(selection: GridSelection, id: string): boolean {
  return selection.kind === 'some' ? selection.ids.has(id) : !selection.except.has(id);
}

/** The selection with these rows set to `selected`. */
export function withRows(selection: GridSelection, ids: readonly string[], selected: boolean): GridSelection {
  if (selection.kind === 'some') {
    const next = new Set(selection.ids);
    for (const id of ids) {
      if (selected) next.add(id);
      else next.delete(id);
    }
    return { kind: 'some', ids: next };
  }
  const except = new Set(selection.except);
  for (const id of ids) {
    if (selected) except.delete(id);
    else except.add(id);
  }
  return { kind: 'all-matching', except };
}

/** The selection with one row flipped. */
export function toggleRow(selection: GridSelection, id: string): GridSelection {
  return withRows(selection, [id], !isRowSelected(selection, id));
}

/** How many rows are selected, out of `total` matching. */
export function selectedCount(selection: GridSelection, total: number): number {
  return selection.kind === 'some' ? selection.ids.size : Math.max(0, total - selection.except.size);
}
