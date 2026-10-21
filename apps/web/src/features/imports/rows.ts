// Reading a file's rows into values (spec 0040, AC-1120, AC-1121): every cell
// through the field set's `fromText` for its attribute's type (the one parser
// for paste, copy and import), a name's parts joined, a spreadsheet's formula
// guard taken off. Pure: the screen hands in how to build each type's context.
import type { ImportTarget, StagedRow } from '@crm/data';
import { CSV_BOM, csvLine, unguardCell } from '@crm/data/imports';
import { fieldTypeOf, isRefusal, type FieldAttribute, type TextContext } from '@crm/ui';

/** One cell that couldn't be read, and why. */
export interface CellProblem {
  readonly column: number;
  readonly header: string;
  readonly reason: string;
}

/** A row with a cell that couldn't be read: none of its cells are imported (AC-1120). */
export interface ErrorRow {
  /** Its line in the file: the first data row is 2. */
  readonly rowNumber: number;
  readonly cells: readonly string[];
  readonly problems: readonly CellProblem[];
}

/** What reading the rows found: the ready rows to stage, and the rows with errors to show and download. */
export interface ReadRows {
  readonly ready: readonly StagedRow[];
  readonly errors: readonly ErrorRow[];
}

/** What a row says when every cell matched to an attribute is empty. */
export const EMPTY_ROW = 'Every cell matched to an attribute is empty.';

/** A cell as the reader takes it: a spreadsheet's leading apostrophe off a formula, then trimmed. */
export const cellText = (text: string | undefined): string => unguardCell(text ?? '').trim();

/** How many names one relation cell sends at most (the job reads no more). */
export const NAMES_PER_CELL = 50;

/** A relation cell's names: split on commas, semicolons and lines for a list of links, else the whole cell. */
export function relationNames(text: string, isMulti: boolean): readonly string[] {
  const names = isMulti ? text.split(/[,;\n]/) : [text];
  return names
    .map((name) => name.trim().slice(0, 500))
    .filter((name) => name !== '')
    .slice(0, NAMES_PER_CELL);
}

/** One cell through its type's `fromText`: the value, or why not. */
export function readCell(
  text: string,
  attribute: FieldAttribute,
  context: (attribute: FieldAttribute) => TextContext,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string } {
  const value: unknown = fieldTypeOf(attribute.type).fromText(text, context(attribute));
  return isRefusal(value) ? { ok: false, reason: value.reason } : { ok: true, value };
}

/**
 * Reads every data row (AC-1120): a ready row holds a value per matched
 * attribute (empty cells left out, so they never clear anything); a row with
 * any cell its type can't read is an error row, as is one with nothing to
 * import.
 */
export function readRows(
  rows: readonly (readonly string[])[],
  headers: readonly string[],
  targets: readonly (ImportTarget | undefined)[],
  attributes: ReadonlyMap<string, FieldAttribute>,
  context: (attribute: FieldAttribute) => TextContext,
  offset = 0,
): ReadRows {
  const ready: StagedRow[] = [];
  const errors: ErrorRow[] = [];
  rows.forEach((cells, index) => {
    const rowNumber = offset + index + 2;
    const values: Record<string, unknown> = {};
    const names = new Map<string, { firstName?: string; lastName?: string }>();
    const problems: CellProblem[] = [];
    targets.forEach((target, column) => {
      const attribute = target === undefined ? undefined : attributes.get(target.attributeId);
      if (target === undefined || attribute === undefined) return;
      const text = cellText(cells[column]);
      if (text === '') return;
      if (target.part !== undefined) {
        const name = names.get(target.attributeId) ?? {};
        names.set(target.attributeId, { ...name, [target.part === 'first' ? 'firstName' : 'lastName']: text });
        return;
      }
      // A relation cell holds names (several for a list of links); the job links each to a record (decision 7).
      if (attribute.type === 'record_reference') {
        values[target.attributeId] = { names: relationNames(text, attribute.allowMultiple) };
        return;
      }
      const read = readCell(text, attribute, context);
      if (read.ok) values[target.attributeId] = read.value;
      else problems.push({ column, header: headers[column] ?? '', reason: read.reason });
    });
    for (const [attributeId, name] of names) values[attributeId] = name;
    if (problems.length > 0) errors.push({ rowNumber, cells, problems });
    else if (Object.keys(values).length === 0) {
      errors.push({ rowNumber, cells, problems: [{ column: -1, header: '', reason: EMPTY_ROW }] });
    } else ready.push({ rowNumber, values });
  });
  return { ready, errors };
}

/** Rows one slice reads before the page gets the main thread back. */
export const SLICE_ROWS = 2_000;

/**
 * `readRows` a slice at a time, giving the main thread back between slices
 * so the page stays responsive on a 100,000 row file; `onProgress` hears the
 * rows read so far. Stops (answering undefined) once `isCancelled` says so.
 */
export async function readRowsInSlices(
  rows: readonly (readonly string[])[],
  headers: readonly string[],
  targets: readonly (ImportTarget | undefined)[],
  attributes: ReadonlyMap<string, FieldAttribute>,
  context: (attribute: FieldAttribute) => TextContext,
  onProgress: (read: number) => void = () => undefined,
  isCancelled: () => boolean = () => false,
): Promise<ReadRows | undefined> {
  const ready: StagedRow[] = [];
  const errors: ErrorRow[] = [];
  for (let start = 0; start < rows.length; start += SLICE_ROWS) {
    const part = readRows(rows.slice(start, start + SLICE_ROWS), headers, targets, attributes, context, start);
    for (const row of part.ready) ready.push(row);
    for (const row of part.errors) errors.push(row);
    onProgress(Math.min(rows.length, start + SLICE_ROWS));
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    if (isCancelled()) return undefined;
  }
  return { ready, errors };
}

/** One error row's reasons as one line: "Email: Type an email address, such as ada@example.com." */
export const problemText = (row: Pick<ErrorRow, 'problems'>): string =>
  row.problems
    .map((problem) => (problem.header === '' ? problem.reason : `${problem.header}: ${problem.reason}`))
    .join(' ');

/**
 * The rows with errors as a CSV to fix and import again (AC-1121): the
 * file's headers and cells, then an Error column; a byte order mark first,
 * so a spreadsheet reads it as UTF-8.
 */
export function errorRowsCsv(headers: readonly string[], errors: readonly ErrorRow[], errorHeader: string): string {
  const lines = errors.map((row) =>
    csvLine([...headers.map((_, column) => row.cells[column] ?? ''), problemText(row)]),
  );
  return `${CSV_BOM}${csvLine([...headers, errorHeader])}${lines.join('')}`;
}
