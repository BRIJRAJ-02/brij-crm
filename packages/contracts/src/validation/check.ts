// The one rule checker (spec 0013): the server runs it under the record lock
// and the browser runs it before it sends a write, so the message a person
// sees first is the one the server would give. Pure: no clock of its own, no
// I/O; the pattern engine (RE2, `re2js`) is passed in.
import type { AttributeType } from '../values/attribute-values.ts';
import type { FilterGroup } from '../values/filters.ts';
import { addDays, todayOf, type RuleClock } from './clock.ts';
import {
  conditionAttributeIds,
  itemsOf,
  matchesCondition,
  type ConditionActor,
  type ConditionAttributeShape,
} from './condition.ts';
import { compareDecimal } from './decimal.ts';
import type { RuleKindName } from './kinds.ts';
import { generatedMessage, HIDDEN_FAILURE, type NamedAttribute } from './messages.ts';
import { patternSourceOf } from './pattern-source.ts';

/** One rule as the checker runs it: what it is on, its kind and settings, its condition and message, and its place. */
export interface ValidationRule {
  readonly id: string;
  readonly attributeId: string;
  readonly kind: RuleKindName;
  readonly params: Readonly<Record<string, unknown>>;
  readonly condition?: FilterGroup | undefined;
  readonly message?: string | undefined;
  readonly position: number;
}

/** An attribute as the checker needs it (spec 0013): its type, title and place, and whether the writer sees it. */
export interface RuleAttribute extends ConditionAttributeShape, NamedAttribute {
  readonly type: AttributeType;
  readonly position: number;
}

/** A compiled pattern: whether a text matches it. */
export interface PatternTest {
  readonly test: (text: string) => boolean;
}

/** Compiles a full pattern (already wrapped as `^(?:…)$`) with RE2's rules. */
export type PatternCompiler = (source: string, ignoreCase: boolean) => PatternTest;

/** One rule a write breaks: the rule, its attribute (absent when hidden from the writer) and the message. */
export interface RuleFailure {
  readonly ruleId: string;
  readonly attributeId?: string;
  readonly message: string;
}

/** What `checkRules` checks. */
export interface CheckRulesInput {
  readonly rules: readonly ValidationRule[];
  /** Every attribute a rule sits on or names, by id (lower case). */
  readonly attributes: ReadonlyMap<string, RuleAttribute>;
  /**
   * The record after the write: current values merged with the write's, by
   * attribute id. A rule needing an attribute missing here is left alone
   * (the browser leaves it to the server); the server always holds them all.
   */
  readonly values: Readonly<Record<string, unknown>>;
  /** The attribute ids the write sets (every attribute on a create). */
  readonly written: ReadonlySet<string>;
  readonly clock: RuleClock;
  /** For "is me". */
  readonly actor?: ConditionActor;
  readonly pattern: PatternCompiler;
}

/** Whether a write touches a rule: it sets the rule's attribute, or an attribute its condition names (AC-255). */
export function touchesRule(rule: ValidationRule, written: ReadonlySet<string>): boolean {
  return (
    written.has(rule.attributeId.toLowerCase()) || conditionAttributeIds(rule.condition).some((id) => written.has(id))
  );
}

/** The attributes a rule reads: its own, then those its condition names. */
export function ruleInputs(rule: ValidationRule): readonly string[] {
  return [rule.attributeId.toLowerCase(), ...conditionAttributeIds(rule.condition)];
}

function numberOf(params: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = params[key];
  return typeof value === 'number' ? value : undefined;
}

function textOf(params: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

function listOf(params: Readonly<Record<string, unknown>>, key: string): readonly string[] {
  const value = params[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

const field = (item: unknown, key: string): unknown =>
  typeof item === 'object' && item !== null ? (item as Readonly<Record<string, unknown>>)[key] : undefined;

/** A date bound as a day: a fixed one, or today in the writer's time zone moved by its days. */
function boundDay(bound: unknown, clock: RuleClock): string | undefined {
  const date = field(bound, 'date');
  if (typeof date === 'string') return date;
  const days = field(bound, 'daysFromToday');
  return typeof days === 'number' ? addDays(todayOf(clock), days) : undefined;
}

/** A text's length in characters (code points), as a person counts them, not UTF-16 units. */
function codePoints(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    // A high surrogate followed by a low one is one character.
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) index += 1;
    }
    count += 1;
  }
  return count;
}

function within(order: (bound: string) => number | undefined, min?: string, max?: string): boolean {
  const low = min === undefined ? 0 : order(min);
  const high = max === undefined ? 0 : order(max);
  if (low === undefined || high === undefined) return true;
  return low >= 0 && high <= 0;
}

/** The first item a rule refuses, or `undefined` when every item passes. Nothing but Required looks at an empty value. */
function failingItem(
  rule: ValidationRule,
  attribute: RuleAttribute,
  value: unknown,
  clock: RuleClock,
  compiled: (rule: ValidationRule) => PatternTest | undefined,
): { readonly item: unknown } | undefined {
  const items = itemsOf(attribute.type, value);
  if (rule.kind === 'required_when') return items.length === 0 ? { item: undefined } : undefined;
  if (items.length === 0) return undefined;
  const params = rule.params;
  if (rule.kind === 'count') {
    const count = items.length;
    const min = numberOf(params, 'min');
    const max = numberOf(params, 'max');
    return (min !== undefined && count < min) || (max !== undefined && count > max) ? { item: value } : undefined;
  }
  const passes = (item: unknown): boolean => {
    switch (rule.kind) {
      case 'length': {
        if (typeof item !== 'string') return true;
        const length = codePoints(item);
        const min = numberOf(params, 'min');
        const max = numberOf(params, 'max');
        return !((min !== undefined && length < min) || (max !== undefined && length > max));
      }
      case 'pattern': {
        if (typeof item !== 'string') return true;
        return compiled(rule)?.test(item) ?? true;
      }
      case 'email_domain': {
        if (typeof item !== 'string') return true;
        const domain = item.slice(item.lastIndexOf('@') + 1).toLowerCase();
        const listed = listOf(params, 'domains').includes(domain);
        return params.mode === 'block' ? !listed : listed;
      }
      case 'phone_country': {
        const country = field(item, 'country');
        return typeof country !== 'string' || listOf(params, 'countries').includes(country.toUpperCase());
      }
      case 'currency_in': {
        const currency = field(item, 'currency');
        return typeof currency !== 'string' || listOf(params, 'codes').includes(currency);
      }
      case 'range': {
        const amount = attribute.type === 'currency' ? field(item, 'amount') : item;
        const text = typeof amount === 'number' ? String(amount) : amount;
        if (typeof text !== 'string') return true;
        return within((bound) => compareDecimal(text, bound), textOf(params, 'min'), textOf(params, 'max'));
      }
      case 'integer':
        return typeof item !== 'string' || !item.includes('.');
      case 'date_range': {
        if (typeof item !== 'string') return true;
        const day = item.slice(0, 10);
        const order = (bound: string) => (day === bound ? 0 : day < bound ? -1 : 1);
        return within(order, boundDay(params.min, clock), boundDay(params.max, clock));
      }
      default:
        return true;
    }
  };
  const failing = items.find((item) => !passes(item));
  return failing === undefined ? undefined : { item: failing };
}

/**
 * Every rule a write touches that it breaks (spec 0013, AC-254, AC-255), in
 * attribute position, then rule position. A rule runs only when the write
 * sets its attribute or an attribute its condition names, and its condition
 * holds; rules other than Required never look at an empty value; one bad
 * item of a list fails the rule. A rule on an archived attribute never runs.
 * A rule needing a value `values` doesn't hold is left out. The message is
 * the rule's own, else the generated one; a rule on an attribute hidden from
 * the writer says only `HIDDEN_FAILURE`, naming nothing. Pure.
 */
export function checkRules(input: CheckRulesInput): readonly RuleFailure[] {
  const cache = new Map<string, PatternTest | undefined>();
  const compiled = (rule: ValidationRule): PatternTest | undefined => {
    const source = patternSourceOf(rule.params);
    if (source === undefined) return undefined;
    const ignoreCase = rule.params.ignoreCase === true;
    const key = `${ignoreCase ? 'i' : 's'}:${source}`;
    if (!cache.has(key)) {
      try {
        cache.set(key, input.pattern(`^(?:${source})$`, ignoreCase));
      } catch {
        // A pattern saved under another engine version that no longer compiles is left to its settings, never a refusal.
        cache.set(key, undefined);
      }
    }
    return cache.get(key);
  };
  const ordered = [...input.rules].sort((a, b) => {
    const left = input.attributes.get(a.attributeId.toLowerCase())?.position ?? 0;
    const right = input.attributes.get(b.attributeId.toLowerCase())?.position ?? 0;
    return left !== right ? left - right : a.position - b.position;
  });
  const failures: RuleFailure[] = [];
  for (const rule of ordered) {
    const attributeId = rule.attributeId.toLowerCase();
    const attribute = input.attributes.get(attributeId);
    if (attribute === undefined || attribute.archived) continue;
    if (!touchesRule(rule, input.written)) continue;
    const held = ruleInputs(rule).every(
      (id) => input.attributes.get(id)?.archived === true || Object.hasOwn(input.values, id),
    );
    if (!held) continue;
    if (
      rule.condition !== undefined &&
      !matchesCondition(rule.condition, {
        values: input.values,
        attributes: input.attributes,
        clock: input.clock,
        ...(input.actor === undefined ? {} : { actor: input.actor }),
      })
    ) {
      continue;
    }
    const failing = failingItem(rule, attribute, input.values[attributeId], input.clock, compiled);
    if (failing === undefined) continue;
    if (!attribute.visible) {
      failures.push({ ruleId: rule.id, message: HIDDEN_FAILURE });
      continue;
    }
    const own = rule.message?.trim();
    failures.push({
      ruleId: rule.id,
      attributeId,
      message:
        own !== undefined && own !== '' ? own : generatedMessage(rule, attribute.title, input.attributes, failing.item),
    });
  }
  return failures;
}
