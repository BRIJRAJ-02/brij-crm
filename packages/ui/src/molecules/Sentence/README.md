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
- Leave `lead` out for a line with no lead word, such as where everyone else goes ("Otherwise → Step 3", "Everyone else sees [Thank you page]"): the lead column goes and the words start at the line's edge, so on a phone they line up with the card's other lines instead of sitting behind an empty column (critique 9, 5 November 2026). Why a variant: an empty lead kept the column, which is right for a rule's second condition under its "If" (pass `""` there) and wrong for a line that stands alone. Story: `NoLead`.
- `end` holds a remove button outside the sentence; leave it out for a line that stays.

## States

Default, with an end control, with no lead, narrow (the lead above). The controls carry their own states.

## Keyboard

Tab moves through the controls in reading order, then the end control.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Takes its look from the prototype's Sentence: the lead word in `text-body-strong` and `text-secondary`, at the end of a fixed column (a large control and `space-20`), level with a small control's line; the words and controls in the body type, `space-4` apart, wrapping together; the line padded `space-4` above and below. The end control (a remove) waits for the line's hover or focus with a pointer and always shows under a finger. Under 480px of its container the lead sits over the line.

**Use it for** a rule read as a sentence (a view filter written out, an automation's trigger, a form question's Show when). **Don't use it for** a table's quick filter chips or a formula.

**Differences from the prototype**: the library's Sentence is the line only: the controls are the caller's own Selects and Fields (with hidden labels), not the prototype's attribute, comparison and value pills, and there is no and/or toggle or add and remove motion (the prototype's ConditionRow is phase 2's). `lead` left out drops the column.
