# BookingReceipt

A guest's booking page (spec 0025, AC-674), kept without an account: the host with the state's mark (a tick, a cross or a clock, a 16px dot hung off the avatar's corner so it never covers the initials), a heading by state that takes focus as the page arrives ("You're booked" right after booking), then one card that leads with the summary (spec 0058, AC-19): the date chip beside what it is and who with (`summary`: "Intro call with Ada Lovelace"), the time, the whole date and zone and how soon, and, while it's ahead, the one thing to do with it in the same block, Join the call, with Add to calendar (Google, Outlook, an .ics file). The details follow under a rule: Who in full (the name, then the email kept whole on its own line, DescriptionList's `address`), guests, Where and the note. A cancelled or past booking offers a way to book again. Right after booking, one warm line sits under "You're booked" ("Ada will see you then."), and the state's mark pops in once beside the host, the page's short success check; reduced motion shows both at once. The Timefix foot (BookingFoot) sits under it, as on every public page.

## Why it exists

New, for the public booking pages' move onto the library. A record's page (RecordLayout) is an app screen; this is a page a guest opens from an email.

While it's ahead, the card's foot takes `changes` (BookingChanges: move, add guests, cancel), and `notice` puts a line over the card after a change ("Moved. Both calendars are updated…").

`brand` gives the foot's wordmark its own link (the guest's pages tag the workspace), opened in a new tab under the accessible name it is given. Since spec 0058 (AC-26) it is the same BookingFoot every public page ends with, "Powered by" and the wordmark on one quiet line, rather than the wordmark alone.

## Use

```tsx
<BookingReceipt state="confirmed" isWelcome hostName="Ada" date={…} range="9:30 – 10:00 AM" when="…" facts={[…]} joinUrl={…} calendars={…} />
```

The page formats every date and time in the booking's zone; the receipt draws what it's given.

## States

Confirmed (welcome or not), cancelled, past.

## Motion

The heading and its warm line rise out of a soft blur one after the other, then the card rises in and the check pops out of a blur. Reduced motion fades the card and shows the check at once.

## Keyboard

The heading takes focus on arrival; Tab reaches Join the call, each calendar and the book again link.

## Differences from the artifact

Not in the artifact.

`calendars.ics` is the file's address, or a function that fetches and saves it when pressed: a table reservation's file comes by POST with the guest's key (spec 0066 B7), so no address ever holds the key. The link's place is the same either way.

## Requests (spec 0062, AC-6203)

`state` also takes `requested` and `declined`. A request reads "Request sent" right after booking and "Your request"
when its guest comes back, with one line saying the host will confirm it. Its mark is yellow, and its time is not
struck through. It has no Join or Add to calendar yet, because no calendar event exists until the host confirms, but
it keeps its changes, so the guest can still cancel it. `declined` reads "This request was declined", with a red mark
and the way to book another time.

## Bookings fix pass (5 November 2026)

- `placement="card"`: the booking page's last step, drawn inside its own BookingFrame card right after Confirm (critic C1), with no ground, no card of its own and no foot, as a `section` with an `h2` under the frame's `h1`. `placement="page"` (the default) is the guest's own page, as before.
- "Tomorrow morning" (`relative`) reads quietly in the secondary text colour, not the link colour it isn't (critic A26).
- The pace comes from the `duration-public-*` tokens.
- `heading` replaces the state's own heading where the page knows more: a long ended booking's link reads "This booking ended" (B-13), with its time and title and no guest details, which the API no longer sends.

## The booked moment (v5 mock, 10 November 2026)

With `headline` the receipt is the v5 booked moment: right after booking (`isWelcome`) SuccessCheck's `xl` lands over a large "You're booked", then "<Host> will see you then." and, with `sentTo`, "We sent the details to <email>."; a booking opened again later shows the same card with no check and "Your booking". The card leads with the whole time (`headline.when`) and the zone and how soon quietly under it (`headline.meta`), then the facts (What, Who, Where, the note), Join the call across the card at Book's height, and Add to calendar (one quiet menu: Google Calendar, Outlook, Apple Calendar (.ics)) and Share centred under it; the changes close the card. A cancelled, declined, past or waiting booking shows its state's quiet mark over the heading. Without `headline`, the date chip layout is unchanged (a table reservation). Stories: BookedMoment, Returning.
