// Reading an Excel workbook (.xlsx) for an import (lane wip/crm-dataio, scope
// #30): the file is unzipped with fflate, a part at a time and counted as it
// inflates, so a zip bomb stops at the byte caps whatever its headers claim;
// then the few SpreadsheetML elements an import needs are scanned with plain
// patterns (no XML library: no DTD, no entity expansion past the five named
// entities and numeric references, so no XXE). Only a cell's cached value
// (`<v>`) is read: a formula (`<f>`) is never looked at, and one with no
// cached value is an empty cell. Dates (a number in a date style) become
// `YYYY-MM-DD`, or `YYYY-MM-DD HH:MM` with a time, as the reader's wall time,
// which the field set's `fromText` reads; booleans `TRUE` or `FALSE`. The
// answer is the CSV reader's own table, so the import runs on unchanged.
// Pure: the import page runs it in a Web Worker (`apps/web/.../xlsx.worker.ts`).
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
import { CSV_LIMITS, type CsvLimits, type CsvResult } from './csv.ts';

/** How much one part (a sheet, the shared strings) may inflate to, and all the parts read together. */
export interface XlsxLimits extends CsvLimits {
  readonly partBytes: number;
  readonly totalBytes: number;
}

/** The import's limits (spec 0040, decision 5), and the inflate caps against zip bombs. */
export const XLSX_LIMITS: XlsxLimits = {
  ...CSV_LIMITS,
  partBytes: 120 * 1024 * 1024,
  totalBytes: 200 * 1024 * 1024,
};

/** The most sheets a workbook lists. */
const SHEETS_MAX = 50;

/** How many compressed bytes go into the inflater at once: with deflate's 1,032 to 1 most, about 16 MB out a push. */
const PUSH_BYTES = 16 * 1024;

/** One sheet a workbook holds, by its tab's name. */
export interface XlsxSheet {
  readonly name: string;
}

/** A workbook read: the refusal or table of the chosen sheet, its sheets, and which one was read. */
export type XlsxResult = CsvResult & {
  readonly sheets: readonly XlsxSheet[];
  /** The sheet read, an index into `sheets`. */
  readonly sheet: number;
};

/** True for a name the upload reads as a workbook: `.xlsx`, any case. */
export function isXlsxName(name: string): boolean {
  return /\.xlsx$/iu.test(name.trim());
}

/** Why the zip couldn't be read: broken, or past the inflate caps. */
type UnzipFailure = 'broken' | 'bytes';

/**
 * The parts of `bytes` that `wanted` names, inflated, each held to
 * `limits.partBytes` and all of them to `limits.totalBytes` by counting what
 * comes out (never by trusting the sizes the zip claims).
 */
function unzipParts(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
  limits: XlsxLimits,
): Map<string, Uint8Array> | UnzipFailure {
  const parts = new Map<string, Uint8Array[]>();
  let total = 0;
  let failure: UnzipFailure | undefined;
  const unzip = new Unzip((file) => {
    if (failure !== undefined || !wanted(file.name)) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    parts.set(file.name, chunks);
    file.ondata = (error, chunk) => {
      if (failure !== undefined) return;
      if (error !== null) {
        failure = 'broken';
        return;
      }
      size += chunk.length;
      total += chunk.length;
      if (size > limits.partBytes || total > limits.totalBytes) {
        failure = 'bytes';
        file.terminate();
        return;
      }
      chunks.push(chunk);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  try {
    for (let at = 0; at < bytes.length && failure === undefined; at += PUSH_BYTES) {
      const end = Math.min(at + PUSH_BYTES, bytes.length);
      unzip.push(bytes.subarray(at, end), end === bytes.length);
    }
  } catch {
    return failure ?? 'broken';
  }
  if (failure !== undefined) return failure;
  const joined = new Map<string, Uint8Array>();
  for (const [name, chunks] of parts) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const whole = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      whole.set(chunk, offset);
      offset += chunk.length;
    }
    joined.set(name, whole);
  }
  return joined;
}

const NAMED: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** XML text as it reads: the five named entities, numeric references, and OOXML's `_xHHHH_` escapes. */
export function xmlText(text: string): string {
  return text
    .replace(
      /&(?:#x([0-9a-f]+)|#(\d+)|(lt|gt|amp|quot|apos));/giu,
      (whole, hex?: string, dec?: string, name?: string) => {
        if (name !== undefined) return NAMED[name] ?? whole;
        const code = hex !== undefined ? Number.parseInt(hex, 16) : Number(dec);
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
      },
    )
    .replace(/_x([0-9a-f]{4})_/giu, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      // A NUL or a lone surrogate can't be stored or shown: dropped.
      return code === 0 || (code >= 0xd800 && code <= 0xdfff) ? '' : String.fromCharCode(code);
    });
}

/** One attribute's value from an element's attribute text (`name="value"`), decoded. */
function attr(attributes: string, name: string): string | undefined {
  const found = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'u').exec(attributes);
  if (found === null) return undefined;
  return xmlText(found[1] ?? found[2] ?? '');
}

/** The text of every `<t>` in a string item or an inline string, leaving out phonetic runs (`<rPh>`). */
function runText(xml: string): string {
  const plain = xml.replace(/<(?:[\w.-]+:)?rPh\b[\s\S]*?<\/(?:[\w.-]+:)?rPh>/gu, '');
  let text = '';
  for (const match of plain.matchAll(/<(?:[\w.-]+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?t>)/gu)) {
    text += xmlText(match[1] ?? '');
  }
  return text;
}

/** The shared strings, in order. */
function sharedStrings(xml: string | undefined): readonly string[] {
  if (xml === undefined) return [];
  return [...xml.matchAll(/<(?:[\w.-]+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?si>)/gu)].map((match) =>
    runText(match[1] ?? ''),
  );
}

/** The built in number formats that are dates or times (ECMA-376 18.8.30, and the East Asian ones). */
const DATE_FORMAT_IDS: ReadonlySet<number> = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56,
  57, 58,
]);

/** Whether a custom format code shows a date or a time: a d, m, y, h or s outside quotes, escapes and brackets. */
export function isDateFormat(code: string): boolean {
  const bare = code
    .replace(/"[^"]*"/gu, '')
    .replace(/\\./gu, '')
    .replace(/\[(?!h+\]|m+\]|s+\])[^\]]*\]/giu, '')
    .replace(/_.|\*./gu, '');
  // "General" holds none of the letters; a scientific "0.00E+00" none either.
  return /[dmyhs]/iu.test(bare) && !/^general$/iu.test(bare.trim());
}

/** Which cell styles (by index into `cellXfs`) show their number as a date, and whether only as a time. */
function dateStyles(xml: string | undefined): ReadonlyMap<number, 'date' | 'time'> {
  const found = new Map<number, 'date' | 'time'>();
  if (xml === undefined) return found;
  const custom = new Map<number, string>();
  for (const match of xml.matchAll(/<(?:[\w.-]+:)?numFmt\b([^>]*)>/gu)) {
    const id = Number(attr(match[1] ?? '', 'numFmtId'));
    const code = attr(match[1] ?? '', 'formatCode');
    if (Number.isInteger(id) && code !== undefined) custom.set(id, code);
  }
  const block = /<(?:[\w.-]+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?cellXfs>/u.exec(xml)?.[1] ?? '';
  let index = 0;
  for (const match of block.matchAll(/<(?:[\w.-]+:)?xf\b([^>]*)>/gu)) {
    const id = Number(attr(match[1] ?? '', 'numFmtId') ?? '0');
    const code = custom.get(id);
    const isDate = code === undefined ? DATE_FORMAT_IDS.has(id) : isDateFormat(code);
    if (isDate) {
      const timeOnly = code === undefined ? [18, 19, 20, 21, 45, 46, 47].includes(id) : !/[dy]/iu.test(code);
      found.set(index, timeOnly ? 'time' : 'date');
    }
    index += 1;
  }
  return found;
}

const DAY_MS = 86_400_000;
/** Day 0 of each date system: 30 Dec 1899 (1900 system, with Lotus's leap day) and 1 Jan 1904. */
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1904 = Date.UTC(1904, 0, 1);

const two = (n: number): string => String(n).padStart(2, '0');

/** A serial date as text the field set reads: `YYYY-MM-DD`, with ` HH:MM` when it has a time, or `HH:MM` for a time. */
export function serialText(serial: number, kind: 'date' | 'time', is1904: boolean): string {
  const ms = Math.round((serial * DAY_MS) / 1000) * 1000;
  const at = new Date((is1904 ? EPOCH_1904 : EPOCH_1900) + ms);
  const time = `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}`;
  if (kind === 'time') return time;
  const day = `${String(at.getUTCFullYear()).padStart(4, '0')}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}`;
  return ms % DAY_MS === 0 ? day : `${day} ${time}`;
}

/** A number cell's text: up to 15 significant digits, as a spreadsheet shows it, never `1e-7` style noise kept. */
export function numberText(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw.trim();
  return String(Number(value.toPrecision(15)));
}

/** A cell reference's column, from 0 (`C7` is 2), or undefined without one. */
export function columnOf(reference: string | undefined): number | undefined {
  const letters = reference === undefined ? undefined : /^\$?([a-z]{1,3})/iu.exec(reference)?.[1];
  if (letters === undefined) return undefined;
  let column = 0;
  for (const letter of letters.toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64);
  return column - 1;
}

/** What reading one sheet's cells needs. */
interface SheetContext {
  readonly strings: readonly string[];
  readonly styles: ReadonlyMap<number, 'date' | 'time'>;
  readonly is1904: boolean;
  readonly limits: CsvLimits;
}

/** One cell's text, from its attributes and inner XML. Only the cached value: `<f>` is never read. */
function cellText(attributes: string, inner: string, context: SheetContext): string {
  const type = attr(attributes, 't') ?? 'n';
  if (type === 'inlineStr') {
    const inline = /<(?:[\w.-]+:)?is\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?is>/u.exec(inner)?.[1];
    return inline === undefined ? '' : runText(inline);
  }
  const raw = /<(?:[\w.-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?v>/u.exec(inner)?.[1];
  if (raw === undefined) return '';
  const value = xmlText(raw);
  switch (type) {
    case 's':
      return context.strings[Number(value)] ?? '';
    case 'b':
      return value.trim() === '1' || value.trim().toLowerCase() === 'true' ? 'TRUE' : 'FALSE';
    case 'e':
      return '';
    case 'str':
    case 'd':
      return value;
    default: {
      const style = context.styles.get(Number(attr(attributes, 's') ?? '0'));
      const serial = Number(value);
      if (style !== undefined && Number.isFinite(serial) && serial >= 0) {
        return serialText(serial, style, context.is1904);
      }
      return numberText(value);
    }
  }
}

/** True for a row whose every cell is empty or spaces. */
const isBlank = (row: readonly string[]): boolean => row.every((cell) => cell.trim() === '');

/** Reads one sheet's XML into the CSV reader's table, under its limits. */
export function readSheet(xml: string, context: SheetContext): CsvResult {
  const { limits } = context;
  const records: string[][] = [];
  let width = 0;
  const data = /<(?:[\w.-]+:)?sheetData\b[^>]*?(?:\/>|>([\s\S]*)<\/(?:[\w.-]+:)?sheetData>)/u.exec(xml)?.[1] ?? '';
  const rowPattern = /<(?:[\w.-]+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?row>)/gu;
  for (const rowMatch of data.matchAll(rowPattern)) {
    const row: string[] = [];
    let next = 0;
    const cellPattern = /<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c>)/gu;
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(cellPattern)) {
      const attributes = cellMatch[1] ?? '';
      const column = columnOf(attr(attributes, 'r')) ?? next;
      if (column >= limits.columns) {
        // A styled but empty cell far to the right is no column: only a value past the limit refuses.
        const text = cellText(attributes, cellMatch[2] ?? '', context);
        if (text.trim() === '') continue;
        return { ok: false, reason: 'columns', columns: column + 1, limit: limits.columns };
      }
      const text = cellText(attributes, cellMatch[2] ?? '', context);
      while (row.length < column) row.push('');
      row[column] = text;
      next = column + 1;
    }
    if (isBlank(row)) continue;
    // Trailing empty cells (a styled column) don't widen the table.
    let end = row.length;
    while (end > 0 && (row[end - 1] ?? '').trim() === '') end -= 1;
    const trimmed = row.slice(0, end);
    records.push(trimmed);
    width = Math.max(width, trimmed.length);
    if (records.length - 1 > limits.rows) return { ok: false, reason: 'rows', limit: limits.rows };
  }
  const [head, ...rows] = records;
  if (head === undefined || rows.length === 0) return { ok: false, reason: 'empty' };
  const headers = Array.from({ length: width }, (_, column) => {
    const name = (head[column] ?? '').trim();
    return name === '' ? `Column ${String(column + 1)}` : name;
  });
  return {
    ok: true,
    table: {
      headers,
      rows: rows.map((each) =>
        each.length === width ? each : [...each, ...Array<string>(width - each.length).fill('')],
      ),
    },
  };
}

/** A part's path from a relationship's target: relative to `xl/`, or absolute from the package root. */
function partPath(target: string): string {
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  // `xl/../x` style paths, folded.
  const parts: string[] = [];
  for (const piece of path.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.' && piece !== '') parts.push(piece);
  }
  return parts.join('/');
}

const decoder = new TextDecoder('utf-8');
const textOf = (bytes: Uint8Array | undefined): string | undefined =>
  bytes === undefined ? undefined : decoder.decode(bytes);

/** The refusal for a file that isn't a workbook we can read, or one past the inflate caps. */
function refusalOf(failure: UnzipFailure, limits: XlsxLimits): CsvResult {
  return failure === 'bytes'
    ? { ok: false, reason: 'bytes', bytes: limits.totalBytes + 1, limit: limits.totalBytes }
    : { ok: false, reason: 'broken' };
}

/**
 * Reads a workbook's bytes: its visible worksheets' names, then the sheet
 * asked for (by index), else the first one that holds a header and a row.
 */
export function readXlsx(bytes: Uint8Array, sheet?: number, limits: XlsxLimits = XLSX_LIMITS): XlsxResult {
  const none = { sheets: [], sheet: 0 };
  // Pass one: the workbook, its relationships, the styles and the shared strings.
  const meta = unzipParts(
    bytes,
    (name) =>
      name === 'xl/workbook.xml' ||
      name === 'xl/_rels/workbook.xml.rels' ||
      name === 'xl/styles.xml' ||
      name === 'xl/sharedStrings.xml',
    limits,
  );
  if (typeof meta === 'string') return { ...refusalOf(meta, limits), ...none };
  const workbook = textOf(meta.get('xl/workbook.xml'));
  const rels = textOf(meta.get('xl/_rels/workbook.xml.rels'));
  if (workbook === undefined || rels === undefined) return { ok: false, reason: 'broken', ...none };
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<(?:[\w.-]+:)?Relationship\b([^>]*)>/gu)) {
    const id = attr(match[1] ?? '', 'Id');
    const type = attr(match[1] ?? '', 'Type') ?? '';
    const target = attr(match[1] ?? '', 'Target');
    if (id !== undefined && target !== undefined && /\/worksheet$/u.test(type)) targets.set(id, partPath(target));
  }
  const listed: { readonly name: string; readonly path: string }[] = [];
  for (const match of workbook.matchAll(/<(?:[\w.-]+:)?sheet\b([^>]*)>/gu)) {
    const attributes = match[1] ?? '';
    const state = attr(attributes, 'state');
    const path = targets.get(attr(attributes, 'id') ?? '');
    if (path === undefined || state === 'hidden' || state === 'veryHidden') continue;
    listed.push({ name: attr(attributes, 'name') ?? `Sheet ${String(listed.length + 1)}`, path });
    if (listed.length >= SHEETS_MAX) break;
  }
  const sheets = listed.map(({ name }) => ({ name }));
  if (listed.length === 0) return { ok: false, reason: 'empty', sheets, sheet: 0 };
  const props = /<(?:[\w.-]+:)?workbookPr\b([^>]*)>/u.exec(workbook)?.[1] ?? '';
  const date1904 = attr(props, 'date1904');
  const context: SheetContext = {
    strings: sharedStrings(textOf(meta.get('xl/sharedStrings.xml'))),
    styles: dateStyles(textOf(meta.get('xl/styles.xml'))),
    is1904: date1904 === '1' || date1904 === 'true',
    limits,
  };
  const order = sheet !== undefined && sheet >= 0 && sheet < listed.length ? [sheet] : listed.map((_, index) => index);
  let first: XlsxResult | undefined;
  for (const index of order) {
    const path = listed[index]?.path ?? '';
    // Pass two: one sheet at a time, so a workbook of many sheets never holds them all at once.
    const part = unzipParts(bytes, (name) => name === path, limits);
    if (typeof part === 'string') return { ...refusalOf(part, limits), sheets, sheet: index };
    const xml = textOf(part.get(path));
    const read: XlsxResult =
      xml === undefined
        ? { ok: false, reason: 'broken', sheets, sheet: index }
        : { ...readSheet(xml, context), sheets, sheet: index };
    // Only an empty sheet passes to the next; any other answer (a table, or a limit) is the answer.
    if (read.ok || read.reason !== 'empty') return read;
    first ??= read;
  }
  return first ?? { ok: false, reason: 'empty', sheets, sheet: 0 };
}

/**
 * Reads a chosen workbook file: its name and size checked before any byte is
 * read, then its sheet (`sheet`, else the first with data).
 */
export async function readXlsxFile(
  file: { readonly name: string; readonly size: number; arrayBuffer(): Promise<ArrayBuffer> },
  sheet?: number,
  limits: XlsxLimits = XLSX_LIMITS,
): Promise<XlsxResult> {
  if (!isXlsxName(file.name)) return { ok: false, reason: 'type', sheets: [], sheet: 0 };
  if (file.size > limits.bytes) {
    return { ok: false, reason: 'bytes', bytes: file.size, limit: limits.bytes, sheets: [], sheet: 0 };
  }
  return readXlsx(new Uint8Array(await file.arrayBuffer()), sheet, limits);
}
