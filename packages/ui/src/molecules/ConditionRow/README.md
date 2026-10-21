# ConditionRow

One condition of a rule as a row: a muted lead word ("When", "and", "or"), the condition's controls side by side, and a remove button at the end. Used by a form question's Show when and by routing rules (spec 0043).

## Why it exists

New. A condition is three controls that read as one sentence ("Budget · is · Large"). Stacking three labelled fields per condition made a rule with five conditions a long column, and FilterBuilder works on a view's attributes and nested groups, with its own field editors, which a form's questions and a routing rule don't have. A row that lines up the controls and a remove button is all this needs; the controls are the library's Select and Field, unchanged.

## Use

```tsx
<ConditionRow lead="When" removeLabel="Remove condition 1" onRemove={remove}>
  <Select label="Question" isLabelHidden items={questions} value={key} onChange={setKey} />
  <Select label="Comparison" isLabelHidden items={operators} value={op} onChange={setOp} />
  <Field label="Value" isLabelHidden value={value} onChange={setValue} />
</ConditionRow>
```

- Give each control its own label with `isLabelHidden`, so a screen reader names it.
- Leave out `onRemove` on a list's only row, or when the rule is read only.
- Under 480px of its container the controls stack under the lead word.

## States

Default, with no remove button, disabled (the remove button), narrow (stacked). The controls carry their own states.

## Keyboard

Tab moves through the controls, then the remove button.
