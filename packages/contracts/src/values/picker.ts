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
    | 'actor_reference';
  /** Multi select: a select that holds several. */
  readonly isMulti: boolean;
  /** Shows "Allow multiple" (Member, Email, Phone). */
  readonly allowsMultiple: boolean;
  /** Shows "Unique" (AC-229): the engine's unique types the picker offers (text, number, email, phone, link). */
  readonly allowsUnique: boolean;
}

/**
 * The fifteen types the picker offers, in this order (AC-228). Multi select is
 * a select with `isMulti`; Member is `actor_reference`; Link is `url`. Domain,
 * personal name, timestamp, interaction, file and record reference are not
 * offered (#15 adds Relationship through its own entry).
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
