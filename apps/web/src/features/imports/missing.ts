// What a file holds that the object doesn't yet (spec 0040, AC-1116, AC-1122,
// decision 7): a select's labels that name no option, the type a new
// attribute's values suggest, and a relation column's distinct names. Pure:
// the screen hands in the rows and the attribute.
import type { AttributeDefinition, PickerAttributeType } from '@crm/data';
import { cellText, relationNames } from './rows.ts';

/** Splits a list cell as the select's `fromText` does: commas, semicolons and lines. */
const listParts = (text: string): readonly string[] =>
  text
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');

/**
 * A select or status column's labels that name no option of the attribute,
 * ignoring case, each once as first written (AC-1122). A label an archived
 * option holds is left out: the option exists, so creating it would clash.
 */
export function missingOptions(
  rows: readonly (readonly string[])[],
  column: number,
  attribute: Pick<AttributeDefinition, 'type' | 'isMulti' | 'options'>,
): readonly string[] {
  if (attribute.type !== 'select' && attribute.type !== 'status') return [];
  const held = new Set((attribute.options ?? []).map((option) => option.label.toLocaleLowerCase()));
  const missing = new Map<string, string>();
  for (const cells of rows) {
    const text = cellText(cells[column]);
    if (text === '') continue;
    for (const label of attribute.type === 'select' && attribute.isMulti ? listParts(text) : [text]) {
      const key = label.toLocaleLowerCase();
      if (!held.has(key) && !missing.has(key)) missing.set(key, label.slice(0, 100));
    }
  }
  return [...missing.values()];
}

/** Tests for the types a new attribute may take, in the order they are tried: the first every sample passes wins. */
const SUGGESTIONS: readonly (readonly [PickerAttributeType, (text: string) => boolean])[] = [
  ['email', (text) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(text)],
  // A bare domain ("acme.com") is a website too: Domains is a system type, so a new attribute takes URL.
  ['url', (text) => /^https?:\/\/\S+$/iu.test(text) || /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/iu.test(text)],
  ['number', (text) => /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/u.test(text)],
  ['checkbox', (text) => /^(true|false|yes|no)$/iu.test(text)],
  // A day first or month first date reads either way in the browser's language; the preview says when one can't.
  ['date', (text) => /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})$/u.test(text)],
];

/**
 * The type a new attribute takes from its column's values (AC-1116): email,
 * URL (a domain too), number, checkbox or date when every non empty sample reads
 * as one, else text (when unsure, or with no samples).
 */
export function suggestType(samples: readonly string[]): PickerAttributeType {
  const given = samples.map((text) => text.trim()).filter((text) => text !== '');
  if (given.length === 0) return 'text';
  const found = SUGGESTIONS.find(([, fits]) => given.every(fits));
  return found === undefined ? 'text' : found[0];
}

/** The most distinct values a column may hold for a new attribute to start as a Select of them. */
export const SELECT_SUGGEST_MAX = 20;

/**
 * What a new attribute from a column starts as (the attribute dialog,
 * prefilled): the type its values suggest, and a Select of its values when
 * they read as text, repeat, and are 20 or fewer, each once as first written.
 */
export function suggestAttribute(texts: readonly string[]): {
  readonly type: PickerAttributeType | 'select';
  readonly options: readonly string[];
} {
  const given = texts.map((text) => text.trim()).filter((text) => text !== '');
  const type = suggestType(given.slice(0, 50));
  if (type !== 'text') return { type, options: [] };
  const distinct = new Map<string, string>();
  for (const text of given) {
    const key = text.toLocaleLowerCase();
    if (!distinct.has(key)) distinct.set(key, text.slice(0, 100));
    if (distinct.size > SELECT_SUGGEST_MAX) return { type, options: [] };
  }
  return distinct.size > 0 && distinct.size < given.length
    ? { type: 'select', options: [...distinct.values()] }
    : { type, options: [] };
}

/** A relation column's distinct names across every row, each once ignoring case, as the job will look them up. */
export function columnNames(rows: readonly (readonly string[])[], column: number, isMulti: boolean): readonly string[] {
  const names = new Map<string, string>();
  for (const cells of rows) {
    const text = cellText(cells[column]);
    if (text === '') continue;
    for (const name of relationNames(text, isMulti)) {
      const key = name.toLowerCase();
      if (!names.has(key)) names.set(key, name);
    }
  }
  return [...names.values()];
}
