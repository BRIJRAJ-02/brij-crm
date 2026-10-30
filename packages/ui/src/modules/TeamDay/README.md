# TeamDay

The team's day (spec 0030, as spec 0037 amends it): one day, one column per person across, the hours down, each column headed by the person, time off as a quiet band down it, and "Needs a host" as one slim strip over the grid when bookings need handing on. Bookings › Calendar's Team view.

## Why it exists

New, assembled from what the library has rather than drawn beside it. Spec 0030 asks for a TeamDay module that shares WeekCalendar's block placement, block kinds and drawing layer, so everything on the grid (blocks, their overlaps and "+N" chips, drawing a span, the cards, the keys) is WeekCalendar's, through its `team` view (see its README). Each column's head is PersonLine (lifted out of TeamWeek's person cell for this). What is TeamDay's own is putting those together: a person becomes a column with its head, its band and whether it may draw; the column's name for screen readers is built from what the head shows, so the two can't drift; and the Needs a host strip, whose chips are its own (a booking on one line: time, title, guest), since nothing in the library is a one row, sideways scrolling set of pressable bookings. On a phone the strip's one chip lists them in BookingList (`placement="card"`).

Why a strip over the grid and not a lane at its start (the owner, 31 October 2026: "everything on left needs to be on top side", "the calendar shouldn't get small"): a lane a menu wide took that width from every column and pushed the last person off the screen. One row over the grid costs a control's height and nothing across.

The references (Mobbin, 31 October 2026):

- Wix, Booking Calendar's Staff view (https://mobbin.com/screens/710a5c70-57fb-4177-ad6f-5a1a2e14c397): staff as columns of one day, a picture and name over each, the hours outside their schedule shaded.
- Fresha, Calendar (https://mobbin.com/screens/b3031d03-35a8-43cc-8850-8aad4c98854d): the person's picture over their column, appointments in the column's width, the card beside the booking.
- Jobber, Schedule (https://mobbin.com/screens/933b4f47-4f18-42d6-b37a-a9dd3e84ebb7): an "Unscheduled" list with its count, for work nobody has yet; here the Needs a host strip, moved over the grid at the owner's word.
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
- Under the name, one short line: the `status` ("3 booked", "Free", "Off", "Away") in its tone's colour (booked the link colour, free the success colour, off tertiary, away the Team week's Away yellow, strong). The rest (the job `title`, the zone's offset `badge`, which the screen passes only when it differs from the reader's, and any trouble) is in the head's tooltip and the column's name, never cut mid word (the owner, 31 October 2026: "Practice …", "GMT · S…").
- `extra` sits at the head's end, never cut: the screen's calendar trouble chip (`extraLabel` says it in words).
- `canAct: false` (See only, spec 0037): the column draws nothing, has no crosshair and no draw hint, and the head carries an eye.
- `openHours` gives each person's open hours on the reader's clock: the rest of their column is shaded `surface-sunken`, as the week shades it; an empty list shades the whole column (Off).
- `band` draws time off down the column as a quiet wash of the yellow tag's surface, so what sits on it still reads, with its word ("Away · Vacation") once, as a yellow chip pinned under the heads as the hours scroll; under every block, never taking the pointer.
- `lane` shows only with rows (BookingList's: the time as `date`, the page as `title`, `guestName`, a badge for Host away that only the chip's name reads). It is one row over the grid: "Needs a host" and its count in the orange tag's colours, then one chip a booking, scrolling sideways when there are many. A chip opens `detail` (its booking's card, with Reassign) in a Popover under it; pressing it again, Escape or a press outside closes it (`onClose`) and focus goes back to the chip. Below `bp-container-md` the strip is one chip ("2 need a host") that lists them in a Modal sheet; one picked there opens as a sheet of its own.
- Overlapping blocks in a column sit side by side (WeekCalendar's team view never cascades one over another), so a Busy never covers a booking's words.
- The now line runs across every column when the screen passes `now` (it does only while the day shown is today).

## States

Columns: booked, free, off (the whole column shaded), away (band), see only (eye, no drawing), the reader's own first. Strip: absent (nothing to hand on), chips, an open chip (the selected surface with an accent edge), and on a phone the one summary chip. Loading and empty are WeekCalendar's (`isLoading`, `emptyHint`); a failed read and "A team calendar needs a team" are the screen's EmptyState. Every text colour is a token that meets 4.5:1 in both themes.

Columns are at least `size-column` (200px) wide and never squeezed to fit: past the window's width the grid scrolls sideways under the pinned hours. Below 480px of its container (a phone) the strip is its one summary chip, and WeekCalendar shows one column at a time with Previous and Next in the corner (AC-765) below its own 480px.

## Keyboard

WeekCalendar's: one column in the tab order; Left and Right move between people (the grid scrolls the column clear of the pinned axis and heads), Up and Down between a person's blocks, Enter opens a block or draws a span on empty time (not on a See only column), Escape closes. The strip's chips are buttons in the tab order before the grid, each scrolled into view as it takes focus.

## Differences from the artifact

Not in the artifact.
