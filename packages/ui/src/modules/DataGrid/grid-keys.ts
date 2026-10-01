// Where focus goes for each key in the grid (spec 0003, the keyboard model),
// and cell ranges. Pure, so every key is tested without a browser. Rows count
// from 0 for the first record; row -1 is the header.

/** A cell: a row index (-1 for the header) and a drawn column index (0 is the checkbox column). */
export interface CellPosition {
  readonly row: number;
  readonly col: number;
}

/** What a move can reach: the rows and drawn columns, and how many rows one screen holds. */
export interface GridBounds {
  readonly rowCount: number;
  readonly colCount: number;
  readonly pageRows: number;
}

/** The parts of a key press a move reads. `mod` is ⌘ on a Mac and Ctrl elsewhere. */
export interface MoveKey {
  readonly key: string;
  readonly mod: boolean;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * The cell a key moves focus to, or `undefined` when the key isn't a move.
 * Arrows move one cell, Home and End to the row's ends, Mod with Home or End
 * to the grid's first or last cell, Page Up and Down one screen. A move past
 * an edge stays on the edge.
 */
export function moveFocus(from: CellPosition, { key, mod }: MoveKey, bounds: GridBounds): CellPosition | undefined {
  const lastRow = bounds.rowCount - 1;
  const lastCol = bounds.colCount - 1;
  const at = (row: number, col: number) => ({ row: clamp(row, -1, lastRow), col: clamp(col, 0, lastCol) });
  switch (key) {
    case 'ArrowUp':
      return at(from.row - 1, from.col);
    case 'ArrowDown':
      return at(from.row + 1, from.col);
    case 'ArrowLeft':
      return at(from.row, from.col - 1);
    case 'ArrowRight':
      return at(from.row, from.col + 1);
    case 'Home':
      return mod ? at(0, 0) : at(from.row, 0);
    case 'End':
      return mod ? at(lastRow, lastCol) : at(from.row, lastCol);
    case 'PageUp':
      return at(from.row - bounds.pageRows, from.col);
    case 'PageDown':
      return at(from.row + bounds.pageRows, from.col);
    default:
      return undefined;
  }
}

/** A rectangle of cells: where a shift range started, and where it ends now. */
export interface CellRange {
  readonly anchor: CellPosition;
  readonly focus: CellPosition;
}

/** A range's edges, inclusive. */
export interface RangeEdges {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** The edges of a range, whichever way it was drawn. */
export function rangeEdges({ anchor, focus }: CellRange): RangeEdges {
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    right: Math.max(anchor.col, focus.col),
  };
}

/** True when the cell is inside the range. */
export function isInRange(range: CellRange | undefined, row: number, col: number): boolean {
  if (range === undefined) return false;
  const edges = rangeEdges(range);
  return row >= edges.top && row <= edges.bottom && col >= edges.left && col <= edges.right;
}

/** True for a key that types a character: it opens the editor and replaces the value. */
export function isPrintable(event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}) {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}
