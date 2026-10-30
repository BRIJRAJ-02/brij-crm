// Review values (Attio's idea, owner walk 30 Oct 2026): what a file holds
// that won't read as it is, decided once per column or label instead of row
// by row. A select's label that names no option is created, mapped to an
// option, or left empty; a column's cells that don't read are left empty, so
// the rest of each row imports. And, for the preview, what each ready row
// will do. Pure: the screen hands in the rows, the attributes and the answers.
import type { AttributeDefinition, ImportOnMatch, ImportOnNoMatch, StagedRow } from '@crm/data';
import type { ErrorRow } from './rows.ts';

/** What a select's missing label becomes: a new option, an option it already has, or nothing. */
export type LabelChoice =
  { readonly kind: 'create' } | { readonly kind: 'map'; readonly optionId: string } | { readonly kind: 'empty' };

/** A column's label choices, by the label in lower case. */
export type LabelChoices = ReadonlyMap<string, LabelChoice>;

/** The key a label is decided under: as the select matches it, ignoring case. */
export const labelKey = (label: string): string => label.trim().toLocaleLowerCase();

/** Splits a list cell as the select's `fromText` does: commas, semicolons and lines. */
const listParts = (text: string): readonly string[] =>
  text
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');

/**
 * A select or status cell with its label choices applied: a mapped label as
 * the option's own, a label left empty dropped, the rest as written. A list
 * cell keeps its other labels. Empty when nothing is left.
 */
export function applyLabels(
  text: string,
  attribute: Pick<AttributeDefinition, 'type' | 'isMulti' | 'options'>,
  choices: LabelChoices | undefined,
): string {
  if (choices === undefined || choices.size === 0) return text;
  const one = (label: string): string => {
    const choice = choices.get(labelKey(label));
    if (choice?.kind === 'empty') return '';
    if (choice?.kind === 'map') return attribute.options?.find((option) => option.id === choice.optionId)?.label ?? '';
    return label;
  };
  if (attribute.type === 'select' && attribute.isMulti) {
    return listParts(text)
      .map(one)
      .filter((part) => part !== '')
      .join(', ');
  }
  return one(text.trim());
}

/** A column's cells that don't read: how many, the first few as written, and why the first one doesn't. */
export interface CellGroup {
  readonly column: number;
  readonly header: string;
  readonly count: number;
  readonly samples: readonly string[];
  readonly reason: string;
}

/**
 * The error rows' unreadable cells, grouped by column in file order (a row
 * with nothing to import has no column, and stays an error row). Columns in
 * `skip` (a select's missing labels, decided label by label) are left out.
 */
export function cellGroups(errors: readonly ErrorRow[], skip: ReadonlySet<number>, size = 3): readonly CellGroup[] {
  const groups = new Map<number, { header: string; count: number; samples: string[]; reason: string }>();
  for (const row of errors) {
    for (const problem of row.problems) {
      if (problem.column < 0 || skip.has(problem.column)) continue;
      const group = groups.get(problem.column) ?? {
        header: problem.header,
        count: 0,
        samples: [],
        reason: problem.reason,
      };
      group.count += 1;
      const text = (row.cells[problem.column] ?? '').trim();
      if (group.samples.length < size && !group.samples.includes(text)) group.samples.push(text);
      groups.set(problem.column, group);
    }
  }
  return [...groups].sort(([a], [b]) => a - b).map(([column, group]) => ({ column, ...group }));
}

/** What the ready rows will do: records made, records changed, and rows that change nothing. */
export interface RowPlan {
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
}

/** One ready row's answer from the lookup: its keys on the match attribute, and whether one names a record. */
export interface RowMatch {
  readonly keys: readonly string[];
  readonly matched: boolean;
}

/**
 * What each ready row will do, as the job decides it: a row whose key names
 * a record, or names one an earlier row of the file makes, updates it (or is
 * skipped with Skip); any other row makes one (or is skipped with "Only
 * update"). Without a match attribute every row makes one. `answers` are the
 * lookup's, one per ready row in order. A matched row whose values change
 * nothing is skipped by the job; it counts as an update here.
 */
export function rowPlan(
  ready: readonly Pick<StagedRow, 'rowNumber'>[],
  answers: readonly RowMatch[] | undefined,
  onMatch: ImportOnMatch,
  onNoMatch: ImportOnNoMatch,
): RowPlan {
  if (answers === undefined) return { created: ready.length, updated: 0, skipped: 0 };
  const made = new Set<string>();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  ready.forEach((_, index) => {
    const answer = answers[index] ?? { keys: [], matched: false };
    const found = answer.matched || answer.keys.some((key) => made.has(key));
    if (found) {
      if (onMatch === 'skip') skipped += 1;
      else updated += 1;
      return;
    }
    if (onNoMatch === 'skip') {
      skipped += 1;
      return;
    }
    created += 1;
    for (const key of answer.keys) made.add(key);
  });
  return { created, updated, skipped };
}
