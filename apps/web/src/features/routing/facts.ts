// What a condition can read, as the rule editor shows it (spec 0043): a
// form's questions (for Show when only the ones before it), on a team page
// the person's and their company's fields, and in any routing rule the
// visit's hidden fields (UTM tags, page, referrer). Each fact has a kind,
// which decides its comparisons and its value control. Plain functions, no
// React.
import type { AttributeDefinition, FormQuestion } from '@crm/data';
import {
  HIDDEN_FIELDS,
  hiddenFactKey,
  KNOWN_FACT,
  KNOWN_VALUES,
  NUMBER_OPS,
  summarizeShowWhen,
  VALUELESS_OPS,
  type Condition,
  type ConditionOp,
  type ShowWhen,
} from '@crm/data/forms';
import { strings } from './strings.ts';

/** How a fact's value is compared and picked. */
export type FactKind = 'choice' | 'yes_no' | 'number' | 'text';

/** One thing a condition can read. */
export interface Fact {
  /** The condition's key: a question key, or `person.<attributeId>` / `company.<attributeId>`. */
  readonly key: string;
  readonly label: string;
  readonly kind: FactKind;
  /** A choice fact's options: the stored value (a choice's words, or an option's id) and its name. */
  readonly options?: readonly { readonly id: string; readonly label: string }[];
  /** The heading it sits under in the picker, after the facts with none: the visit's hidden fields. */
  readonly group?: string;
  /** A rating's or a scale's lowest and highest answers, so a ready rule can name a real number on it. */
  readonly range?: { readonly from: number; readonly to: number };
}

/** The comparisons each kind offers, in the order the Select lists them. */
const OPS: Readonly<Record<FactKind, readonly ConditionOp[]>> = {
  choice: ['is', 'is_any_of', 'is_not', 'is_answered', 'is_empty'],
  yes_no: ['is'],
  number: ['is', 'more_than', 'less_than', 'is_answered', 'is_empty'],
  text: ['is', 'is_not', 'contains', 'is_answered', 'is_empty'],
};

/** The comparisons a fact offers. */
export function opsFor(fact: Fact | undefined): readonly ConditionOp[] {
  return fact === undefined ? OPS.text : OPS[fact.kind];
}

/** True when a comparison takes no value ("is answered"). */
export function isValueless(op: ConditionOp): boolean {
  return VALUELESS_OPS.includes(op);
}

/** A condition's values as a list: none, one, or the several "is any of" holds. */
export function valuesOf(value: Condition['value']): readonly string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? (value.trim() === '' ? [] : [value]) : value;
}

/**
 * The value a condition keeps when its comparison changes to `op`: none for a comparison that takes none, the
 * values as a list for "is any of", else one value (the first of a list), so switching back and forth keeps it.
 */
export function valueFor(op: ConditionOp, value: Condition['value']): Condition['value'] {
  if (isValueless(op)) return undefined;
  if (op === 'is_any_of') {
    const values = valuesOf(value);
    return values.length === 0 ? undefined : values;
  }
  return typeof value === 'string' || value === undefined ? value : value[0];
}

/**
 * A ready rule for one click (Add logic, Show only if…; the owner, 4 November 2026: "everything complex at a single
 * click"): one condition on the question it most likely reads, complete the moment it appears, so a summary never
 * reads "If How likely … is" with nothing after it. It reads the first question with options among `prefer` (a
 * step's own questions), else a number among them, else the last question with options, else a step's first
 * question, else the last one there is. A choice takes its first option; a rating or a scale "is less than" a
 * number in its lower part (on 0 to 10, less than 7: the 0 to 6 detractors); anything else "is answered", which
 * needs no value.
 */
export function readyConditions(facts: readonly Fact[], prefer: ReadonlySet<string> = new Set()): ShowWhen {
  const hasOptions = (fact: Fact) => (fact.options?.length ?? 0) > 0;
  const preferred = facts.filter((fact) => prefer.has(fact.key));
  // A choice is the likeliest thing to branch on; then a number (a score, a rating); then any question at all.
  const fact =
    preferred.find(hasOptions) ??
    preferred.find((each) => each.kind === 'number') ??
    facts.findLast(hasOptions) ??
    preferred[0] ??
    facts.at(-1);
  return { join: 'all', rules: [{ key: fact?.key ?? '', ...readyCompare(fact) }] };
}

/** The comparison and value a ready rule takes on `fact` (see `readyConditions`). */
function readyCompare(fact: Fact | undefined): { readonly op: ConditionOp; readonly value?: string | string[] } {
  const first = fact?.options?.[0];
  if (first !== undefined) return { op: opsFor(fact)[0] ?? 'is', value: first.id };
  const range = fact?.range;
  if (range !== undefined && range.to > range.from) {
    // The bottom part of the range, about two thirds of the way up: 7 on 0 to 10, 4 on 1 to 5.
    return { op: 'less_than', value: String(range.from + Math.ceil((range.to - range.from) * 0.65)) };
  }
  return { op: 'is_answered' };
}

/** The facts a form's questions give: every question but a file one, in order. */
export function questionFacts(questions: readonly FormQuestion[]): readonly Fact[] {
  return questions.flatMap((question): Fact[] => {
    const label = question.label.trim() === '' ? question.key : question.label.trim();
    switch (question.answerType) {
      // A file, an address, a date and time, a signature and a ranking have nothing a condition compares (spec 0063).
      case 'file':
      case 'address':
      case 'datetime':
      case 'signature':
      case 'ranking':
        return [];
      case 'choice':
      case 'dropdown':
      case 'multi_select':
        return [
          {
            key: question.key,
            label,
            kind: 'choice',
            options: (question.choices ?? [])
              .filter((choice) => choice.trim() !== '')
              .map((choice) => ({ id: choice, label: choice })),
          },
        ];
      case 'yes_no':
      case 'checkbox':
        return [{ key: question.key, label, kind: 'yes_no', options: yesNo() }];
      case 'number':
        return [{ key: question.key, label, kind: 'number' }];
      case 'rating':
        return [{ key: question.key, label, kind: 'number', range: { from: 1, to: 5 } }];
      case 'scale':
        return [
          {
            key: question.key,
            label,
            kind: 'number',
            range: { from: question.options?.from ?? 0, to: question.options?.to ?? 10 },
          },
        ];
      default:
        return [{ key: question.key, label, kind: 'text' }];
    }
  });
}

/** Yes and No, as a yes or no answer compares. */
function yesNo() {
  return [
    { id: 'yes', label: strings.yes },
    { id: 'no', label: strings.no },
  ];
}

/**
 * The facts a team page's rules read: the person's, their company's and (spec 0037, AC-1393) their latest open
 * deal's live fields of a comparable type.
 */
export function recordFacts(
  person: readonly AttributeDefinition[],
  company: readonly AttributeDefinition[],
  deal: readonly AttributeDefinition[] = [],
): readonly Fact[] {
  const of = (side: 'person' | 'company' | 'deal', attributes: readonly AttributeDefinition[]) =>
    attributes.flatMap((attribute): Fact[] => {
      if (attribute.isArchived) return [];
      const key = `${side}.${attribute.id}`;
      const label = strings.fieldOf(side, attribute.title);
      switch (attribute.type) {
        case 'select':
        case 'status':
          return [
            {
              key,
              label,
              kind: 'choice',
              options: (attribute.options ?? [])
                .filter((option) => !option.isArchived)
                .map((option) => ({ id: option.id, label: option.label })),
            },
          ];
        case 'checkbox':
          return [{ key, label, kind: 'yes_no', options: yesNo() }];
        case 'number':
        case 'currency':
        case 'rating':
          return [{ key, label, kind: 'number' }];
        case 'text':
          return [{ key, label, kind: 'text' }];
        default:
          return [];
      }
    });
  return [...of('person', person), ...of('company', company), ...of('deal', deal)];
}

/** Known (spec 0037, AC-1393): New, Known person, Known company, and Customer once Won means is set. */
export function knownFact(wonMeansSet: boolean): Fact {
  return {
    key: KNOWN_FACT,
    label: strings.known,
    kind: 'choice',
    options: KNOWN_VALUES.filter((value) => wonMeansSet || value !== 'customer').map((value) => ({
      id: value,
      label: strings.knownValue[value],
    })),
  };
}

/**
 * The facts the visit's hidden fields give a routing rule: its UTM tags, the page it was on and the referrer, read
 * as text. A team page reads them from the form that sent the visitor there, so there each name says so.
 */
export function hiddenFieldFacts(surface: 'form' | 'page'): readonly Fact[] {
  return HIDDEN_FIELDS.map((field) => ({
    key: hiddenFactKey(field),
    label: surface === 'page' ? strings.fromForm(strings.hiddenField(field)) : strings.hiddenField(field),
    kind: 'text' as const,
    group: surface === 'page' ? strings.hiddenFieldsFromForm : strings.hiddenFields,
  }));
}

/**
 * One line for a set of conditions, naming each fact and a choice's option by name. A condition still being written
 * (no question, or no value where its comparison needs one) is left out, so a line never ends on a bare "is"; with
 * none complete there is no line at all (undefined), and the caller shows nothing.
 */
export function conditionsLine(showWhen: ShowWhen, facts: readonly Fact[]): string | undefined {
  const factOf = (key: string) => facts.find((fact) => fact.key === key);
  const rules = showWhen.rules.filter((condition) => isComplete({ join: showWhen.join, rules: [condition] }));
  if (rules.length === 0) return undefined;
  return summarizeShowWhen(
    { ...showWhen, rules },
    (key) => factOf(key)?.label ?? strings.removedQuestion,
    (key, value) => factOf(key)?.options?.find((option) => option.id === value)?.label ?? value,
  );
}

/** The conditions that are filled in enough to keep: a fact, and a value unless the comparison takes none. */
export function isComplete(showWhen: ShowWhen): boolean {
  return showWhen.rules.every(
    (condition) =>
      condition.key !== '' &&
      (isValueless(condition.op) ||
        (typeof condition.value === 'string' ? condition.value.trim() !== '' : (condition.value?.length ?? 0) > 0)),
  );
}

/**
 * Whether conditions can be saved as they stand: every one complete (`isComplete`), and a number comparison's value a
 * number. Anything less is a rule still being written, which the builder keeps as a local draft rather than sending
 * a save the server refuses ("Give a value to compare with.").
 */
export function isSavable(showWhen: ShowWhen): boolean {
  return (
    isComplete(showWhen) &&
    showWhen.rules.every(
      (condition) =>
        !NUMBER_OPS.includes(condition.op) ||
        (typeof condition.value === 'string' &&
          condition.value.trim() !== '' &&
          Number.isFinite(Number(condition.value.replaceAll(',', '')))),
    )
  );
}

/** A Show when as a document stores it: plain arrays, each value copied. */
export function storedShowWhen(showWhen: ShowWhen): {
  join: 'all' | 'any';
  rules: { key: string; op: ConditionOp; value?: string | string[] }[];
} {
  return {
    join: showWhen.join,
    rules: showWhen.rules.map((condition) => ({
      key: condition.key,
      op: condition.op,
      ...(condition.value === undefined || isValueless(condition.op)
        ? {}
        : { value: typeof condition.value === 'string' ? condition.value.trim() : [...condition.value] }),
    })),
  };
}

/**
 * What a team page's rules read (spec 0037, AC-1352): the page's own questions first (by key, as a form's), then
 * Known and the person's, company's and deal's fields once read (spec 0037, AC-1393).
 */
export function pageFacts(
  questions: readonly FormQuestion[],
  fields:
    | {
        readonly person: readonly AttributeDefinition[];
        readonly company: readonly AttributeDefinition[];
        readonly deal?: readonly AttributeDefinition[];
        readonly wonMeansSet?: boolean;
      }
    | undefined,
): readonly Fact[] {
  return [
    ...questionFacts(questions),
    ...(fields === undefined
      ? []
      : [knownFact(fields.wonMeansSet === true), ...recordFacts(fields.person, fields.company, fields.deal)]),
  ];
}
