# TeamList

Members as rows: each one's picture, name, where they stand now and what is next. Home's Team today (spec 0041).

## Why it exists

New. Team today shows every member with a presence ("Free now", "In a meeting") and one quiet line about their next meeting. LinkList has no picture and its rows open links; BookingList is a day of bookings under bands, one row per meeting rather than per person; Table's cells move by arrow keys and carry a header, which a short read only list doesn't need.

## Use

```tsx
<TeamList
  label="Team today"
  rows={[
    {
      id,
      name: 'Grace Hopper',
      presence: 'busy',
      status: 'In a meeting',
      detail: 'Until 3:30 PM · Next: Intro call, 4:00 PM',
    },
    { id, name: 'Linus', presence: 'free', status: 'Free now', detail: 'Next: Busy, 2:00 PM' },
  ]}
/>
```

- A `<ul>` labelled by `label`; each row's avatar is decorative, since the name is beside it. A long name is cut by TruncatedText, its whole in a tooltip.
- `presence` picks the dot's hue: `free` green, `busy` orange, `clear` gray (a clear or finished day). The words come from `status`, so colour never carries the meaning alone.
- `detail` wraps under the status on a narrow card rather than pushing the row wide.
- The screen decides what a teammate's meeting shows: a title only where the reader may see it, else "Busy".

## States

- Default: the rows.
- `isLoading`: three skeleton rows, `aria-busy`.
- Empty: no rows draws nothing (the Empty story), so the screen leaves its card out.
- Empty, error and no access belong to the card around it (EmptyState).

## Keyboard

None: the rows are read only and take no focus.

## Differences from the artifact

Not in the artifact.
