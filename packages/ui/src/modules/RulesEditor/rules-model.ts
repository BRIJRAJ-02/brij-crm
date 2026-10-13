// What RulesEditor edits (spec 0013): a rule's settings as typed (bounds and
// lists as text, switches as booleans), turned into the settings the API
// takes, and back. Pure, so a dialog can check and send them.
import type { FilterGroup } from '@crm/contracts/values';
import type { RuleKindName } from '@crm/contracts/validation';

/** The kinds a rule list holds: every kind but Required When, which Required sets (spec 0013, milestone 2). */
export type ListedKind = Exclude<RuleKindName, 'required_when'>;

/** One rule as RulesEditor holds it while it is edited. */
export interface RulesEditorRule {
  /** A UUID v7 the screen mints, kept across edits. */
  readonly id: string;
  readonly kind: ListedKind;
  /** Each setting as typed, by the name the API gives it (`min`, `regex`, `domains`), switches as booleans. */
  readonly fields: Readonly<Record<string, string | boolean>>;
  /** Only when…: a condition on the object's own attributes, or none. */
  readonly condition?: FilterGroup;
  /** The rule's own message; empty for the generated one. */
  readonly message: string;
}

/** A rule as the API takes it and the server gives it back: its settings in their own shapes. */
export interface RuleSettings {
  readonly id: string;
  readonly kind: ListedKind;
  readonly params: Readonly<Record<string, unknown>>;
  readonly condition?: FilterGroup | undefined;
  readonly message?: string | undefined;
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

const listText = (value: unknown): string =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').join(', ') : '';

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>)[key] : undefined;

/** A date bound as fields: its kind (none, a date, days from today) and what was typed. */
function boundFields(bound: unknown, name: 'min' | 'max'): Record<string, string> {
  const date = field(bound, 'date');
  if (typeof date === 'string') return { [`${name}Kind`]: 'date', [name]: date };
  const days = field(bound, 'daysFromToday');
  if (typeof days === 'number') return { [`${name}Kind`]: 'days', [name]: String(days) };
  return { [`${name}Kind`]: 'none', [name]: '' };
}

/** A rule from the server (or a new one's defaults) as the editor holds it. */
export function editorRuleOf(rule: RuleSettings): RulesEditorRule {
  const { params } = rule;
  const fields = ((): Record<string, string | boolean> => {
    switch (rule.kind) {
      case 'length':
      case 'count':
      case 'range':
        return { min: text(params.min), max: text(params.max) };
      case 'pattern':
        return {
          // A new rule picks no preset: "Pick a pattern." until one is chosen, so nothing is refused by surprise.
          preset: text(params.preset),
          text: text(params.text),
          regex: text(params.regex),
          ignoreCase: params.ignoreCase === true,
        };
      case 'email_domain':
        return { mode: params.mode === 'block' ? 'block' : 'allow', domains: listText(params.domains) };
      case 'phone_country':
        return { countries: listText(params.countries) };
      case 'currency_in':
        return { codes: listText(params.codes) };
      case 'date_range':
        return { ...boundFields(params.min, 'min'), ...boundFields(params.max, 'max') };
      case 'integer':
        return {};
    }
  })();
  return {
    id: rule.id,
    kind: rule.kind,
    fields,
    ...(rule.condition === undefined ? {} : { condition: rule.condition }),
    message: rule.message ?? '',
  };
}

/** A new rule of `kind`, with nothing typed yet (a pattern with no format chosen, an email rule at allow). */
export function newRule(kind: ListedKind, id: string): RulesEditorRule {
  return editorRuleOf({ id, kind, params: {} });
}

const fieldText = (rule: RulesEditorRule, name: string): string => {
  const value = rule.fields[name];
  return typeof value === 'string' ? value.trim() : '';
};

/** A whole number typed as digits (a sign allowed), else the text as typed, so the server's check words it. */
function whole(value: string): number | string | undefined {
  if (value === '') return undefined;
  return /^-?\d{1,6}$/.test(value) ? Number(value) : value;
}

/** A comma separated list as its items, trimmed, empty ones left out. */
function listOf(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function dateBound(rule: RulesEditorRule, name: 'min' | 'max'): unknown {
  const kind = fieldText(rule, `${name}Kind`);
  const value = fieldText(rule, name);
  if (kind === 'date') return value === '' ? undefined : { date: value };
  if (kind === 'days') {
    const days = whole(value);
    return days === undefined ? undefined : { daysFromToday: days };
  }
  return undefined;
}

/** Drops the settings that are absent, so a bound left empty isn't sent. */
function present(params: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
}

/** A rule as the editor holds it, as the API takes it: bounds as numbers or decimals, lists split, empty ones left out. */
export function ruleOf(rule: RulesEditorRule): RuleSettings {
  const params = (() => {
    switch (rule.kind) {
      case 'length':
      case 'count':
        return present({ min: whole(fieldText(rule, 'min')), max: whole(fieldText(rule, 'max')) });
      case 'range': {
        const min = fieldText(rule, 'min');
        const max = fieldText(rule, 'max');
        return present({ min: min === '' ? undefined : min, max: max === '' ? undefined : max });
      }
      case 'pattern': {
        const preset = fieldText(rule, 'preset');
        return present({
          preset,
          ...(preset === 'starts_with' || preset === 'ends_with'
            ? { text: typeof rule.fields.text === 'string' ? rule.fields.text : '' }
            : {}),
          ...(preset === 'custom' ? { regex: typeof rule.fields.regex === 'string' ? rule.fields.regex : '' } : {}),
          ignoreCase: rule.fields.ignoreCase === true,
        });
      }
      case 'email_domain':
        return {
          mode: fieldText(rule, 'mode') === 'block' ? 'block' : 'allow',
          domains: listOf(fieldText(rule, 'domains')),
        };
      case 'phone_country':
        return { countries: listOf(fieldText(rule, 'countries')) };
      case 'currency_in':
        return { codes: listOf(fieldText(rule, 'codes')) };
      case 'date_range':
        return present({ min: dateBound(rule, 'min'), max: dateBound(rule, 'max') });
      case 'integer':
        return {};
    }
  })();
  const message = rule.message.trim();
  return {
    id: rule.id,
    kind: rule.kind,
    params,
    ...(rule.condition === undefined || rule.condition.conditions.length === 0 ? {} : { condition: rule.condition }),
    ...(message === '' ? {} : { message }),
  };
}
