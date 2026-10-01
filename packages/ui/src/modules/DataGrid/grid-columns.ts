// The grid's column state, kept by us rather than a table library (spec 0003,
// the data grid): order, the pinned run, widths and hiding. Every change
// returns a new layout; the view (#20) saves what `onColumnsChange` reports.
import type { FieldAttribute } from '../../fields/types.ts';

/** One column: the attribute it shows, its width in pixels, and whether it is hidden. */
export interface GridColumn {
  readonly id: string;
  readonly attribute: FieldAttribute;
  readonly width: number;
  readonly isHidden?: boolean;
}

/** The columns in order, and how many from the start are pinned (at least 1: the row header). */
export interface ColumnLayout {
  readonly columns: readonly GridColumn[];
  readonly pinnedCount: number;
}

/** The narrowest and widest a column may be, from `size-column-min` and `size-column-max`. */
export interface WidthLimits {
  readonly min: number;
  readonly max: number;
}

/** A drawn column: where it sits from the grid's start edge, and whether it is in the pinned run. */
export interface PlacedColumn {
  readonly column: GridColumn;
  readonly isPinned: boolean;
  /** Distance from the start of the scrolling area, in pixels, before this column. */
  readonly offset: number;
}

/** `width` held inside the limits, as a whole number of pixels. */
export function clampWidth(width: number, limits: WidthLimits): number {
  return Math.round(Math.min(limits.max, Math.max(limits.min, width)));
}

/** The columns that draw, in order (the pinned run first), with their offsets after `leading` pixels (the checkbox column). */
export function placeColumns(layout: ColumnLayout, leading: number): readonly PlacedColumn[] {
  const placed: PlacedColumn[] = [];
  let offset = leading;
  layout.columns.forEach((column, index) => {
    if (column.isHidden === true) return;
    placed.push({ column, isPinned: index < layout.pinnedCount, offset });
    offset += column.width;
  });
  return placed;
}

function indexOf(layout: ColumnLayout, id: string): number {
  return layout.columns.findIndex((column) => column.id === id);
}

function withColumns(layout: ColumnLayout, columns: readonly GridColumn[], pinnedCount = layout.pinnedCount) {
  return { columns, pinnedCount };
}

/**
 * Moves a column one visible place left (-1) or right (1), within its own run:
 * a pinned column stays pinned and an unpinned one unpinned. The row header
 * (always first) never moves, and nothing moves before it.
 */
export function moveColumn(layout: ColumnLayout, id: string, direction: -1 | 1): ColumnLayout {
  const from = indexOf(layout, id);
  if (from <= 0) return layout;
  const isPinned = from < layout.pinnedCount;
  const start = isPinned ? 1 : layout.pinnedCount;
  const end = isPinned ? layout.pinnedCount : layout.columns.length;
  let to = from + direction;
  while (to >= start && to < end && layout.columns[to]?.isHidden === true) to += direction;
  if (to < start || to >= end) return layout;
  const columns = [...layout.columns];
  const [moving] = columns.splice(from, 1);
  if (moving === undefined) return layout;
  columns.splice(to, 0, moving);
  return withColumns(layout, columns);
}

/** Moves a dragged column to just before `beforeId` (or to the end), joining the pinned run when it lands inside it. */
export function reorderColumn(layout: ColumnLayout, id: string, beforeId: string | undefined): ColumnLayout {
  const from = indexOf(layout, id);
  if (from <= 0 || id === beforeId) return layout;
  const columns = [...layout.columns];
  const [moving] = columns.splice(from, 1);
  if (moving === undefined) return layout;
  const target = beforeId === undefined ? columns.length : columns.findIndex((column) => column.id === beforeId);
  if (target < 0) return layout;
  const to = Math.max(1, target);
  columns.splice(to, 0, moving);
  const wasPinned = from < layout.pinnedCount;
  const pinnedBefore = wasPinned ? layout.pinnedCount - 1 : layout.pinnedCount;
  const isPinned = to < pinnedBefore || (to === pinnedBefore && wasPinned);
  return withColumns(layout, columns, pinnedBefore + (isPinned ? 1 : 0));
}

/** Pins a column at the end of the pinned run, never as a separate island. */
export function pinColumn(layout: ColumnLayout, id: string): ColumnLayout {
  const from = indexOf(layout, id);
  if (from < layout.pinnedCount) return layout;
  const columns = [...layout.columns];
  const [moving] = columns.splice(from, 1);
  if (moving === undefined) return layout;
  columns.splice(layout.pinnedCount, 0, moving);
  return withColumns(layout, columns, layout.pinnedCount + 1);
}

/** Unpins a column to just after the pinned run. The row header stays pinned. */
export function unpinColumn(layout: ColumnLayout, id: string): ColumnLayout {
  const from = indexOf(layout, id);
  if (from <= 0 || from >= layout.pinnedCount) return layout;
  const columns = [...layout.columns];
  const [moving] = columns.splice(from, 1);
  if (moving === undefined) return layout;
  columns.splice(layout.pinnedCount - 1, 0, moving);
  return withColumns(layout, columns, layout.pinnedCount - 1);
}

/** Hides a column. The row header can't be hidden. */
export function hideColumn(layout: ColumnLayout, id: string): ColumnLayout {
  const index = indexOf(layout, id);
  if (index <= 0) return layout;
  return withColumns(
    layout,
    layout.columns.map((column) => (column.id === id ? { ...column, isHidden: true } : column)),
  );
}

/** Sets a column's width, held inside the limits. */
export function resizeColumn(layout: ColumnLayout, id: string, width: number, limits: WidthLimits): ColumnLayout {
  return withColumns(
    layout,
    layout.columns.map((column) => (column.id === id ? { ...column, width: clampWidth(width, limits) } : column)),
  );
}
