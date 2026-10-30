// What the attribute type picker offers and how new options start (spec 0012,
// AC-228, AC-230, AC-236). Plain TypeScript with no Zod, so the browser's
// dialogs share these with the server.
import { HUES } from './hue-list.ts';

/** One of the data hues. */
type HueName = (typeof HUES)[number];

/** One entry of the type picker: the attribute type it makes, whether it holds several, and whether it offers "Allow multiple". */
export interface PickerType {
  /** The entry's own key (`multi_select` and `link` differ from their types). */
  readonly key: string;
  readonly type:
    | 'text'
    | 'long_text'
    | 'number'
    | 'currency'
    | 'date'
    | 'checkbox'
    | 'select'
    | 'status'
    | 'rating'
    | 'email'
    | 'phone'
    | 'url'
    | 'location'
    | 'actor_reference'
    | 'file';
  /** Multi select: a select that holds several. */
  readonly isMulti: boolean;
  /** Shows "Allow multiple" (Member, Email, Phone). */
  readonly allowsMultiple: boolean;
  /** Shows "Unique" (AC-229): the engine's unique types the picker offers (text, number, email, phone, link). */
  readonly allowsUnique: boolean;
}

/**
 * The sixteen types the picker offers, in this order (AC-228, widened from
 * fifteen when record files arrived, 27 Oct 2026). Multi select is a select
 * with `isMulti`; Member is `actor_reference`; Link is `url`. Domain,
 * personal name, timestamp, interaction and record reference are not offered
 * (#15 adds Relationship through its own entry).
 */
export const PICKER_TYPES: readonly PickerType[] = [
  { key: 'text', type: 'text', isMulti: false, allowsMultiple: false, allowsUnique: true },
  { key: 'long_text', type: 'long_text', isMulti: false, allowsMultiple: false, allowsUnique: false },
  { key: 'number', type: 'number', isMulti: false, allowsMultiple: false, allowsUnique: true },
  { key: 'currency', type: 'currency', isMulti: false, allowsMultiple: false, allowsUnique: false },
  { key: 'date', type: 'date', isMulti: false, allowsMultiple: false, allowsUnique: false },
  { key: 'checkbox', type: 'checkbox', isMulti: false, allowsMultiple: false, allowsUnique: false },
  { key: 'select', type: 'select', isMulti: false, allowsMultiple: false, allowsUnique: false },
  { key: 'multi_select', type: 'select', isMulti: true, allowsMultiple: false, allowsUnique: false },
  { key: 'status', type: 'status', isMulti: false, allowsMultiple: false, allowsUnique: false },
  { key: 'rating', type: 'rating', isMulti: false, allowsMultiple: false, allowsUnique: false },
  { key: 'email', type: 'email', isMulti: false, allowsMultiple: true, allowsUnique: true },
  { key: 'phone', type: 'phone', isMulti: false, allowsMultiple: true, allowsUnique: true },
  { key: 'link', type: 'url', isMulti: false, allowsMultiple: false, allowsUnique: true },
  { key: 'location', type: 'location', isMulti: false, allowsMultiple: false, allowsUnique: false },
  { key: 'member', type: 'actor_reference', isMulti: false, allowsMultiple: true, allowsUnique: false },
  { key: 'file', type: 'file', isMulti: false, allowsMultiple: false, allowsUnique: false },
];

/** What a status stage means: still open, won or lost. */
export type StageOutcome = 'open' | 'won' | 'lost';

/** One stage a new status attribute starts with. */
export interface StarterStage {
  readonly label: string;
  readonly hue: HueName;
  readonly outcome: StageOutcome;
}

/** The three stages a new status attribute starts with, editable before it is created (AC-230). */
export const STARTER_STAGES: readonly StarterStage[] = [
  { label: 'Not started', hue: 'gray', outcome: 'open' },
  { label: 'In progress', hue: 'blue', outcome: 'open' },
  { label: 'Done', hue: 'green', outcome: 'won' },
];

/**
 * The hue a new option takes (AC-236): the one after the last option's in
 * `HUES` order, cycling back to the first; `gray` for the first option.
 */
export function nextHue(options: readonly { readonly hue: string }[]): HueName {
  const last = options.at(-1);
  if (last === undefined) return 'gray';
  const at = (HUES as readonly string[]).indexOf(last.hue);
  return HUES[(at + 1) % HUES.length] ?? 'gray';
}

/**
 * The hue a new object takes in the new object dialog (spec 0012, value
 * sourcing): the first in `HUES` order no live object uses, else `gray`.
 */
export function freeHue(taken: readonly { readonly hue: string }[]): HueName {
  const used = new Set(taken.map((each) => each.hue));
  return HUES.find((hue) => !used.has(hue)) ?? 'gray';
}

/**
 * The picker entry an attribute was made from (spec 0012, AC-231): Multi
 * select for a select holding several, else the entry of its type. None for
 * a type the picker doesn't offer (a relationship, a system type).
 */
export function pickerTypeOf(type: string, isMulti: boolean): PickerType | undefined {
  if (type === 'select') return PICKER_TYPES.find((entry) => entry.key === (isMulti ? 'multi_select' : 'select'));
  return PICKER_TYPES.find((entry) => entry.type === type);
}

// The type an attribute's name suggests, and the options a guessed select or status starts with (flow pass,
// 30 October 2026): the new object dialog's rows and the attribute dialog's Type follow the name until the person
// picks a type.

/** A type a name may suggest: the picker's types but File (a name never says "file" reliably). */
export type GuessedType = Exclude<PickerType['type'], 'file'>;

/** Words in an attribute's name, and the type each suggests; the first match wins. */
const TYPE_WORDS: readonly (readonly [RegExp, GuessedType])[] = [
  [/\be-?mail/, 'email'],
  [/\b(phone|mobile|cell|fax|whatsapp)/, 'phone'],
  [/\b(website|url|link|linkedin|twitter|domain|site|web)\b/, 'url'],
  [/^(stage|status|pipeline stage|deal stage)$/, 'status'],
  [/^(priority|severity|tier|category|type|kind|segment|industry|source)$/, 'select'],
  [/^(owner|assignee|assigned to|account owner|manager|rep|lead owner)$/, 'actor_reference'],
  [/\b(amount|price|cost|fee|revenue|budget|salary|value|total|balance|spend|mrr|arr)\b/, 'currency'],
  [/\b(quantity|qty|count|number|age|hours|score|units|size|weight|seats|year|bedrooms|capacity)\b/, 'number'],
  [/\b(date|deadline|due|birthday|birth|start|end|created|renewal|expires|expiry|closed)\b/, 'date'],
  [/\b(address|city|country|location|region|state)\b/, 'location'],
  [/\b(rating|stars)\b/, 'rating'],
  [/^(is|has|can|active|paid|done|verified|approved)\b|\?$/, 'checkbox'],
  [/\b(notes?|description|details|summary|comments?|bio|about|message|body)\b/, 'long_text'],
];

/** The type a name suggests ("Email" is email, "Due date" is date, "Stage" is status), plain text when none does. */
export function typeFor(name: string): GuessedType {
  const lower = name.trim().toLowerCase();
  return TYPE_WORDS.find(([pattern]) => pattern.test(lower))?.[1] ?? 'text';
}

/** One option a guessed select or status starts with. */
export interface StarterOption {
  readonly label: string;
  readonly hue: HueName;
  readonly outcome?: StageOutcome;
}

/** A priority's three levels, the one select whose options a name gives away. */
const PRIORITY: readonly StarterOption[] = [
  { label: 'Low', hue: 'gray' },
  { label: 'Medium', hue: 'yellow' },
  { label: 'High', hue: 'red' },
];

/**
 * The options a new attribute starts with when made without the dialog's options editor (the new object dialog's
 * rows): a status its starter stages, a select named Priority its three levels, anything else none.
 */
export function starterOptionsFor(title: string, type: string): readonly StarterOption[] {
  if (type === 'status') return STARTER_STAGES;
  if (type === 'select' && /^priority$/i.test(title.trim())) return PRIORITY;
  return [];
}
