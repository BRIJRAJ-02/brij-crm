// What a condition can read, as the rule editor shows it (spec 0043): a
// form's questions (for Show when only the ones before it), and on a team
// page the person's and their company's fields. Each fact has a kind, which
// decides its comparisons and its value control. Plain functions, no React.
import type { AttributeDefinition, FormQuestion } from '@crm/data';
import { summarizeShowWhen, VALUELESS_OPS, type ConditionOp, type ShowWhen } from '@crm/data/forms';
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
}

/** The comparisons each kind offers, in the order the Select lists them. */
const OPS: Readonly<Record<FactKind, readonly ConditionOp[]>> = {
  choice: ['is', 'is_not', 'is_answered', 'is_empty'],
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

/** The facts a form's questions give: every question but a file one, in order. */
export function questionFacts(questions: readonly FormQuestion[]): readonly Fact[] {
  return questions.flatMap((question): Fact[] => {
    const label = question.label.trim() === '' ? question.key : question.label.trim();
    switch (question.answerType) {
      case 'file':
        return [];
      case 'choice':
      case 'dropdown':
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

/** The facts a team page's rules read: the person's and their company's live fields of a comparable type. */
export function recordFacts(
  person: readonly AttributeDefinition[],
  company: readonly AttributeDefinition[],
): readonly Fact[] {
  const of = (side: 'person' | 'company', attributes: readonly AttributeDefinition[]) =>
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
  return [...of('person', person), ...of('company', company)];
}

/** One line for a set of conditions, naming each fact and a choice's option by name. */
export function conditionsLine(showWhen: ShowWhen, facts: readonly Fact[]): string {
  const factOf = (key: string) => facts.find((fact) => fact.key === key);
  return summarizeShowWhen(
    showWhen,
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
