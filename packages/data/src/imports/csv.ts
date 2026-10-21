// Reading a CSV file in the browser (spec 0040, AC-1112): the bytes decoded
// (UTF-8, or Windows-1252 when they aren't valid UTF-8, a byte order mark
// dropped), the separator found from the first lines (comma, semicolon or
// tab), and the rows read as RFC 4180 says (quoted fields may hold
// separators, doubled quotes and line breaks), with the limits checked as it
// reads. Pure and dependency free; the import page loads it lazily
// (`@crm/data/imports`), outside the first load.
import { TRANSFER_LIMITS } from '@crm/contracts/transfer-limits';

/** The limits a file is read under; the import's own by default. */
export interface CsvLimits {
  readonly rows: number;
  readonly columns: number;
  readonly bytes: number;
}

/** The import's limits (decision 5): 100,000 data rows, 250 columns, 50 MB. */
export const CSV_LIMITS: CsvLimits = {
  rows: TRANSFER_LIMITS.importRows,
  columns: TRANSFER_LIMITS.importColumns,
  bytes: TRANSFER_LIMITS.importBytes,
};

/** A separator a file may use. */
export type CsvSeparator = ',' | ';' | '\t';

/** A file read: its headers (an empty one named "Column N"), its data rows, the separator and the encoding found. */
export interface CsvTable {
  readonly headers: readonly string[];
  /** Each data row's cells, as many as the headers (short rows padded with empty cells). */
  readonly rows: readonly (readonly string[])[];
  readonly separator: CsvSeparator;
  readonly encoding: 'utf-8' | 'windows-1252';
}

/** Why a file can't be imported, with the numbers the screen words it with. */
export type CsvRefusal =
  | { readonly reason: 'type' }
  | { readonly reason: 'bytes'; readonly bytes: number; readonly limit: number }
  | { readonly reason: 'rows'; readonly limit: number }
  | { readonly reason: 'columns'; readonly columns: number; readonly limit: number }
  /** No header row, or no data row under it. */
  | { readonly reason: 'empty' }
  /** A quoted field never closed: the file ends inside quotes. */
  | { readonly reason: 'quote'; readonly row: number };

/** A file read, or why not. */
export type CsvResult = { readonly ok: true; readonly table: CsvTable } | ({ readonly ok: false } & CsvRefusal);

/** The file types the upload takes (AC-1112). */
export const CSV_TYPES: readonly string[] = [
  'text/csv',
  'text/tab-separated-values',
  'text/plain',
  '.csv',
  '.tsv',
  '.txt',
];

/** True for a name the upload takes: `.csv`, `.tsv` or `.txt`, any case. */
export function isCsvName(name: string): boolean {
  return /\.(csv|tsv|txt)$/i.test(name.trim());
}

/** The bytes as text: UTF-8 when they are valid UTF-8 (its byte order mark dropped), else Windows-1252. */
export function decodeCsv(bytes: Uint8Array): { readonly text: string; readonly encoding: 'utf-8' | 'windows-1252' } {
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(body), encoding: 'windows-1252' };
  }
}

/** How many lines `detectSeparator` reads. */
const SAMPLE_LINES = 20;

/**
 * The separator the first lines use: of comma, semicolon and tab, the one
 * found (outside quotes) on the most of them the same number of times,
 * then the most often; a comma when none is found.
 */
export function detectSeparator(text: string): CsvSeparator {
  const candidates: readonly CsvSeparator[] = [',', ';', '\t'];
  const counts = new Map<CsvSeparator, number[]>(candidates.map((each) => [each, []]));
  let quoted = false;
  let line = new Map<CsvSeparator, number>();
  let lines = 0;
  const endLine = () => {
    for (const each of candidates) counts.get(each)?.push(line.get(each) ?? 0);
    line = new Map();
    lines += 1;
  };
  for (let index = 0; index < text.length && lines < SAMPLE_LINES; index += 1) {
    const char = text[index];
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      endLine();
    } else if (!quoted && (char === ',' || char === ';' || char === '\t')) {
      line.set(char, (line.get(char) ?? 0) + 1);
    }
  }
  if (lines < SAMPLE_LINES && line.size > 0) endLine();
  let best: CsvSeparator = ',';
  let bestScore: readonly [number, number] = [0, 0];
  for (const each of candidates) {
    const seen = (counts.get(each) ?? []).filter((n) => n > 0);
    if (seen.length === 0) continue;
    // How many lines share the most common count, then how many times it appears in all.
    const tally = new Map<number, number>();
    for (const n of seen) tally.set(n, (tally.get(n) ?? 0) + 1);
    const steady = Math.max(...tally.values());
    const total = seen.reduce((sum, n) => sum + n, 0);
    const score: readonly [number, number] = [steady, total];
    if (score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) {
      best = each;
      bestScore = score;
    }
  }
  return best;
}

/** True for a row whose every cell is empty or spaces. */
const isBlank = (row: readonly string[]): boolean => row.every((cell) => cell.trim() === '');

/**
 * Reads CSV text into its headers and rows (RFC 4180): fields split by
 * `separator`, quoted fields holding separators, doubled quotes and line
 * breaks, CRLF, LF or CR ends. Fully empty rows are dropped; more data rows
 * than `limits.rows` or more columns than `limits.columns` stop it at once.
 */
export function parseCsv(
  text: string,
  separator: CsvSeparator,
  limits: CsvLimits = CSV_LIMITS,
  encoding: 'utf-8' | 'windows-1252' = 'utf-8',
): CsvResult {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let started = false;
  let index = 0;
  let width = 0;
  const pushCell = () => {
    row.push(cell);
    cell = '';
    started = false;
  };
  // Answers a refusal when the row just ended breaks a limit.
  const pushRow = (): CsvResult | undefined => {
    pushCell();
    const current = row;
    row = [];
    if (isBlank(current)) return undefined;
    if (current.length > limits.columns) {
      return { ok: false, reason: 'columns', columns: current.length, limit: limits.columns };
    }
    records.push(current);
    width = Math.max(width, current.length);
    // The header row plus the data rows.
    if (records.length - 1 > limits.rows) return { ok: false, reason: 'rows', limit: limits.rows };
    return undefined;
  };
  const length = text.length;
  while (index < length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      // Copy a run of plain characters at once: big files are mostly that.
      const next = text.indexOf('"', index);
      const end = next === -1 ? length : next;
      cell += text.slice(index, end);
      index = end;
      continue;
    }
    if (char === '"' && !started && cell.trim() === '') {
      // A quote opening the field (spaces before it are dropped, as spreadsheets do).
      cell = '';
      quoted = true;
      started = true;
      index += 1;
      continue;
    }
    if (char === separator) {
      pushCell();
      index += 1;
      continue;
    }
    if (char === '\n' || char === '\r') {
      const refused = pushRow();
      if (refused !== undefined) return refused;
      index += char === '\r' && text[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    // A run of plain characters up to the next separator, line end or quote, copied at once.
    let end = index + 1;
    while (end < length) {
      const next = text[end];
      if (next === separator || next === '\n' || next === '\r' || next === '"') break;
      end += 1;
    }
    cell += text.slice(index, end);
    started = true;
    index = end;
  }
  if (quoted) return { ok: false, reason: 'quote', row: records.length + 1 };
  if (cell !== '' || row.length > 0) {
    const refused = pushRow();
    if (refused !== undefined) return refused;
  }
  const [head, ...data] = records;
  if (head === undefined || data.length === 0) return { ok: false, reason: 'empty' };
  const headers = Array.from({ length: width }, (_, column) => {
    const name = (head[column] ?? '').trim();
    return name === '' ? `Column ${String(column + 1)}` : name;
  });
  const rows = data.map((each) =>
    each.length === width ? each : [...each, ...Array<string>(width - each.length).fill('')],
  );
  return { ok: true, table: { headers, rows, separator, encoding } };
}

/**
 * Reads a chosen file (AC-1112): its name and size checked before any byte
 * is read, then decoded, its separator found, and its rows read under the
 * limits.
 */
export async function readCsvFile(
  file: { readonly name: string; readonly size: number; arrayBuffer(): Promise<ArrayBuffer> },
  limits: CsvLimits = CSV_LIMITS,
): Promise<CsvResult> {
  if (!isCsvName(file.name)) return { ok: false, reason: 'type' };
  if (file.size > limits.bytes) return { ok: false, reason: 'bytes', bytes: file.size, limit: limits.bytes };
  const { text, encoding } = decodeCsv(new Uint8Array(await file.arrayBuffer()));
  return parseCsv(text, detectSeparator(text), limits, encoding);
}
