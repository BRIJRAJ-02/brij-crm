# BookingReceipt

A guest's booking page (spec 0025, AC-674), kept without an account: the host with the state's mark (a tick, a cross or a clock), a heading by state that takes focus as the page arrives ("You're booked" right after booking), then one card: the date chip beside the time, the whole date and zone and how soon; What, Who and Where; and, while it's ahead, Join the call and Add to calendar (Google, Outlook, an .ics file). A cancelled or past booking offers a way to book again. The Timefix foot sits under it.

## Why it exists

New, for the public booking pages' move onto the library. A record's page (RecordLayout) is an app screen; this is a page a guest opens from an email.

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
