// Brief
// Purpose: the conditions of a Show when or a routing rule (spec 0043), one per row: what it reads, how it compares, and the value.
// Main task: pick a question or field, a comparison and a value (several for "is any of"); add up to five, joined by all or any.
// Leaves out: what follows a match (the rule's route, set beside it) and checking the rule against the form (publish does).
import { Button, ConditionRow, Field, focusLater, SegmentedControl, Select, SettingsStack } from '@crm/ui';
import { useRef, type Ref } from 'react';
import { CONDITIONS_MAX, type Condition, type ConditionOp, type ShowWhen } from '@crm/data/forms';
import { isValueless, opsFor, valueFor, valuesOf, type Fact } from './facts.ts';
import { strings } from './strings.ts';

/** Props for ConditionsEditor. */
export interface ConditionsEditorProps {
  readonly value: ShowWhen;
  /** What a condition may read, in order. */
  readonly facts: readonly Fact[];
  readonly onChange: (next: ShowWhen) => void;
  readonly isReadOnly?: boolean;
  /** The label of the fact picker ("Question", "Question or field"). */
  readonly factLabel?: string;
  /** The first condition's question picker, for a caller that moves focus to it. */
  readonly firstRef?: Ref<HTMLButtonElement>;
}

/** A new condition on `fact`: its first comparison, with no value yet. */
export function conditionOn(fact: Fact | undefined): Condition {
  const [op = 'is'] = opsFor(fact);
  return { key: fact?.key ?? '', op };
}

/** The conditions, one row each, with the join above them once there are two. */
export function ConditionsEditor({
  value,
  facts,
  onChange,
  isReadOnly = false,
  factLabel = strings.fact,
  firstRef,
}: ConditionsEditorProps) {
  // After a condition is removed, focus goes to Add a condition rather than being lost with its row.
  const addRef = useRef<HTMLButtonElement>(null);
  const replace = (index: number, condition: Condition) =>
    onChange({ ...value, rules: value.rules.map((each, at) => (at === index ? condition : each)) });
  // The visit's hidden fields sit under their own heading, after the questions or fields.
  const factItems = facts.map((fact) => ({
    id: fact.key,
    label: fact.label,
    ...(fact.group === undefined ? {} : { group: fact.group }),
  }));

  return (
    <SettingsStack>
      {value.rules.length > 1 && (
        <SegmentedControl
          label={strings.join}
          segments={[
            { value: 'all', label: strings.joinAll },
            { value: 'any', label: strings.joinAny },
          ]}
          value={value.join}
          isDisabled={isReadOnly}
          onChange={(join) => onChange({ ...value, join: join === 'any' ? 'any' : 'all' })}
        />
      )}
      {value.rules.map((condition, index) => {
        const fact = facts.find((each) => each.key === condition.key);
        const ops = opsFor(fact);
        const text = typeof condition.value === 'string' ? condition.value : (condition.value?.[0] ?? '');
        const options = fact?.options;
        return (
          <ConditionRow
            // A condition has no id of its own; its place is its identity while the list is edited.
            key={index}
            lead={index === 0 ? strings.when : value.join === 'all' ? strings.and : strings.or}
            removeLabel={strings.removeCondition(index)}
            isDisabled={isReadOnly}
            {...(isReadOnly || value.rules.length === 1
              ? {}
              : {
                  onRemove: () => {
                    onChange({ ...value, rules: value.rules.filter((_, at) => at !== index) });
                    focusLater(() => addRef.current);
                  },
                })}
          >
            <Select
              label={factLabel}
              isLabelHidden
              placeholder={strings.pickFact}
              items={factItems}
              value={fact === undefined ? null : condition.key}
              isSearchable={factItems.length > 8}
              {...(index === 0 && firstRef !== undefined ? { triggerRef: firstRef } : {})}
              isReadOnly={isReadOnly}
              onChange={(key) => {
                if (key === null || key === condition.key) return;
                replace(index, conditionOn(facts.find((each) => each.key === key)));
              }}
            />
            <Select
              label={strings.comparison}
              isLabelHidden
              items={ops.map((op) => ({ id: op, label: strings.op(op) }))}
              value={condition.op}
              isReadOnly={isReadOnly}
              onChange={(op) => {
                const next = ops.find((each) => each === op);
                if (next === undefined) return;
                // "is any of" keeps the value as a list, the others as one value, so switching back and forth keeps it.
                const { value: kept, ...rest } = condition;
                const value = valueFor(next, kept);
                replace(index, value === undefined ? { ...rest, op: next } : { ...rest, op: next, value });
              }}
            />
            {isValueless(condition.op) ? null : options !== undefined && condition.op === 'is_any_of' ? (
              <Select
                label={strings.value}
                isLabelHidden
                selectionMode="multiple"
                placeholder={strings.pickValues}
                items={options.map((option) => ({ id: option.id, label: option.label }))}
                values={valuesOf(condition.value).filter((value) => options.some((option) => option.id === value))}
                isReadOnly={isReadOnly}
                onValuesChange={(picked) => {
                  const { value: _replaced, ...rest } = condition;
                  replace(index, picked.length === 0 ? rest : { ...rest, value: [...picked] });
                }}
              />
            ) : options !== undefined ? (
              <Select
                label={strings.value}
                isLabelHidden
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
                label={strings.value}
                isLabelHidden
                // The box sits in a row with no label over it, so it says what it wants (Q65); read only, it holds
                // only what is set.
                {...(isReadOnly ? {} : { placeholder: strings.typeValue })}
                value={text}
                isReadOnly={isReadOnly}
                {...(fact?.kind === 'number' ? { inputMode: 'decimal' as const } : {})}
                onChange={(typed) => replace(index, { ...condition, value: typed })}
              />
            )}
          </ConditionRow>
        );
      })}
      {!isReadOnly && value.rules.length < CONDITIONS_MAX && (
        <Button
          ref={addRef}
          variant="dashed"
          icon="plus"
          onPress={() => onChange({ ...value, rules: [...value.rules, conditionOn(facts[0])] })}
        >
          {strings.addCondition}
        </Button>
      )}
    </SettingsStack>
  );
}

/** The conditions of a new rule or Show when: one, on the first fact. */
export function firstConditions(facts: readonly Fact[], op?: ConditionOp): ShowWhen {
  const condition = conditionOn(facts[0]);
  return { join: 'all', rules: [op === undefined ? condition : { ...condition, op }] };
}
