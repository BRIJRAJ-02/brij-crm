# PhoneField

A phone number with the country it is dialled from.

## Why it exists

The hosted form's phone question needs a country code and a number that read as one input. It is a Field (the same box, height, border, radius, focus ring, hint, error, read only and disabled states) with CountryPicker's compact `prefix` trigger joined to the start of its box, so it is not a second input design.

The field set's Phone editor draws it too, so a record's number and a form's answer are the same field (F38).

## Use

```tsx
<PhoneField label="Phone or WhatsApp" guess="IN" value={phone} onChange={setPhone} error={error} />
```

- `value` is `{ country, national }`: the ISO code and the number as typed there. The caller turns it into E.164 (`toE164` in `@crm/contracts/forms`) when it sends.
- `guess` is the visitor's country: chosen first when there is no value, and pinned first in the list.
- Choosing a country moves focus to the number, with what was typed kept. The code button is compact, the flag, the code and a small chevron close together, the code at its own width (the owner, 21 October 2026: a width kept for the longest code left a hole before the chevron).
- Inside a popover (a grid cell's editor) the code's list opens over the popover and both stay open; opening it never counts as leaving the field, and Esc closes the list first. The field draws its focus with its accent border alone there, as every Field in a popover does.
- The number is laid out for its country as it is typed (libphonenumber-js, loaded on demand the way the Phone field loads it), and only while the caret is at the end, so an edit in the middle keeps its place.
- A number pasted or typed with its "+" code ("+44 7700 900123") switches the country to match and keeps the rest as the number.
- The field set's Phone editor draws it too (F38, the owner's call, 20 October 2026: "the same dropdown of country code and country as forms"), so it takes a few more props, all left out by the hosted form, which keeps its look: `size` and `variant` (`cell` in a grid cell, where the field is the cell), `onBlur`, `onSubmit` and `onEscape`, `onLeave` (focus left the whole field: the number, the code button and the code's open list, which sits in a popover outside it, all count as inside, so a record commits only when the person really leaves), `autoFocus`, `isErrorFloating` and `autoComplete` (`off` for a record's number, `tel-national` by default).
- `showsExample` puts the chosen country's example number in the placeholder when none is given, written the national way ("081234 56789" for +91, "(201) 555-0123" for +1), from libphonenumber-js's examples, loaded on demand with the library and never in the first load. The owner's call (20 October 2026): the placeholder follows the country chosen.
- `checksNumber` checks the number for the chosen country: a quiet check (Icon's `success` tone, named "A valid number") at the end of the box while it is a number that exists there, and a plain sentence when it is too short, too long or not a number there, said only once focus leaves the whole field or Enter is pressed, never on each key; typing or choosing another country clears it. `error` wins over it.
- Both are left out by the hosted form for now, so the public page keeps its look; the form designer can turn them on.
- `labelAside` puts a quiet word after the label, such as "(optional)" on a public form: `text-tertiary`, on the same line, and part of the field's accessible name.

## States

Empty (the given placeholder, or the country's example number), with a number, valid (the check), too short, too long or not a number there (after leaving or Enter), searching for a code, no matches, error, read only (with its reason) and disabled.

## Keyboard

Tab reaches the code button, then the number. The code button opens CountryPicker's search (arrows, Enter, Esc, type to filter); the number is a Field.

## Differences from the artifact

The artifact has no phone field yet. It needs an artifact publish.
