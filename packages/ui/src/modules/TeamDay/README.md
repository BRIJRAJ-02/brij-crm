# TeamDay

The team's day (spec 0030, as spec 0037 amends it): one day, one column per person across, the hours down, each column headed by the person, time off as a band down it, and a "Needs a host" lane pinned at the start when bookings need handing on. Bookings › Calendar's Team view.

## Why it exists

New, built on WeekCalendar rather than beside it. Spec 0030 asks for a TeamDay module that shares WeekCalendar's block placement, block kinds and drawing layer. Everything on the grid (blocks, their overlaps and "+N" chips, drawing a span, the cards, the keys) is WeekCalendar's, through its `team` view: any number of columns at least 160px wide (`size-column-narrow` plus `space-32` and `space-8`), scrolling sideways under a head pinned to the top and an hour axis pinned to the start, a `head` node per column in place of a date, and a `band` per column. What WeekCalendar has no piece for is the person's head (picture, name, title, how their day stands, their calendar's chip) and the lane (a booking to hand on is not a time on any column: its host left or is away), so those live here. A Table row (TeamWeek's person cell) is a different element: a column's head is not a row header, and the lane's items are buttons opening a card, so neither reuses Table's cells.

The references (Mobbin, 31 October 2026):

- Wix, Booking Calendar's Staff view (https://mobbin.com/screens/710a5c70-57fb-4177-ad6f-5a1a2e14c397): staff as columns of one day, a picture and name over each, the hours outside their schedule shaded.
- Fresha, Calendar (https://mobbin.com/screens/b3031d03-35a8-43cc-8850-8aad4c98854d): the person's picture centred over their column, appointments in the column's width, the card beside the booking.
- Jobber, Schedule (https://mobbin.com/screens/933b4f47-4f18-42d6-b37a-a9dd3e84ebb7): an "Unscheduled" lane with its count beside the calendar, for work nobody has yet; here the Needs a host lane.
- Deputy, Schedule (https://mobbin.com/screens/fa53831a-00a8-4442-b4e1-82cc1d259ca6): warnings counted in the bar rather than flagged on every shift; here the day's issue counts, which the screen draws in its toolbar.
- Workable, Work calendar (https://mobbin.com/screens/e3ef1c9a-a0f1-40b4-90a6-e11722b779cd): the job title under each name, and time off as a band of its own colour.

## Use

```tsx
<TeamDay
  label="Team, Monday 2 November"
  people={[{ id, name: 'Sam Lee', title: 'Sales lead', status: '3 booked', tone: 'booked', label: 'Sam Lee, Sales lead, 3 booked' }, …]}
  selectedPerson={selected}
  onSelectPerson={setSelected}
  blocks={blocks}                 // WeekCalendar's blocks, `dayKey` the person's id
  openHours={(personId) => …}     // each person's open hours on the reader's clock
  lane={{ items, openId, detail: <BookingCard … />, onOpen, onClose }}
  // …and the rest of WeekCalendar's props: hourLabel, now, scrollToMinute, openId, detail, onOpen, onClose, onDraw…
/>
```

- `people` are the columns, in order. A column's name for screen readers is the person's `label`; the head is decoration for sighted readers and says the same.
- Under the name, one quiet line: the job `title` first (the stable fact, and why the columns are in their order), then the `status` ("3 booked", "Free", "Off", "Away"), then the zone's offset. `tone: 'away'` alone is coloured, in the Team week's Away colour, strong; the rest stay quiet (timefix's header).
- `badge` follows the status after a middle dot: the screen passes the person's zone offset only when it differs from the reader's.
- `extra` sits at the head's end: the screen's calendar health chip, quiet while all is well.
- `openHours` gives each person's open hours on the reader's clock: the rest of their column is shaded `surface-sunken`, as the week shades it; an empty list shades the whole column (Off).
- `band` draws time off down the column in the yellow tag's surface, its word ("Away", "Away · Vacation") at its top, pinned as the hours scroll; under every block, never taking the pointer, so a span can still be drawn over it.
- `lane` shows only with items. Each item is a card button: time, status ("Needs a host", "Host away") in the orange tag's text, the page's title, then who it is with and whose it was. Pressing one opens `detail` in a Popover beside it; pressing it again, Escape or a press outside closes it (`onClose`).
- The now line runs across every column when the screen passes `now` (it does only while the day shown is today).

## States

Columns: booked, free, off (the whole column shaded by `openHours` answering an empty list), away (band), the reader's own first. Lane: absent (nothing to hand on), items, an open item (selected surface, accent edge), hover (pointer only: a control's edge), focus (the focus ring), press (`scale-press`). Loading and empty are WeekCalendar's (`isLoading`, `emptyHint`); a failed read and "A team calendar needs a team" are the screen's EmptyState. Every text colour is a token that meets 4.5:1 in both themes.

Below 480px of its container (a phone) one column shows at a time with Previous and Next in the corner (AC-765); the lane then sits over the grid, a few cards high.

## Keyboard

WeekCalendar's: one column in the tab order; Left and Right move between people (the grid scrolls the column clear of the pinned axis), Up and Down between a person's blocks, Enter opens a block or draws a span on empty time, Escape closes. The lane's cards are buttons in the tab order before the grid.

## Differences from the artifact

Not in the artifact.
