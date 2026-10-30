# Sentence

One line of a rule read as a sentence: "When [Deal] [Stage] changes to [Won]", with the blanks as small inline controls.

## Why it exists

New (parity #53, Automations). A rule that does something for you reads best as the sentence it means, with each blank a control you can change in place, not a form of labelled fields. ConditionRow lines three equal controls up in columns, which suits a filter, not a sentence whose pieces have different lengths and wrap. This line gives a Select (`variant="inline"`), a small Field and plain words one baseline, one gap and a row's height, and wraps them together. Nothing else of the look is its own.

## Use

```tsx
<Sentence lead="When">
  <Select label="Object" variant="inline" items={objects} value="deal" />
  <Select label="Event" variant="inline" items={events} value="changed" />
</Sentence>
<Sentence lead="Then" end={<Button variant="ghost" icon="x" label="Remove action 2" onPress={remove} />}>
  create a task <Field label="Title" isLabelHidden size="sm" value={title} /> due in …
</Sentence>
```

- Give every control its own label with `isLabelHidden`, so a screen reader names it; the words between them read in order.
- `lead` is "When", "Then" or "Only if". Under 480px of its container the lead sits over the line.
- `end` holds a remove button outside the sentence; leave it out for a line that stays.

## States

Default, with an end control, narrow (the lead above). The controls carry their own states.

## Keyboard

Tab moves through the controls in reading order, then the end control.

## Differences from the artifact

Not in the artifact.
