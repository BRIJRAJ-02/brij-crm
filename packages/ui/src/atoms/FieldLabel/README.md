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

## Colour on a public surface

The label reads `--label-colour` before the text colour (the default since spec 0072; it was the secondary grey). The hosted form sets it to the text colour in its card, where grey labels at the public 16px read weaker than the placeholders under them (the design critique, 5 November 2026); a branded surface may set another. Why a custom property and not a variant: every control draws its own FieldLabel, so a form wide colour reaches them all through one name rather than a prop on each. `--label-font` and `--label-tracking` do the same for the type: the hosted form's card sets them to the regular body, so its questions read at 16px and regular (the merge of port phases 1 and 2), while the card's own remap of the `text-body-sm` steps keeps a button's label at its weight.

## Timefix prototype (spec 0072)

Takes its look from the prototype's Field label (spec 0072): `text-body-sm-strong` in the text colour (was `text-label` in `text-secondary`), the aside in `text-tertiary` at the regular weight. `--label-colour` still lets a surface recolour it.


**Differences from the prototype**: `tone="heading"` (a section's heading over labelled values) and the InfoTip beside the label are kept. `tone="strong"` now draws the same as the default, since the prototype's label is already the strong one.

**Repeats from its replacer** (AC-4): the label's font and colour, as Field's own label draws them through this atom; nothing else.

**Use it for** a control's visible name above it (every Field, Select and DatePicker draws one). **Don't use it for** a section's title: that is a heading. **States**: rest, disabled (`opacity-disabled`).
