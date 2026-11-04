// Brief
// Purpose: a rule's conditions read as a sentence (T39, T41: "explicit and smart"), "If Budget is Under $1k", each
// blank a small inline control, as the Automations dialog writes its rules.
// Main task: change what a rule reads, how it compares and the value, picked from the question's real choices.
// Leaves out: what follows a match (the caller's `then`, on the last line) and where the rule lives.
import { Button, Field, Select, Sentence } from '@crm/ui';
import type { ReactNode, Ref } from 'react';
import { CONDITIONS_MAX, type Condition, type ShowWhen } from '@crm/data/forms';
import { conditionOn } from './ConditionsEditor.tsx';
import { isValueless, opsFor, valueFor, valuesOf, type Fact } from './facts.ts';
import { strings } from './strings.ts';

/** Props for ConditionLines. */
export interface ConditionLinesProps {
  readonly value: ShowWhen;
  /** What a condition may read, in order. */
  readonly facts: readonly Fact[];
  readonly onChange: (next: ShowWhen) => void;
  readonly isReadOnly?: boolean;
  /** The first line's lead word: "If". */
  readonly lead?: string;
  /** At the first line's end, outside the sentence: the rule's ⋯. */
  readonly end?: ReactNode;
  /** After the last condition, on its line: "→ [destination]". */
  readonly then?: ReactNode;
  /** The first condition's question picker, for a caller that moves focus to it. */
  readonly firstRef?: Ref<HTMLButtonElement>;
  /** Names each line's controls apart where several rules share a screen ("rule 2"). */
  readonly name?: string;
}

/** The conditions with one more, on the first fact: "and …". */
export function withCondition(value: ShowWhen, facts: readonly Fact[]): ShowWhen {
  if (value.rules.length >= CONDITIONS_MAX) return value;
  return { ...value, rules: [...value.rules, conditionOn(facts[0])] };
}

/**
 * The conditions as lines of a sentence: "If [Budget] [is] [Under $1k]", then "[and] [Team] [is] [2 to 5]", the join
 * an inline choice at the start of the second line, and `then` closing the last line. The value control follows the
 * question: its choices for a choice or a yes or no, a number box for a number, a short box for text, never a blank
 * "Set value…".
 */
export function ConditionLines({
  value,
  facts,
  onChange,
  isReadOnly = false,
  lead = strings.ifWord,
  end,
  then,
  firstRef,
  name,
}: ConditionLinesProps) {
  const replace = (index: number, condition: Condition) =>
    onChange({ ...value, rules: value.rules.map((each, at) => (at === index ? condition : each)) });
  const factItems = facts.map((fact) => ({
    id: fact.key,
    label: fact.label,
    ...(fact.group === undefined ? {} : { group: fact.group }),
  }));
  const named = (label: string, index: number) =>
    [label, name, value.rules.length > 1 ? strings.conditionPlace(index) : undefined]
      .filter((part) => part !== undefined)
      .join(', ');
  const last = value.rules.length - 1;

  return (
    <>
      {value.rules.map((condition, index) => {
        const fact = facts.find((each) => each.key === condition.key);
        const ops = opsFor(fact);
        const text = typeof condition.value === 'string' ? condition.value : (condition.value?.[0] ?? '');
        const options = fact?.options;
        const remove =
          isReadOnly || value.rules.length === 1 || index === 0 ? undefined : (
            <Button
              variant="ghost"
              icon="x"
              label={strings.removeCondition(index)}
              onPress={() => {
                onChange({ ...value, rules: value.rules.filter((_, at) => at !== index) });
              }}
            />
          );
        return (
          <Sentence
            // A condition has no id of its own; its place is its identity while the list is edited.
            key={index}
            lead={index === 0 ? lead : ''}
            end={index === 0 ? end : remove}
          >
            {index > 0 && (
              <Select
                label={named(strings.join, index)}
                isLabelHidden
                variant="inline"
                items={[
                  { id: 'all', label: strings.and },
                  { id: 'any', label: strings.or },
                ]}
                value={value.join}
                isReadOnly={isReadOnly}
                onChange={(join) => {
                  if (join === 'all' || join === 'any') onChange({ ...value, join });
                }}
              />
            )}
            <Select
              label={named(strings.question, index)}
              isLabelHidden
              variant="inline"
              placeholder={strings.pickFact}
              items={factItems}
              value={fact === undefined ? null : condition.key}
              isSearchable={factItems.length > 8}
              {...(index === 0 && firstRef !== undefined ? { triggerRef: firstRef } : {})}
              isReadOnly={isReadOnly}
              onChange={(key) => {
                if (key === null || key === condition.key) return;
                const next = facts.find((each) => each.key === key);
                const made = conditionOn(next);
                const first = next?.options?.[0];
                // A question with choices comes with its first one picked, so the line is whole at once.
                replace(index, first === undefined || isValueless(made.op) ? made : { ...made, value: first.id });
              }}
            />
            <Select
              label={named(strings.comparison, index)}
              isLabelHidden
              variant="inline"
              items={ops.map((op) => ({ id: op, label: strings.op(op) }))}
              value={condition.op}
              isReadOnly={isReadOnly}
              onChange={(op) => {
                const next = ops.find((each) => each === op);
                if (next === undefined) return;
                const { value: kept, ...rest } = condition;
                const value = valueFor(next, kept);
                replace(index, value === undefined ? { ...rest, op: next } : { ...rest, op: next, value });
              }}
            />
            {isValueless(condition.op) ? null : options !== undefined && condition.op === 'is_any_of' ? (
              <Select
                label={named(strings.value, index)}
                isLabelHidden
                variant="inline"
                selectionMode="multiple"
                placeholder={strings.pickValues}
                items={options.map((option) => ({ id: option.id, label: option.label }))}
                values={valuesOf(condition.value).filter((each) => options.some((option) => option.id === each))}
                isReadOnly={isReadOnly}
                onValuesChange={(picked) => {
                  const { value: _replaced, ...rest } = condition;
                  replace(index, picked.length === 0 ? rest : { ...rest, value: [...picked] });
                }}
              />
            ) : options !== undefined ? (
              <Select
                label={named(strings.value, index)}
                isLabelHidden
                variant="inline"
                placeholder={strings.pickValue}
                items={options.map((option) => ({ id: option.id, label: option.label }))}
                value={options.some((option) => option.id === text) ? text : null}
                isReadOnly={isReadOnly}
                onChange={(picked) => {
                  if (picked !== null) replace(index, { ...condition, value: picked });
                }}
              />
            ) : (
              <Field
                label={named(strings.value, index)}
                isLabelHidden
                size="sm"
                {...(isReadOnly ? {} : { placeholder: fact?.kind === 'number' ? strings.aNumber : strings.anAnswer })}
                value={text}
                isReadOnly={isReadOnly}
                {...(fact?.kind === 'number' ? { inputMode: 'decimal' as const } : {})}
                onChange={(typed) => {
                  replace(index, { ...condition, value: typed });
                }}
              />
            )}
            {index === last && then}
          </Sentence>
        );
      })}
    </>
  );
}
