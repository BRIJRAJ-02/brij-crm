# PhoneField

A phone number with the country it is dialled from.

## Why it exists

The hosted form's phone question needs a country code and a number that read as one input. It is a Field (the same box, height, border, radius, focus ring, hint, error, read only and disabled states) with CountryPicker's compact `prefix` trigger joined to the start of its box, so it is not a second input design.

It is not the field set's Phone editor, which edits a stored phone attribute and reads a whole number in the viewer's country. PhoneField asks a visitor for one number, with the country chosen in front of it.

## Use

```tsx
<PhoneField label="Phone or WhatsApp" guess="IN" value={phone} onChange={setPhone} error={error} />
```

- `value` is `{ country, national }`: the ISO code and the number as typed there. The caller turns it into E.164 (`toE164` in `@crm/contracts/forms`) when it sends.
- `guess` is the visitor's country: chosen first when there is no value, and pinned first in the list.
- Choosing a country moves focus to the number.
- The number is laid out for its country as it is typed (libphonenumber-js, loaded on demand the way the Phone field loads it), and only while the caret is at the end, so an edit in the middle keeps its place.
- A number pasted or typed with its "+" code ("+44 7700 900123") switches the country to match and keeps the rest as the number.

## States

Empty, with a number, searching for a code, no matches, error, read only (with its reason) and disabled.

## Keyboard

Tab reaches the code button, then the number. The code button opens CountryPicker's search (arrows, Enter, Esc, type to filter); the number is a Field.

## Differences from the artifact

The artifact has no phone field yet. It needs an artifact publish.
