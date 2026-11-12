# FieldError

The one error line a control draws under itself: the alert mark (`circle-alert`), then the message, in the danger colour at the label size.

## Why it exists

New (the design critique, 5 November 2026). A hosted form's Rating, choice, checkbox and chips each drew their error as bare red text, with no mark, while a text field, a Select and a date drew the mark: one form showed two error designs. A variant of Field couldn't serve them, since they are not text fields, and each kept a copy of the same rule. So the line is one atom, and Radio, Checkbox, Rating, ChoiceChips, Select and DatePicker draw it; their own `.error` rules are gone, which also gave the hosted form's CSS budget back the room the public sizes took.

Field keeps its own error line, with the same look: it fades in on the field that caused it and can float under a grid cell, which the others never do.

## Use

```tsx
<RadioGroup isInvalid={error !== undefined}>
  …
  <FieldError>{error}</FieldError>
</RadioGroup>

<p id={errorId}>…</p> // a control that names its own error:
<FieldError kind="standalone" id={errorId}>{error}</FieldError>
```

- `kind="field"` (the default) is React Aria's own FieldError: shown only while the field is invalid, and the field is described by it.
- `kind="standalone"` is a plain line with an `id`, for a control that points `aria-describedby` at it itself (ChoiceChips).
- `inset="check"` starts the line past a checkbox's box, under its words.

- Exported (10 November 2026) as `kind="standalone"`'s line for a control a screen lays out from parts: Availability's time off popup says "Pick the days." under its month and "End after the start time." under its times away.

- `isAnnounced` (standalone only) gives the line `role="alert"`, for an error raised by a button elsewhere while focus stays on it.

## States

Shown only with a message (and, in a field, only while the field is invalid). It has no other state.

## Keyboard

None: it is text the field is described by.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Takes its look from the prototype's Field error (spec 0072): the alert mark and the message in `danger` at `text-body-sm`, `space-6` apart, the mark on the first line when the message wraps.

**Differences from the prototype**: `inset="check"` (a checkbox group's error under its boxes) is kept. It doesn't fade in by itself; Field's own error does.

**Repeats from its replacer** (AC-4): the error line's type, gap and alignment, the same rules as Field's `.error`; they leave with this export.
