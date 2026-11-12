# NumberField

A number typed or stepped: a count, an amount or a rate, read in the person's language (spec 0073, AC-7305).

## Why it exists

A thin wrapper over Field, not a new design. About fifty numeric Fields in the app each set `inputMode`, parsed the text by hand and added their own unit; none stepped with the arrow keys or read a German comma. NumberField gives them one parser (`parseNumber`), the keys a number field is expected to have, and the field set's look, with no CSS of its own. It is not React Aria's NumberField, which would bring a second input markup for phase 1 to restyle and its own parser chunk.

## Use

```tsx
<NumberField label="Seats" value={seats} onChange={setSeats} minValue={1} maxValue={500} unit="seats" />
<NumberField label="Deal value" mode="currency" currency="EUR" value={amount} onChange={setAmount} />
<NumberField label="Discount" mode="percent" defaultValue={10} />
<NumberField label="Guests" value={guests} onChange={setGuests} minValue={1} maxValue={12} showSteppers />
```

- `onChange` gets a committed value: on leaving the field, on Enter, on a step key or a step button. Never on each key, so a screen saves once.
- `mode`: `number`, `currency` (the currency's narrow symbol in front, two decimals; the workspace's currency when `currency` is left out) or `percent` (held to 0 to 100, "%" after). `unit` puts a word after the value.
- A text that isn't a number goes back to the last good value when the field is left; a number past a limit is held at the limit.
- `showSteppers` is off by default: the app's numbers are mostly settings typed once, and the prototype's always on buttons added two tab stops to every one. Turn them on for a small count changed one at a time. For a guest's count with no box at all, use Stepper.
- Don't use it for an id, a phone number or a code: those are text.

## States

Empty, a value, focused (Field's accent edge), invalid (`error`), disabled, read only (`readOnlyReason`); a step button turns off at its limit.

## Keyboard

↑ and ↓ step by `step`, Page Up and Page Down by ten steps, Home and End go to `minValue` and `maxValue`. Enter commits. The step buttons are in the tab order after the field.

## Differences from the artifact

The prototype pops each changed digit in on commit; that needs markup inside Field's box, which phase 1 is restyling, so it waits for phase 3 (spec 0073). Steppers default to off (above).
