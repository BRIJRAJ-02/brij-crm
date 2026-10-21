// CSV writing (spec 0040, used first by spec 0023's submissions export):
// RFC 4180 quoting, CRLF line ends, and the spreadsheet formula guard.
// A text cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return gets
// a leading apostrophe, so no spreadsheet runs it as a formula; numbers are
// written plain. Pure and dependency free, so the browser can share it.

/** The UTF-8 byte order mark an export file starts with, so Excel reads it as UTF-8. */
export const CSV_BOM = '﻿';

/** The characters that make a spreadsheet read a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/u;

/** True when a spreadsheet would read `text` as a formula: it starts with `=`, `+`, `-`, `@`, a tab or a carriage return. */
export function looksLikeFormula(text: string): boolean {
  return FORMULA_START.test(text);
}

/**
 * One cell: `undefined` and `null` empty, a number or boolean plain, text
 * guarded against formulas (unless `guard` is false, for text we wrote from a
 * checked number, date or moment), then quoted when it holds a comma, a quote
 * or a line break (quotes doubled).
 */
export function csvCell(value: string | number | boolean | null | undefined, guard = true): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const guarded = guard && FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/** One line of cells, ended with CRLF. */
export function csvLine(cells: readonly (string | number | boolean | null | undefined)[]): string {
  return `${cells.map((cell) => csvCell(cell)).join(',')}\r\n`;
}

/** One line of cells each already written by `csvCell`, ended with CRLF. */
export function csvJoin(cells: readonly string[]): string {
  return `${cells.join(',')}\r\n`;
}

/**
 * The cell the export guard leaves alone: a value of these types is written
 * by us from a checked shape (a decimal, a date, a moment, true or false, a
 * whole number), so it can't hold a formula, and a spreadsheet should keep it
 * a number or a date.
 */
const UNGUARDED_TYPES: ReadonlySet<string> = new Set(['number', 'currency', 'date', 'timestamp', 'checkbox', 'rating']);

/** Whether a cell of this attribute type needs the formula guard. */
export function guardsType(type: string): boolean {
  return !UNGUARDED_TYPES.has(type);
}

/** What `exportCell` needs to name things: an option's label, a member's name, a linked record's name. */
export interface ExportNames {
  readonly optionLabel: (attributeId: string, optionId: string) => string | undefined;
  readonly actorName: (actor: { readonly type: string; readonly id: string | null }) => string | undefined;
  readonly recordName: (reference: { readonly objectId: string; readonly recordId: string }) => string | undefined;
}

/** A plain object's string field, or undefined. */
function field(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'string' ? found : undefined;
}

/** One value (never a list) as text. */
function oneCell(type: string, attributeId: string, value: unknown, names: ExportNames): string {
  switch (type) {
    case 'text':
    case 'long_text':
    case 'email':
    case 'domain':
    case 'url':
    case 'number':
    case 'date':
    case 'timestamp':
      return typeof value === 'string' ? value : '';
    case 'checkbox':
      return value === true ? 'TRUE' : 'FALSE';
    case 'rating':
      return typeof value === 'number' ? String(value) : '';
    case 'currency': {
      const amount = field(value, 'amount');
      const currency = field(value, 'currency');
      return amount === undefined || currency === undefined ? '' : `${currency} ${amount}`;
    }
    case 'select':
    case 'status':
      return typeof value === 'string' ? (names.optionLabel(attributeId, value) ?? '') : '';
    case 'phone':
      return field(value, 'number') ?? '';
    case 'personal_name':
      return field(value, 'fullName') ?? '';
    case 'actor_reference': {
      const actorType = field(value, 'type');
      if (actorType === undefined) return '';
      return names.actorName({ type: actorType, id: field(value, 'id') ?? null }) ?? '';
    }
    case 'record_reference': {
      const objectId = field(value, 'objectId');
      const recordId = field(value, 'recordId');
      return objectId === undefined || recordId === undefined ? '' : (names.recordName({ objectId, recordId }) ?? '');
    }
    case 'location': {
      if (typeof value !== 'object' || value === null) return '';
      const parts = ['line1', 'line2', 'line3', 'line4', 'locality', 'region', 'postcode', 'countryCode'];
      return parts
        .map((part) => field(value, part))
        .filter((part): part is string => part !== undefined && part !== '')
        .join(', ');
    }
    case 'file':
      return field(value, 'name') ?? '';
    case 'interaction':
      return field(value, 'at') ?? '';
    default:
      return '';
  }
}

/**
 * One attribute's value as the text an export writes (AC-1134): option
 * labels, a name's full name, members and linked records by name, dates as
 * `YYYY-MM-DD`, moments in UTC ISO 8601, numbers plain, money as `<CODE>
 * <amount>`, and several values joined by ", " (how the field set's
 * `fromText` splits a list). Empty for no value.
 */
export function exportCell(
  attribute: { readonly id: string; readonly type: string },
  value: unknown,
  names: ExportNames,
): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value
      .map((each: unknown) => oneCell(attribute.type, attribute.id, each, names))
      .filter((text) => text !== '')
      .join(', ');
  }
  return oneCell(attribute.type, attribute.id, value, names);
}

/**
 * A cell read back from a file: the apostrophe an export put before a
 * formula like text is taken off again, so an exported file imports as it
 * was (`'=SUM` reads as `=SUM`, `'+44 20` as `+44 20`).
 */
export function unguardCell(text: string): string {
  return text.startsWith("'") && looksLikeFormula(text.slice(1)) ? text.slice(1) : text;
}
