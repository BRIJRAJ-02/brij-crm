# BookingDetails

A booking page's second step (spec 0025, AC-670 to AC-672): your name and email, guests to invite, a number to call on a phone page, and a note for the host; then Back and Confirm booking at the end, as calendars' booking pages place them. Labels sit above, errors under their field with the first one focused, and anything else (too many attempts, offline) in one line above the buttons. A visitor filled in from their sign in or a form hand off sees "Booking as Ada. Not you?", which clears both fields.

## Why it exists

New. Form submits a record's attribute values and shows refusals by attribute; this holds a guest list that grows and shrinks, a honeypot, and a send that may go back a step (the time was taken). It draws only the library's Field and Button.

## Use

```tsx
<BookingDetails
  needsPhone={page.location.type === 'phone'}
  prefill={{ name, email }}
  onBack={backToTimes}
  onSubmit={(values) => book(values)}
/>
```

`onSubmit` answers `{ kind: 'done' }`, `{ kind: 'invalid', fields }` (errors by `name`, `email`, `phone` or `guest-<n>`) or `{ kind: 'failed', message }`. The heading takes focus as the step arrives, so a phone keeps its keyboard down.

## States

Empty, prefilled, with guests, a phone page, invalid, sending (Confirm pending, Back off), failed.

## Keyboard

Tab through the fields, Add guests, each guest's Remove, the note, Back and Confirm. Enter in a field sends.

## Differences from the artifact

Not in the artifact.
