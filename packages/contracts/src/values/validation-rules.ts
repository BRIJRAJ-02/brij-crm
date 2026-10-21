// Validation rules (spec 0013): the shapes a rule's settings take once
// checked, the rule as the API takes it and gives it back, and the one
// settings check the engine and the settings dialog share. The checker that
// runs the rules lives in `../validation/` with no Zod, so the browser's
// records layer can run it.
import * as z from 'zod';
import { compareDecimal } from '../validation/decimal.ts';
import { RULE_KINDS, RULE_LIMITS, ruleKindFits } from '../validation/kinds.ts';
import type { AttributeType } from './attribute-values.ts';
import { DateValue, DomainValue } from './attribute-values.ts';
import { isCountryCode } from './countries.ts';
import { CURRENCY_CODES } from './currencies.ts';
import { toCanonicalDecimal } from './decimal.ts';
import { FilterGroup, type FilterCondition } from './filters.ts';
import { Uuid, uuidV7 } from './ids.ts';

/** One kind of rule: Required When, a length, a pattern, allowed email domains, phone countries, a range, whole numbers, currencies, a date range, or a count of values. */
export const RuleKind = z.enum(RULE_KINDS);
/** One kind of rule. */
export type RuleKind = z.infer<typeof RuleKind>;

/** The kinds the `rules` input takes: every kind but Required When, which `required` sets (milestone 2). */
export const ListedRuleKind = z.enum([
  'length',
  'pattern',
  'email_domain',
  'phone_country',
  'range',
  'integer',
  'currency_in',
  'date_range',
  'count',
]);
/** A kind the `rules` input takes. */
export type ListedRuleKind = z.infer<typeof ListedRuleKind>;

/** A length rule: at least `min`, at most `max` characters, one or both. */
export const LengthParams = z.object({ min: z.number().int().optional(), max: z.number().int().optional() });
/** A length rule's settings. */
export type LengthParams = z.infer<typeof LengthParams>;

/** A pattern rule: a preset or a custom pattern, matched against the whole value, with or without case. */
export const PatternParams = z.object({
  preset: z.enum(['digits', 'letters', 'letters_digits', 'no_spaces', 'starts_with', 'ends_with', 'custom']),
  /** "Starts with" and "Ends with": the text, matched literally. */
  text: z.string().optional(),
  /** Custom: the pattern, in RE2 syntax. */
  regex: z.string().optional(),
  ignoreCase: z.boolean(),
});
/** A pattern rule's settings. */
export type PatternParams = z.infer<typeof PatternParams>;

/** An email domain rule: addresses only at these domains (`allow`), or never at them (`block`). */
export const EmailDomainParams = z.object({ mode: z.enum(['allow', 'block']), domains: z.array(z.string()) });
/** An email domain rule's settings. */
export type EmailDomainParams = z.infer<typeof EmailDomainParams>;

/** A phone country rule: numbers only from these countries. */
export const PhoneCountryParams = z.object({ countries: z.array(z.string()) });
/** A phone country rule's settings. */
export type PhoneCountryParams = z.infer<typeof PhoneCountryParams>;

/** A range rule: at least `min`, at most `max` (canonical decimals; for currency, the amount). */
export const RangeParams = z.object({ min: z.string().optional(), max: z.string().optional() });
/** A range rule's settings. */
export type RangeParams = z.infer<typeof RangeParams>;

/** A currency rule: amounts only in these currencies. */
export const CurrencyInParams = z.object({ codes: z.array(z.string()) });
/** A currency rule's settings. */
export type CurrencyInParams = z.infer<typeof CurrencyInParams>;

/** A date bound: a fixed day, or a number of days from the day the write runs. */
export const DateBound = z.union([z.object({ date: z.string() }), z.object({ daysFromToday: z.number().int() })]);
/** A date bound. */
export type DateBound = z.infer<typeof DateBound>;

/** A date range rule: on or after `min`, on or before `max`, one or both. */
export const DateRangeParams = z.object({ min: DateBound.optional(), max: DateBound.optional() });
/** A date range rule's settings. */
export type DateRangeParams = z.infer<typeof DateRangeParams>;

/** A count rule: at least `min`, at most `max` values. */
export const CountParams = z.object({ min: z.number().int().optional(), max: z.number().int().optional() });
/** A count rule's settings. */
export type CountParams = z.infer<typeof CountParams>;

/** Each kind's settings, by kind (`RuleParams[kind]`). Whole numbers and Required When take none. */
export const RuleParams = {
  required_when: z.object({}),
  length: LengthParams,
  pattern: PatternParams,
  email_domain: EmailDomainParams,
  phone_country: PhoneCountryParams,
  range: RangeParams,
  integer: z.object({}),
  currency_in: CurrencyInParams,
  date_range: DateRangeParams,
  count: CountParams,
} as const satisfies Record<RuleKind, z.ZodType>;

/**
 * A rule's condition (Only when…): a filter group on the object's own
 * attributes, with no relationship paths, at most 10 conditions and groups
 * nested at most 2 deep (`checkRuleSettings` says so as `CONFIG_INVALID`).
 */
export const RuleCondition = FilterGroup;
/** A rule's condition. */
export type RuleCondition = FilterGroup;

/** A rule's message as sent: plain text, checked to 1 to 200 characters by `checkRuleSettings`. */
const RuleMessage = z.string().max(2000);

/**
 * One rule in an attribute's `rules` input (spec 0013, AC-252): its id (a
 * UUID v7 the browser mints, kept across edits), kind, settings, optional
 * condition and optional message. The list's order is the rules' order.
 * Settings are checked by the engine (`checkRuleSettings`), which answers
 * `CONFIG_INVALID` on the rule's field (`rules.<index>.<setting>`).
 */
export const ValidationRuleInput = z.object({
  id: uuidV7('A rule id must be a UUID v7.'),
  kind: ListedRuleKind,
  params: z.record(z.string().max(32), z.unknown()),
  condition: RuleCondition.optional(),
  message: RuleMessage.optional(),
});
/** One rule in an attribute's `rules` input. */
export type ValidationRuleInput = z.infer<typeof ValidationRuleInput>;

/**
 * How many records don't meet a rule yet (spec 0013, AC-262; counted from
 * milestone 3): the count, up to 20 of them the reader may see, when it was
 * counted, and whether a count is running.
 */
export const RuleBreaking = z.object({
  count: z.number().int().min(0),
  sampleIds: z.array(Uuid),
  countedAt: z.iso.datetime().optional(),
  counting: z.boolean(),
});
/** How many records don't meet a rule yet. */
export type RuleBreaking = z.infer<typeof RuleBreaking>;

/**
 * One rule as an attribute's definition carries it (spec 0013): its id,
 * kind, settings, condition and message, and its place among the
 * attribute's rules. A rule whose condition names an attribute hidden from
 * the reader is left out for them; the server still enforces it.
 */
export const ValidationRuleView = z.object({
  id: Uuid,
  kind: RuleKind,
  params: z.record(z.string(), z.unknown()),
  condition: RuleCondition.optional(),
  message: z.string().optional(),
  position: z.number().int(),
  breaking: RuleBreaking.optional(),
});
/** One rule as an attribute's definition carries it. */
export type ValidationRuleView = z.infer<typeof ValidationRuleView>;

/**
 * An attribute's validation (spec 0013): whether a value is required
 * (never, always, or when a condition holds) and its rules, in order.
 */
export const AttributeValidation = z.object({
  required: z.enum(['never', 'always', 'when']),
  rules: z.array(ValidationRuleView),
});
/** An attribute's validation. */
export type AttributeValidation = z.infer<typeof AttributeValidation>;

/** One problem with a rule's settings: the setting it is about (`min`, `regex`, `condition`, …) and how to fix it. */
export interface RuleSettingsProblem {
  readonly field: string;
  readonly message: string;
}

/** A rule's settings once checked: the canonical settings (decimals canonical, domains lower case, codes upper case). */
export interface CheckedRule {
  readonly kind: RuleKind;
  readonly params: Readonly<Record<string, unknown>>;
  readonly condition?: RuleCondition;
  readonly message?: string;
}

/** An attribute a condition may name, as the settings check needs it. */
export interface ConditionAttribute {
  readonly type: AttributeType;
  readonly isSystem: boolean;
}

/** What the settings check needs besides the rule. */
export interface RuleSettingsContext {
  /** The attribute the rule sits on. */
  readonly attribute: { readonly type: AttributeType; readonly isMulti: boolean };
  /** The object's own attributes, by id: what a condition may name. */
  readonly attributes: ReadonlyMap<string, ConditionAttribute>;
  /**
   * Compiles a pattern with RE2's rules, throwing an error
   * whose message says why it can't be used. Absent, a custom pattern is
   * checked for length only (the server always passes it).
   */
  readonly compile?: (source: string, ignoreCase: boolean) => { readonly size: number };
}

/** The messages the settings check answers with (spec 0013, the settings refusals). */
export const RULE_SETTINGS_WORDS = {
  minOverMax: 'The smallest value must not be above the largest.',
  noBound: 'Give at least a smallest or a largest value.',
  length: (limit: number) => `Use a whole number from 1 to ${limit.toLocaleString('en-GB')}.`,
  textLimit: 'Text holds at most 500 characters.',
  longTextLimit: 'Long text holds at most 10,000 characters.',
  number: 'Enter a number with up to 14 digits before the point and 4 after it, such as 1234.5.',
  rating: 'A rating goes from 1 to 5.',
  count: 'Use a whole number of values from 1 to 100.',
  date: 'Give a real date, such as 2026-10-08.',
  days: 'Keep the offset within 36,500 days either way.',
  preset: 'Pick a pattern.',
  affix: 'Give the text in 1 to 100 characters.',
  patternEmpty: 'Type a pattern.',
  patternLong: 'Keep the pattern to 200 characters.',
  patternLarge: 'That pattern is too large to check quickly. Use fewer repeats.',
  conditionValue: 'Keep each condition’s value under 200 characters.',
  patternBroken: (reason: string) => `That pattern can’t be used: ${reason}.`,
  mode: 'Pick whether to allow or block these domains.',
  domains: 'Add between 1 and 50 domains.',
  domain: (text: string) => `${text} isn’t a domain. Enter one such as example.com.`,
  countries: 'Add between 1 and 50 countries.',
  country: (text: string) => `${text} isn’t a country code, such as GB.`,
  currencies: 'Add between 1 and 20 currencies.',
  currency: (text: string) => `${text} isn’t a currency code, such as USD.`,
  ownAttributes: 'Conditions can only use this object’s own attributes.',
  relationships: 'Conditions can’t name a relationship yet.',
  conditionSize: 'A condition holds at most 10 conditions, nested at most 2 deep.',
  conditionNeeded: 'Add a condition.',
  kind: 'This kind of rule doesn’t fit this attribute’s type.',
  message: 'Keep the message to 200 characters.',
} as const;

const W = RULE_SETTINGS_WORDS;

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The leaves and the deepest group of a condition (the top group is depth 1). */
function sizeOf(group: FilterGroup, depth = 1): { leaves: number; depth: number } {
  return group.conditions.reduce(
    (total, item) => {
      if ('conjunction' in item) {
        const inner = sizeOf(item, depth + 1);
        return { leaves: total.leaves + inner.leaves, depth: Math.max(total.depth, inner.depth) };
      }
      return { leaves: total.leaves + 1, depth: total.depth };
    },
    { leaves: 0, depth },
  );
}

/** Every leaf of a condition. */
function leavesOf(group: FilterGroup): readonly FilterCondition[] {
  return group.conditions.flatMap((item) => ('conjunction' in item ? leavesOf(item) : [item]));
}

/** A whole number bound from `low` to `high`, or a problem. Absent stays absent. */
function wholeBound(value: unknown, low: number, high: number, tooHigh: string, outOfRange: string) {
  if (value === undefined || value === null) return { value: undefined };
  if (typeof value !== 'number' || !Number.isInteger(value) || value < low) return { problem: outOfRange };
  if (value > high) return { problem: tooHigh };
  return { value };
}

type Checked = { readonly params: Record<string, unknown> } | { readonly problems: RuleSettingsProblem[] };

/** Two optional bounds, at least one, the smaller first. */
function bounds<T>(
  min: { value?: T; problem?: string },
  max: { value?: T; problem?: string },
  above: (a: T, b: T) => boolean,
): Checked {
  const problems: RuleSettingsProblem[] = [];
  if (min.problem !== undefined) problems.push({ field: 'min', message: min.problem });
  if (max.problem !== undefined) problems.push({ field: 'max', message: max.problem });
  if (problems.length > 0) return { problems };
  if (min.value === undefined && max.value === undefined) return { problems: [{ field: 'min', message: W.noBound }] };
  if (min.value !== undefined && max.value !== undefined && above(min.value, max.value)) {
    return { problems: [{ field: 'min', message: W.minOverMax }] };
  }
  return {
    params: {
      ...(min.value === undefined ? {} : { min: min.value }),
      ...(max.value === undefined ? {} : { max: max.value }),
    },
  };
}

function decimalBound(value: unknown, isRating: boolean): { value?: string; problem?: string } {
  if (value === undefined || value === null || value === '') return {};
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : undefined;
  const canonical = text === undefined ? undefined : toCanonicalDecimal(text);
  if (canonical === undefined) return { problem: isRating ? W.rating : W.number };
  if (isRating && !(Number.isInteger(Number(canonical)) && Number(canonical) >= 1 && Number(canonical) <= 5)) {
    return { problem: W.rating };
  }
  return { value: canonical };
}

function dateBound(value: unknown): { value?: DateBound; problem?: string } {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) return { problem: W.date };
  if ('daysFromToday' in value) {
    const days = value.daysFromToday;
    if (typeof days !== 'number' || !Number.isInteger(days) || Math.abs(days) > RULE_LIMITS.days) {
      return { problem: W.days };
    }
    return { value: { daysFromToday: days } };
  }
  const parsed = DateValue.safeParse(value.date);
  return parsed.success ? { value: { date: parsed.data } } : { problem: W.date };
}

/** A list of 1 to `limit` codes or domains, each parsed, kept once each in the order given. */
function listOf(
  value: unknown,
  field: string,
  limit: number,
  sizeMessage: string,
  parse: (item: string) => string | undefined,
  itemMessage: (item: string) => string,
): Checked {
  if (!Array.isArray(value) || value.length < 1 || value.length > limit) {
    return { problems: [{ field, message: sizeMessage }] };
  }
  const kept: string[] = [];
  for (const item of value as readonly unknown[]) {
    const text = typeof item === 'string' ? item : '';
    const parsed = parse(text);
    if (parsed === undefined) return { problems: [{ field, message: itemMessage(text.trim() || '""') }] };
    if (!kept.includes(parsed)) kept.push(parsed);
  }
  return { params: { [field]: kept } };
}

function paramsOf(kind: RuleKind, params: Readonly<Record<string, unknown>>, context: RuleSettingsContext): Checked {
  const type = context.attribute.type;
  switch (kind) {
    case 'required_when':
    case 'integer':
      return { params: {} };
    case 'length': {
      const limit = type === 'long_text' ? RULE_LIMITS.longText : RULE_LIMITS.text;
      const tooHigh = type === 'long_text' ? W.longTextLimit : W.textLimit;
      return bounds(
        wholeBound(params.min, 1, limit, tooHigh, W.length(limit)),
        wholeBound(params.max, 1, limit, tooHigh, W.length(limit)),
        (a, b) => a > b,
      );
    }
    case 'count':
      return bounds(
        wholeBound(params.min, 1, RULE_LIMITS.countMax, W.count, W.count),
        wholeBound(params.max, 1, RULE_LIMITS.countMax, W.count, W.count),
        (a, b) => a > b,
      );
    case 'range':
      return bounds(
        decimalBound(params.min, type === 'rating'),
        decimalBound(params.max, type === 'rating'),
        (a, b) => (compareDecimal(a, b) ?? 0) > 0,
      );
    case 'date_range':
      return bounds(dateBound(params.min), dateBound(params.max), (a, b) =>
        'date' in a && 'date' in b
          ? a.date > b.date
          : 'daysFromToday' in a && 'daysFromToday' in b
            ? a.daysFromToday > b.daysFromToday
            : false,
      );
    case 'email_domain': {
      if (params.mode !== 'allow' && params.mode !== 'block') return { problems: [{ field: 'mode', message: W.mode }] };
      const domains = listOf(
        params.domains,
        'domains',
        RULE_LIMITS.listItems,
        W.domains,
        (text) => {
          const parsed = DomainValue.safeParse(text);
          return parsed.success ? parsed.data : undefined;
        },
        W.domain,
      );
      return 'problems' in domains ? domains : { params: { mode: params.mode, ...domains.params } };
    }
    case 'phone_country':
      return listOf(
        params.countries,
        'countries',
        RULE_LIMITS.listItems,
        W.countries,
        (text) => {
          const code = text.trim().toUpperCase();
          return isCountryCode(code) ? code : undefined;
        },
        W.country,
      );
    case 'currency_in':
      return listOf(
        params.codes,
        'codes',
        RULE_LIMITS.currencies,
        W.currencies,
        (text) => {
          const code = text.trim().toUpperCase();
          return (CURRENCY_CODES as readonly string[]).includes(code) ? code : undefined;
        },
        W.currency,
      );
    case 'pattern':
      return patternParams(params, context);
  }
}

function patternParams(params: Readonly<Record<string, unknown>>, context: RuleSettingsContext): Checked {
  const parsed = PatternParams.shape.preset.safeParse(params.preset);
  if (!parsed.success) return { problems: [{ field: 'preset', message: W.preset }] };
  const preset = parsed.data;
  const ignoreCase = params.ignoreCase === true;
  if (preset === 'starts_with' || preset === 'ends_with') {
    const text = typeof params.text === 'string' ? params.text : '';
    if (text.length < 1 || text.length > RULE_LIMITS.affix) return { problems: [{ field: 'text', message: W.affix }] };
    return { params: { preset, text, ignoreCase } };
  }
  if (preset !== 'custom') return { params: { preset, ignoreCase } };
  const regex = typeof params.regex === 'string' ? params.regex : '';
  if (regex.trim() === '') return { problems: [{ field: 'regex', message: W.patternEmpty }] };
  if (regex.length > RULE_LIMITS.pattern) return { problems: [{ field: 'regex', message: W.patternLong }] };
  if (context.compile !== undefined) {
    const compile = context.compile;
    let size: number;
    try {
      size = compile(`^(?:${regex})$`, ignoreCase).size;
    } catch {
      // Compiled alone, so RE2's reason quotes what the person typed rather than the wrapper.
      let reason = '';
      try {
        compile(regex, ignoreCase);
      } catch (error) {
        reason = error instanceof Error ? error.message.replace(/^error parsing regexp:\s*/i, '') : '';
      }
      return {
        problems: [{ field: 'regex', message: W.patternBroken(reason.replace(/\.$/, '') || 'it isn’t valid') }],
      };
    }
    // RE2 matches in time linear in the value, times the program's size: a bounded program keeps every check fast.
    if (size > RULE_LIMITS.patternProgram) return { problems: [{ field: 'regex', message: W.patternLarge }] };
  }
  return { params: { preset, regex, ignoreCase } };
}

function conditionProblems(condition: RuleCondition, context: RuleSettingsContext): RuleSettingsProblem[] {
  const size = sizeOf(condition);
  if (size.leaves > RULE_LIMITS.conditions || size.depth > RULE_LIMITS.depth) {
    return [{ field: 'condition', message: W.conditionSize }];
  }
  const leaves = leavesOf(condition);
  const own = leaves.every((leaf) => {
    if (leaf.operator === 'through') return false;
    const named = context.attributes.get(leaf.attributeId.toLowerCase());
    return named !== undefined && !named.isSystem;
  });
  if (!own) return [{ field: 'condition', message: W.ownAttributes }];
  // A condition's values travel to every reader and into refusals: each is kept small.
  if (leaves.some((leaf) => JSON.stringify(leaf).length > RULE_LIMITS.conditionLeaf)) {
    return [{ field: 'condition', message: W.conditionValue }];
  }
  // A reference's links are never read under the record lock yet (a company's people can number thousands).
  const reference = leaves.some(
    (leaf) =>
      leaf.operator !== 'through' &&
      context.attributes.get(leaf.attributeId.toLowerCase())?.type === 'record_reference',
  );
  return reference ? [{ field: 'condition', message: W.relationships }] : [];
}

/**
 * Checks one rule's settings against the attribute it sits on (spec 0013,
 * AC-253): the kind fits the type, the bounds are in range and in order, a
 * pattern compiles under RE2, domains, countries and currencies parse and
 * number 1 to 50 (currencies 20), a condition names only this object's own
 * attributes (no relationship path, no system attribute) with at most 10
 * conditions nested at most 2 deep, and a message is at most 200
 * characters. Answers the canonical rule, or every problem on its setting.
 */
export function checkRuleSettings(
  rule: {
    readonly kind: RuleKind;
    readonly params?: Readonly<Record<string, unknown>> | undefined;
    readonly condition?: RuleCondition | undefined;
    readonly message?: string | undefined;
  },
  context: RuleSettingsContext,
):
  | { readonly ok: true; readonly rule: CheckedRule }
  | { readonly ok: false; readonly problems: readonly RuleSettingsProblem[] } {
  if (!ruleKindFits(rule.kind, context.attribute)) return { ok: false, problems: [{ field: 'kind', message: W.kind }] };
  const problems: RuleSettingsProblem[] = [];
  const checked = paramsOf(rule.kind, rule.params ?? {}, context);
  if ('problems' in checked) problems.push(...checked.problems);
  if (rule.condition !== undefined && rule.condition.conditions.length > 0) {
    problems.push(...conditionProblems(rule.condition, context));
  } else if (rule.kind === 'required_when') {
    problems.push({ field: 'condition', message: W.conditionNeeded });
  }
  const message = rule.message?.trim() ?? '';
  if (message.length > RULE_LIMITS.message) problems.push({ field: 'message', message: W.message });
  if (problems.length > 0 || 'problems' in checked) return { ok: false, problems };
  return {
    ok: true,
    rule: {
      kind: rule.kind,
      params: checked.params,
      ...(rule.condition === undefined || rule.condition.conditions.length === 0 ? {} : { condition: rule.condition }),
      ...(message === '' ? {} : { message }),
    },
  };
}
