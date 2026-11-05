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

A table reservation (spec 0066 B7) passes `maxGuests={0}`: it counts its party on an earlier step, so the invites (Add guests) are left out altogether.

`labels` puts the page's own words in place of the built in ones, each optional: `heading`, `confirm`, `confirming`, `done` (the send button's three states) and `note`. A reservation page sends with "Reserve". `extra` draws the page's own controls after the note and before the questions (a reservation's occasion as ChoiceChips by key); the page holds and sends what they pick, and the form neither reads nor checks them. Story: Reservation.

- `onBack` left out (a table reservation's one page, after checklabs) draws no Back: the send button stands alone at the form's width, and nothing takes focus as the form shows (it is no step arriving; the page keeps its focus at its top). `blocked` says what the page still needs before any field is checked (the reservation's time): its words go in the line above the button. Story: OnePage. Why a prop: the reservation page keeps its times and details on one page, so there is no step to go back to.

## States

Empty, prefilled, with guests, a phone page, with questions (one shown by an earlier answer), invalid, sending (Confirm pending, Back off), failed, one page (no Back, the send at full width, no arrival focus, a page's `blocked` line).

## Motion

Guests are chips (the owner, 1 November 2026, from stageshow's share example): Add guests opens one Guests field; an address becomes a removable chip on Enter, a comma, a semicolon or a space, and on leaving the field (just after the blur, so a press on Confirm lands before anything moves). A pasted list splits into chips, duplicates once. Whatever is still typed is taken on Confirm, so a guest is never dropped. Something that isn't an address stays in the field with the reason, to fix or remove. Backspace in the empty field takes the last chip off, each chip's remove button is in the Tab order, and each change is said in a status line. The values sent are unchanged (`guests: string[]`), and a server's `guest-n` marks the n-th chip. A chip resolves in out of a 2px blur. A refused Confirm shakes each field it found wrong once, small and side to side (transitions.dev's error state shake), and the next refusal shakes it again; reduced motion keeps them still. The line above the buttons fades in when it has something to say. Inside the public booking page `--scale-press` is 0.97 here, so its buttons answer a press.

## Keyboard

Tab through the fields, Add guests, each guest's Remove, the note, the page's questions, Back and Confirm. Enter in a field sends.

## Differences from the artifact

Not in the artifact.

Booked: a `done` outcome may carry `next`. Confirm then reads Booked with a tick for one `--duration-move` before `next` runs (the page opens the receipt there), so the visitor sees the booking land (the owner, 1 November 2026). Without `next`, the page has already moved on.

The chips are GuestChips (2 November 2026), shared with the manage page's guests.
