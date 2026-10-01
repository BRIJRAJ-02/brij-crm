// The grid's pure core (spec 0003, the data grid): column state, keyboard
// moves, ranges, selection and the clipboard format. AC-8 and AC-9.
import { describe, expect, it } from 'vitest';
import { attributeOf } from '../../workbench/attributes.ts';
import { fromTsv, planPaste, toTsv } from './grid-clipboard.ts';
import {
  clampWidth,
  hideColumn,
  moveColumn,
  pinColumn,
  placeColumns,
  reorderColumn,
  resizeColumn,
  unpinColumn,
  type ColumnLayout,
  type GridColumn,
} from './grid-columns.ts';
import { isInRange, isPrintable, moveFocus, rangeEdges } from './grid-keys.ts';
import { allMatching, isRowSelected, noRows, selectedCount, toggleRow, withRows } from './grid-selection.ts';

const column = (id: string, width = 200): GridColumn => ({ id, attribute: attributeOf('text', id), width });
const layout: ColumnLayout = { columns: ['name', 'a', 'b', 'c'].map((id) => column(id)), pinnedCount: 2 };
const ids = (next: ColumnLayout) => next.columns.map((each) => each.id);
const LIMITS = { min: 80, max: 640 };

describe('column state', () => {
  it('draws the pinned run first, with offsets after the checkbox column, and skips hidden columns', () => {
    const placed = placeColumns(hideColumn(layout, 'b'), 36);
    expect(placed.map((each) => [each.column.id, each.isPinned, each.offset])).toEqual([
      ['name', true, 36],
      ['a', true, 236],
      ['c', false, 436],
    ]);
  });

  it('moves a column within its own run, never before the row header', () => {
    expect(ids(moveColumn(layout, 'c', -1))).toEqual(['name', 'a', 'c', 'b']);
    expect(moveColumn(layout, 'b', -1)).toBe(layout);
    expect(moveColumn(layout, 'a', -1)).toBe(layout);
    expect(moveColumn(layout, 'name', 1)).toBe(layout);
    expect(ids(moveColumn(hideColumn(layout, 'b'), 'c', -1))).toEqual(['name', 'a', 'b', 'c']);
  });

  it('pins at the end of the run and unpins to just after it; the row header stays pinned', () => {
    const pinned = pinColumn(layout, 'c');
    expect([ids(pinned), pinned.pinnedCount]).toEqual([['name', 'a', 'c', 'b'], 3]);
    const unpinned = unpinColumn(pinned, 'a');
    expect([ids(unpinned), unpinned.pinnedCount]).toEqual([['name', 'c', 'a', 'b'], 2]);
    expect(unpinColumn(layout, 'name')).toBe(layout);
  });

  it('reorders a dragged column, joining the pinned run when dropped inside it', () => {
    const into = reorderColumn(layout, 'c', 'a');
    expect([ids(into), into.pinnedCount]).toEqual([['name', 'c', 'a', 'b'], 3]);
    const out = reorderColumn(layout, 'a', undefined);
    expect([ids(out), out.pinnedCount]).toEqual([['name', 'b', 'c', 'a'], 1]);
    expect(reorderColumn(layout, 'name', 'c')).toBe(layout);
  });

  it('never hides the row header, and holds widths inside the limits', () => {
    expect(hideColumn(layout, 'name')).toBe(layout);
    expect(clampWidth(20, LIMITS)).toBe(80);
    expect(clampWidth(900, LIMITS)).toBe(640);
    expect(resizeColumn(layout, 'a', 251.6, LIMITS).columns[1]?.width).toBe(252);
  });
});

describe('keyboard moves (AC-8)', () => {
  const bounds = { rowCount: 100, colCount: 5, pageRows: 20 };
  const move = (row: number, col: number, key: string, mod = false) => moveFocus({ row, col }, { key, mod }, bounds);

  it('moves one cell with the arrows, stopping at the edges and the header row', () => {
    expect(move(5, 2, 'ArrowDown')).toEqual({ row: 6, col: 2 });
    expect(move(0, 2, 'ArrowUp')).toEqual({ row: -1, col: 2 });
    expect(move(-1, 2, 'ArrowUp')).toEqual({ row: -1, col: 2 });
    expect(move(5, 4, 'ArrowRight')).toEqual({ row: 5, col: 4 });
    expect(move(5, 0, 'ArrowLeft')).toEqual({ row: 5, col: 0 });
  });

  it('goes to the row ends with Home and End, and the grid ends with Mod', () => {
    expect(move(5, 2, 'Home')).toEqual({ row: 5, col: 0 });
    expect(move(5, 2, 'End')).toEqual({ row: 5, col: 4 });
    expect(move(5, 2, 'Home', true)).toEqual({ row: 0, col: 0 });
    expect(move(5, 2, 'End', true)).toEqual({ row: 99, col: 4 });
  });

  it('moves a screen with Page Up and Page Down', () => {
    expect(move(5, 2, 'PageDown')).toEqual({ row: 25, col: 2 });
    expect(move(90, 2, 'PageDown')).toEqual({ row: 99, col: 2 });
    expect(move(5, 2, 'PageUp')).toEqual({ row: -1, col: 2 });
    expect(move(5, 2, 'a')).toBeUndefined();
  });

  it('reads a range either way it was drawn, and tells typing from shortcuts', () => {
    const range = { anchor: { row: 8, col: 3 }, focus: { row: 2, col: 1 } };
    expect(rangeEdges(range)).toEqual({ top: 2, bottom: 8, left: 1, right: 3 });
    expect(isInRange(range, 5, 2)).toBe(true);
    expect(isInRange(range, 9, 2)).toBe(false);
    const press = (key: string, more = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...more });
    expect(isPrintable(press('a'))).toBe(true);
    expect(isPrintable(press(' '))).toBe(true);
    expect(isPrintable(press('Enter'))).toBe(false);
    expect(isPrintable(press('c', { metaKey: true }))).toBe(false);
  });
});

describe('row selection (AC-8)', () => {
  it('selects some rows by id, or all matching except some', () => {
    const some = toggleRow(withRows(noRows(), ['r1', 'r2'], true), 'r1');
    expect([isRowSelected(some, 'r1'), isRowSelected(some, 'r2'), selectedCount(some, 1000)]).toEqual([false, true, 1]);
    const all = toggleRow(allMatching(), 'r7');
    expect([isRowSelected(all, 'r7'), isRowSelected(all, 'r8'), selectedCount(all, 1_000_000)]).toEqual([
      false,
      true,
      999_999,
    ]);
  });
});

describe('copy and paste text (AC-8)', () => {
  it('writes tab separated rows, quoting like Excel, and reads them back', () => {
    const rows = [
      ['Northwind', 'Line one\nLine two', 'Say "hi"'],
      ['Globex', 'tab\there', ''],
    ];
    const text = toTsv(rows);
    expect(text).toBe('Northwind\t"Line one\nLine two"\t"Say ""hi"""\nGlobex\t"tab\there"\t');
    expect(fromTsv(text)).toEqual(rows);
    expect(fromTsv('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('fills a selected range with one value, and clips a block past the edges', () => {
    const range = { top: 2, bottom: 3, left: 1, right: 2 };
    expect(planPaste([['Hot']], { row: 2, col: 1 }, range, 4, () => true).cells).toHaveLength(4);
    const plan = planPaste(
      [
        ['a', 'b', 'c'],
        ['d', 'e', 'f'],
      ],
      { row: 9, col: 3 },
      undefined,
      4,
      (row) => row < 10,
    );
    expect(plan.cells).toEqual([
      { row: 9, col: 3, text: 'a' },
      { row: 9, col: 4, text: 'b' },
    ]);
    expect(plan.clipped).toBe(4);
  });
});
