// CSV writing (spec 0037's shape, used first by spec 0023's submissions
// export): RFC 4180 quoting, CRLF line ends, and the spreadsheet formula guard.
// A text cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return gets
// a leading apostrophe, so no spreadsheet runs it as a formula; numbers are
// written plain. Pure and dependency free, so the browser can share it.

/** The UTF-8 byte order mark an export file starts with, so Excel reads it as UTF-8. */
export const CSV_BOM = '﻿';

/** The characters that make a spreadsheet read a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/u;

/**
 * One cell: `undefined` and `null` empty, a number or boolean plain, text
 * guarded against formulas, then quoted when it holds a comma, a quote or a
 * line break (quotes doubled).
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const guarded = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/** One line of cells, ended with CRLF. */
export function csvLine(cells: readonly (string | number | boolean | null | undefined)[]): string {
  return `${cells.map(csvCell).join(',')}\r\n`;
}
