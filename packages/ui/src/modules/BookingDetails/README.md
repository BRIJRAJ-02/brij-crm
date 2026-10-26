# BookingDetails

A booking page's second step (spec 0025, AC-670 to AC-672): your name and email, guests to invite, a number to call on a phone page, and a note for the host; then Back and Confirm booking at the end, as calendars' booking pages place them. Labels sit above, errors under their field with the first one focused, and anything else (too many attempts, offline, or a refusal on nothing the form draws an error on) in one line above the buttons. A visitor filled in from their sign in or a form hand off sees "Booking as Ada. Not you?", which clears both fields.

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

A page with its own questions (spec 0057) passes `questions` (the hosted form's `PublicQuestion`s): they follow the note, drawn by the hosted form's `Question` (the same control per answer type), shown by Show when and checked with `checkAnswers` before anything is sent, so a visitor sees the message the server would give. `prefillAnswers` starts some filled in (a form's hand off), `countryGuess` a phone's code. What they answered goes in `values.answers`, by question key, the questions showing only. A refusal on a question comes back as `answers.<key>`.

`onSubmit` answers `{ kind: 'done' }`, `{ kind: 'invalid', fields, message }` (errors by `name`, `email`, `phone`, `guest-<n>` or `answers.<key>`) or `{ kind: 'failed', message }`. In `guest-<n>`, n counts the guests sent, blanks left out, and the form moves the error to that guest's row. When no field in `fields` is one the form draws an error on (a time zone, a phone the page never asked for, the note, the guest list as a whole), `message` goes in the line above the buttons instead (without one, "That did not go through. Try again in a moment."), and everything typed stays. The heading takes focus as the step arrives, so a phone keeps its keyboard down.

## States

Empty, prefilled, with guests, a phone page, with questions (one shown by an earlier answer), invalid, sending (Confirm pending, Back off), failed.

## Keyboard

Tab through the fields, Add guests, each guest's Remove, the note, the page's questions, Back and Confirm. Enter in a field sends.

## Differences from the artifact

Not in the artifact.
