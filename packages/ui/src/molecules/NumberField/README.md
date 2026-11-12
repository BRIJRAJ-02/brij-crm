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
- What is saved is what is shown: a typed value is rounded to the decimals the mode shows before it is committed (`12.345` typed as money is saved as 12.35), the same rounding the display uses.

## Reading what is typed

`parseNumber(text, locale)` reads the person's language, and `parseNumber(formatNumber(x))` gives `x` back (as shown) in every language the field writes, which the unit tests check over German, Spanish, Brazilian Portuguese, French, Indian English, US English, Bengali, Marathi, Arabic, Persian and Nepali.

- **Its own digits.** Bengali, Marathi, Nepali, Arabic and Persian write their own digits (`১,২৩৪`); those read as digits, and so do Latin ones. The marks that only set the text's direction (before an Arabic or Persian minus) are ignored.
- **Group marks** are dropped wherever they sit, so deleting a digit from `1,234` reads as 123. One after the decimal mark, or two decimal marks, is not a number.
- **A typed point where the decimal mark is a comma.** People type `2.5` on any keyboard, so in a language whose decimal mark isn't a point, a text with one point and no decimal mark reads the point as a decimal point, unless it could be the language's group mark. Where the language groups with a point (German, Spanish, Portuguese, Indonesian, Turkish, Dutch, Italian), a point is a group mark when one to three digits come before it and exactly three after it: `1.234` is 1234 and `1.500` is 1500, as the language writes them. A point that can't be a group is a decimal point: one, two, or four or more digits after it (`2.5`, `12.25`, `1.2345`), or nothing, `0` or more than three digits before it (`.125`, `0.125`, `1234.567`). Where the language groups with something else (French's space, Arabic's `٬`), any lone point is a decimal point. So in German, deleting the last digit of `1.234` leaves `1.23`, which reads as 1.23 and shows as `1,23` when the field is left, so the change is in plain sight rather than silent.
- Anything else (letters, units typed in) is not a number, never a guess.
- `showSteppers` is off by default: the app's numbers are mostly settings typed once, and the prototype's always on buttons added two tab stops to every one. Turn them on for a small count changed one at a time. For a guest's count with no box at all, use Stepper.
- Controlled when `value` is passed at all (`undefined` is an empty box); leave the prop out and give `defaultValue` for a field that keeps its own.
- A step from the keyboard or a step button is said politely (a hidden live region), since a screen reader says nothing when ↑ changes a plain text box. Typed values are not said: the person typed them.
- `disabledReason` and `readOnlyReason` say why it is off, as Field's do.
- Don't use it for an id, a phone number or a code: those are text.

## States

Empty, a value, focused (Field's accent edge), invalid (`error`), disabled, read only (`readOnlyReason`); a step button turns off at its limit.

## Keyboard

↑ and ↓ step by `step`, Page Up and Page Down by ten steps, Home and End go to `minValue` and `maxValue`. Enter commits. The step buttons are in the tab order after the field.

## Differences from the artifact

The prototype pops each changed digit in on commit; that needs markup inside Field's box, which phase 1 is restyling, so it waits for phase 3 (spec 0073). Steppers default to off (above).

**Owed to phase 1 (Field):** AC-7305's tabular digits. Field's input sets no `font-variant-numeric`, and this wrapper has no CSS of its own, so a `data-numeric` input state on Field (`tabular-nums`) lands with phase 1's Field restyle; until then the digits are the face's own, which in Geist are close to even.
