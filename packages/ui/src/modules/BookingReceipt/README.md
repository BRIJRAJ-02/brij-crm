# BookingReceipt

A guest's booking page (spec 0025, AC-674), kept without an account: the host with the state's mark (a tick, a cross or a clock, a 16px dot hung off the avatar's corner so it never covers the initials), a heading by state that takes focus as the page arrives ("You're booked" right after booking), then one card that leads with the summary (spec 0058, AC-19): the date chip beside what it is and who with (`summary`: "Intro call  with Ada Lovelace"), the time, the whole date and zone and how soon, and, while it's ahead, the one thing to do with it in the same block, Join the call, with Add to calendar (Google, Outlook, an .ics file). The details follow under a rule: Who in full (the name, then the email kept whole on its own line, DescriptionList's `address`), guests, Where and the note. A cancelled or past booking offers a way to book again. Right after booking, one warm line sits under "You're booked" ("Ada will see you then."), and the state's mark pops in once beside the host, the page's short success check; reduced motion shows both at once. The Timefix foot (BookingFoot) sits under it, as on every public page.

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

## Keyboard

The heading takes focus on arrival; Tab reaches Join the call, each calendar and the book again link.

## Differences from the artifact

Not in the artifact.
