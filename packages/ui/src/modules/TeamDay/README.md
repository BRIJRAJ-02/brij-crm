# TeamDay

The team's day (spec 0030, as spec 0037 amends it): one day, one column per person across, the hours down, each column headed by the person, time off as a band down it, and a "Needs a host" lane pinned at the start when bookings need handing on. Bookings › Calendar's Team view.

## Why it exists

New, assembled from what the library has rather than drawn beside it. Spec 0030 asks for a TeamDay module that shares WeekCalendar's block placement, block kinds and drawing layer, so everything on the grid (blocks, their overlaps and "+N" chips, drawing a span, the cards, the keys) is WeekCalendar's, through its `team` view (see its README). Each column's head is PersonLine (lifted out of TeamWeek's person cell for this). The lane is BookingList (`placement="card"`, with its `openId` and the row it opened from). What is TeamDay's own is putting those together: a person becomes a column with its head, its band and whether it may draw; the column's name for screen readers is built from what the head shows, so the two can't drift; the lane opens its booking's card beside the row, or as a sheet on a phone.

The references (Mobbin, 31 October 2026):

- Wix, Booking Calendar's Staff view (https://mobbin.com/screens/710a5c70-57fb-4177-ad6f-5a1a2e14c397): staff as columns of one day, a picture and name over each, the hours outside their schedule shaded.
- Fresha, Calendar (https://mobbin.com/screens/b3031d03-35a8-43cc-8850-8aad4c98854d): the person's picture over their column, appointments in the column's width, the card beside the booking.
- Jobber, Schedule (https://mobbin.com/screens/933b4f47-4f18-42d6-b37a-a9dd3e84ebb7): an "Unscheduled" lane with its count beside the calendar, for work nobody has yet; here the Needs a host lane.
- Deputy, Schedule (https://mobbin.com/screens/fa53831a-00a8-4442-b4e1-82cc1d259ca6): warnings counted in the bar rather than explained on every shift; here the day's issue count, which the screen draws in its toolbar.
- Workable, Work calendar (https://mobbin.com/screens/e3ef1c9a-a0f1-40b4-90a6-e11722b779cd): the job title under each name, and time off as a band of its own colour.

## Use

```tsx
<TeamDay
  label="Team, Monday 2 November"
  people={[{ id, name: 'Sam Lee', status: '3 booked', tone: 'booked', badge: 'UTC+1', title: 'Sales lead' }, …]}
  selectedPerson={selected}
  onSelectPerson={setSelected}
  blocks={blocks}                 // WeekCalendar's blocks, `dayKey` the person's id
  openHours={(personId) => …}     // each person's open hours on the reader's clock
  lane={{ rows, openId, detail: <BookingCard … />, onOpen, onClose }}
  // …and the rest of WeekCalendar's props: hourLabel, now, scrollToMinute, openId, detail, onOpen, onClose, onDraw…
/>
```

- `people` are the columns, in order. Each column's name for screen readers is built here from the head's own parts (name, status, offset, title, `extraLabel`, "view only"), so what is heard is what is shown; the head itself is hidden from screen readers.
- Under the name, one quiet line: the `status` first ("3 booked", "Free", "Off", "Away"), then the zone's offset (`badge`, which the screen passes only when it differs from the reader's), then the job `title`, last so it is what gets cut in a narrow column. `tone: 'away'` alone is coloured, in the Team week's Away colour, strong.
- `extra` sits at the head's end, never cut: the screen's calendar trouble chip (`extraLabel` says it in words).
- `canAct: false` (See only, spec 0037): the column draws nothing, has no crosshair and no draw hint, and the head carries an eye.
- `openHours` gives each person's open hours on the reader's clock: the rest of their column is shaded `surface-sunken`, as the week shades it; an empty list shades the whole column (Off).
- `band` draws time off down the column in the yellow tag's surface, its word ("Away", "Away · Vacation") pinned under the heads as the hours scroll; under every block, never taking the pointer.
- `lane` shows only with rows (BookingList's: the time as the date, the page, "Host and guest", a badge for Host away). A row opens `detail` in a Popover beside it, or a Modal sheet below `bp-container-md`; pressing it again, Escape or a press outside closes it (`onClose`) and focus goes back to the row.
- The now line runs across every column when the screen passes `now` (it does only while the day shown is today).

## States

Columns: booked, free, off (the whole column shaded), away (band), see only (eye, no drawing), the reader's own first. Lane: absent (nothing to hand on), rows, an open row (BookingList's selected surface). Loading and empty are WeekCalendar's (`isLoading`, `emptyHint`); a failed read and "A team calendar needs a team" are the screen's EmptyState. Every text colour is a token that meets 4.5:1 in both themes.

Below 480px of its container (a phone) the lane sits over the grid, a few rows high, and WeekCalendar shows one column at a time with Previous and Next in the corner (AC-765) below its own 480px.

## Keyboard

WeekCalendar's: one column in the tab order; Left and Right move between people (the grid scrolls the column clear of the pinned axis and heads), Up and Down between a person's blocks, Enter opens a block or draws a span on empty time (not on a See only column), Escape closes. The lane's rows are BookingList's buttons, in the tab order before the grid.

## Differences from the artifact

Not in the artifact.
