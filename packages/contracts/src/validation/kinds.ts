// The validation rule kinds (spec 0013), as plain lists with no Zod, so the
// browser's records layer can check a write without loading the schema
// library. `values/validation-rules.ts` builds the schemas from these.
import type { AttributeType } from '../values/attribute-values.ts';

/** Every kind of rule an attribute may hold, in the order "Add rule" offers them (Required When is set apart). */
export const RULE_KINDS = [
  'required_when',
  'length',
  'pattern',
  'email_domain',
  'phone_country',
  'range',
  'integer',
  'currency_in',
  'date_range',
  'count',
] as const;

/** One kind of rule. */
export type RuleKindName = (typeof RULE_KINDS)[number];

/** The types each kind applies to; `count` applies to any attribute that allows several values. */
const KIND_TYPES: Readonly<Record<Exclude<RuleKindName, 'required_when' | 'count'>, readonly AttributeType[]>> = {
  length: ['text', 'long_text'],
  pattern: ['text', 'long_text', 'email', 'url', 'domain'],
  email_domain: ['email'],
  phone_country: ['phone'],
  range: ['number', 'currency', 'rating'],
  integer: ['number'],
  currency_in: ['currency'],
  date_range: ['date'],
};

/** The types a person edits, so Required When may sit on them (spec 0013): every editable type but checkbox. */
const REQUIRABLE: readonly AttributeType[] = [
  'text',
  'long_text',
  'number',
  'currency',
  'date',
  'select',
  'status',
  'rating',
  'email',
  'phone',
  'domain',
  'url',
  'location',
  'personal_name',
  'actor_reference',
  'record_reference',
  'file',
];

/** The types that can hold several values when the attribute allows it (`MULTIPLE_VALUE_TYPES`, repeated without Zod). */
const MULTI_TYPES: readonly AttributeType[] = [
  'select',
  'email',
  'phone',
  'domain',
  'url',
  'actor_reference',
  'record_reference',
  'file',
];

/** Whether a rule of `kind` may sit on an attribute of `type` (spec 0013, the rule kinds table). */
export function ruleKindFits(
  kind: RuleKindName,
  attribute: { readonly type: AttributeType; readonly isMulti: boolean },
) {
  if (kind === 'required_when') return REQUIRABLE.includes(attribute.type);
  if (kind === 'count') return attribute.isMulti && MULTI_TYPES.includes(attribute.type);
  return KIND_TYPES[kind].includes(attribute.type);
}

/** The kinds "Add rule" offers for an attribute, in order: every kind that fits but Required When (set apart, #14 milestone 2). */
export function ruleKindsFor(attribute: {
  readonly type: AttributeType;
  readonly isMulti: boolean;
}): readonly RuleKindName[] {
  return RULE_KINDS.filter((kind) => kind !== 'required_when' && ruleKindFits(kind, attribute));
}

/** The pattern presets' regular expressions (RE2 syntax), each matched against the whole value. */
export const PATTERN_PRESETS = {
  digits: '[0-9]+',
  letters: '[\\p{L} ]+',
  letters_digits: '[\\p{L}\\p{N} ]+',
  no_spaces: '\\S+',
} as const;

/** The bounds rule settings are checked against (spec 0013, AC-253). */
export const RULE_LIMITS = {
  /** A rule's own message. */
  message: 200,
  /** A custom pattern. */
  pattern: 200,
  /** "Starts with" and "Ends with" text. */
  affix: 100,
  /** Domains, or countries, in one rule. */
  listItems: 50,
  /** Currencies in one rule. */
  currencies: 20,
  /** Conditions in one rule's condition. */
  conditions: 10,
  /** How deep a condition's groups nest. */
  depth: 2,
  /** A count rule's bounds. */
  countMax: 100,
  /** A date rule's offsets, in days either way. */
  days: 36_500,
  /** The longest value a text or long text holds, in characters. */
  text: 500,
  longText: 10_000,
} as const;
