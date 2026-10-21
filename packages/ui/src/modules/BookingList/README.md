# BookingList

Bookings as rows under day bands: the host's Bookings page (spec 0025, `0025-calcom-alignment.md`, 5. Bookings list).

## Why it exists

New. The alignment asks for rows under grey day bands ("TODAY"), each with a date column (the day bold, the time muted, a Join link with the meeting's provider), the title, the visitor's note and "You and <guest>", and the row's actions at the end. Table moves by cell and has one header for every row, which can't hold bands or a stacked date column; LinkList is one line of facts per link with no date column and no bands, and a variant would change most of its markup.

## Use

```tsx
<BookingList
  label="Upcoming bookings"
  groups={[
    {
      id: '2026-10-20',
      label: 'Today',
      rows: [
        {
          id,
          date: 'Tue, 20 Oct',
          time: '9:00 – 9:30 AM',
          join: { href, provider: 'Google Meet' },
          title: 'Quick chat',
          guestName: 'Grace Hopper',
          guestHref: '/w/acme/people/…',
        },
      ],
    },
  ]}
  onOpen={(id) => open(id)}
  emptyState={<EmptyState title="No upcoming bookings" />}
/>
```

- The title is a ghost Button; `onOpen` gets the row's id.
- `guestHref` links the guest's name to their person; without it the name is text.
- `badge` ("Cancelled") is a Badge after the title.
- `guestName` is optional: a row without it has no "You and" line. `attendees` (and `moreAttendees`) say who else is in it as a muted line ("a@x.com, b@x.com and 3 more"), as the activity feed writes attendees it doesn't know, never a second attendee design; `calendar` shows the calendar it is on by its colour and name (StatusDot); `via` is a small Badge saying where it came from ("Booked via Intro call"). Why: Bookings' list shows every meeting, the member's synced calendar events beside the bookings, and those have attendees and a calendar rather than one visitor.
- `actions` sits at the row's end (Cancel, an Edit menu), passed in by the screen.
- The band's label shows in small capitals (`font-variant-caps`), so it reads as "TODAY" while screen readers read the word.
- Two lines a row (the owner, 21 Oct: shorter rows): the date column is the day over the time, half of `--size-measure` wide (140px); the title sits over one muted line holding Join, "You and <guest>", the calendar, `via`, the attendees and the note in that order, cut to the row's width (Join first, so it always shows; who it's with gives way last, the note first). Below 480px of its container the date and time share one line above the rest.

## States

Rows, empty (the caller's EmptyState); the buttons' and links' own hover, focus and pressed states. Loading and failure are the screen's (a Skeleton, an EmptyState with Try again).

## Keyboard

Tab moves through each row's title button, Join link, guest link and actions in order.

## Differences from the artifact

Not in the artifact. No virtualisation yet: Bookings reads a page of 50 at a time, More adding the next.
