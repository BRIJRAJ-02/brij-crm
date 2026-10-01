// Copy and paste as spreadsheets do it (spec 0003): tab separated text, with
// Excel's quoting for a cell holding a tab, a line break or a quote, and the
// plan for where a pasted block lands.
import type { CellPosition, RangeEdges } from './grid-keys.ts';

const NEEDS_QUOTES = /[\t\n\r"]/;

/** Cells as tab separated text, one row per line, quoted like Excel where a cell needs it. */
export function toTsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) => row.map((cell) => (NEEDS_QUOTES.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join('\t'))
    .join('\n');
}

/** Tab separated text back into rows of cells, reading Excel's quoting and either line ending. A trailing line break adds no row. */
export function fromTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let index = 0;
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };
  while (index < text.length) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"' && text.charAt(index + 1) === '"') {
        cell += '"';
        index += 2;
        continue;
      }
      if (char === '"') quoted = false;
      else cell += char;
      index += 1;
      continue;
    }
    if (char === '"' && cell === '') quoted = true;
    else if (char === '\t') endCell();
    else if (char === '\r' && text.charAt(index + 1) === '\n') {
      endRow();
      index += 1;
    } else if (char === '\n' || char === '\r') endRow();
    else cell += char;
    index += 1;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

/** One cell a paste writes: where, and the text its column's type reads. */
export interface PastedCell {
  readonly row: number;
  readonly col: number;
  readonly text: string;
}

/** Where a paste lands, and how many cells fell past the last column or the loaded rows. */
export interface PastePlan {
  readonly cells: readonly PastedCell[];
  readonly clipped: number;
}

/**
 * Where pasted cells land. One copied value fills the whole selected range;
 * a block keeps its own shape from the focused cell. Cells past `lastCol` or
 * past the loaded rows (`isLoaded`) are clipped and counted.
 */
export function planPaste(
  block: readonly (readonly string[])[],
  start: CellPosition,
  range: RangeEdges | undefined,
  lastCol: number,
  isLoaded: (row: number) => boolean,
): PastePlan {
  const single = block.length === 1 && block[0]?.length === 1 ? block[0][0] : undefined;
  const cells: PastedCell[] = [];
  let clipped = 0;
  if (single !== undefined && range !== undefined) {
    for (let row = range.top; row <= range.bottom; row += 1) {
      for (let col = range.left; col <= range.right; col += 1) {
        if (isLoaded(row)) cells.push({ row, col, text: single });
        else clipped += 1;
      }
    }
    return { cells, clipped };
  }
  block.forEach((values, rowOffset) => {
    values.forEach((text, colOffset) => {
      const row = start.row + rowOffset;
      const col = start.col + colOffset;
      if (col > lastCol || !isLoaded(row)) clipped += 1;
      else cells.push({ row, col, text });
    });
  });
  return { cells, clipped };
}
