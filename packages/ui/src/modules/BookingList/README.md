# BookingList

Bookings as rows under day bands: the host's Bookings page (spec 0025, `0025-calcom-alignment.md`, 5. Bookings list).

## Why it exists

New. The alignment asks for rows under grey day bands ("TODAY"), each with a date column (the day bold, the time muted, a Join link with the meeting's provider), the title, the visitor's note and "You and <guest>", and the row's actions at the end. Table moves by cell and has one header for every row, which can't hold bands or a stacked date column; LinkList is one line of facts per link with no date column and no bands, and a variant would change most of its markup.

## Use

```tsx
<BookingList
  label="Upcoming bookings"
  groups={[{ id: '2026-10-20', label: 'Today', rows: [{ id, date: 'Tue, 20 Oct', time: '9:00 – 9:30 AM', join: { href, provider: 'Google Meet' }, title: 'Quick chat', guestName: 'Grace Hopper', guestHref: '/w/acme/people/…' }] }]}
  onOpen={(id) => open(id)}
  emptyState={<EmptyState title="No upcoming bookings" />}
/>
```

- The title is a ghost Button; `onOpen` gets the row's id.
- `guestHref` links the guest's name to their person; without it the name is text.
- `badge` ("Cancelled") is a Badge after the title.
- `placement="card"` (Home's Today, spec 0041) leaves the box to the Card around it: no border of its own, rows inset by `space-8`, the bands as plain small labels in the tertiary colour rather than grey bars, and a narrower date column (`size-column-min`, 80px) with the Join link moved under the title, where it has room, since it holds a time alone; the rows stack only under 320px of card. Why a variant: in a Card the list's own frame drew a box inside a box, and at a tile's width every row stacked into four lines. An empty `time` draws nothing (an all day event).
- `guestName` left out (one of the member's own calendar events, Home's Today, spec 0041) leaves out the "You and" line. Why a variant: Today lists bookings and calendar events in one day's order, and an event has no visitor; a second list for the same rows would split one day in two.
- `actions` sits at the row's end (Cancel, an Edit menu), passed in by the screen.
- The band's label shows in small capitals (`font-variant-caps`), so it reads as "TODAY" while screen readers read the word.
- The date column is half of `--size-measure` wide (140px); below 480px of its container it sits above the rest of the row.

## States

Rows, empty (the caller's EmptyState); the buttons' and links' own hover, focus and pressed states. Loading and failure are the screen's (a Skeleton, an EmptyState with Try again).

## Keyboard

Tab moves through each row's Join link, title button, guest link and actions in order.

## Differences from the artifact

Not in the artifact. No virtualisation yet: Bookings reads at most 200 a tab.
