# FieldLabel

The one label row of every form control: Field, Select and RadioGroup, and FieldGroup's label over read only content.

## Why it exists

New, by extraction. Field, Select and RadioGroup each drew the same row (the label, an "(optional)" aside, and an InfoTip beside it) with three copies of the markup and the CSS (the tips lane, 21 October 2026). One row means a change to the label's look or the tip's spacing happens once. It is not a new look: it is the look the three already shared.

## Use

```tsx
<FieldLabel label="Domain" aside="(optional)" info={<InfoTip label="Domain">…</InfoTip>} />
```

- `id` names the label, so a group can point `aria-labelledby` at it (FieldGroup, 22 October 2026, which had its own copy of this style).
- `tone="heading"` heads a section of labelled values (FieldGroup's `heading` tone, a form submission's Answers): the body size, medium, in `text`, a clear step above the label size terms under it. Why a tone: the strong label sat at the same size and colour as those terms and read as one more of them (22 October 2026).
- `tone="strong"` for a group's question (RadioGroup); `label` otherwise.
- `as="text"` for a read only control with nothing to label (a read only Select names its group with `aria-label`).
- `isDisabled` fades it with the control.
- `onInfoKeyDown` lets a radio group keep its arrow keys from moving the choice while focus is in the tip.

## States

Plain, with an aside, with an InfoTip, strong, disabled.

## Keyboard

The label takes no focus; the InfoTip's button does.

## Differences from the artifact

Not in the artifact (it is part of each control there).
