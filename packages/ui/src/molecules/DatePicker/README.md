# DatePicker and DateRangePicker

A calendar day, typed or picked from a calendar with quick picks; and a range of days for filters.

## Why it exists

Ported from the artifact's DatePicker card. It is the date attribute's editor (cells, the record panel, forms) and, as a range, the filter and dashboard period picker. It wraps React Aria's `DatePicker`, `DateRangePicker`, `Calendar` and `RangeCalendar`, so dates are typed in the language's order, the week starts on the language's first day, and every part works by keyboard.

## Use

```tsx
<DatePicker label="Projected close" value={close} onChange={setClose} />
<DateRangePicker label="Period" value={{ start: '2026-10-01', end: '2026-10-31' }} onChange={setPeriod} />
```

- Values are calendar days as the value shapes store them, `YYYY-MM-DD`, with no time zone; `null` is none.
- **Type a date** (30 October 2026, as Linear's and Twenty's): a field at the popover's top takes words or numbers, "tomorrow", "next fri", "in 2 weeks", "Oct 8", "8/10" (in the language's order), "2026-11-03", and shows the day they name at its end ("Fri 16 Oct", "No match"), heard as the field's description rather than a live region that talked over the typing; Enter chooses it, and an Enter that names no day announces "No match" once. It takes focus as the popover opens; Down moves to the days (UX review, 30 October 2026: Tab passed the month and its arrows first). The reading is `parseDateText` in `lib/parse-date-text.ts`, pure and tested, so the field set's Date can read typed text the same way. Why: a date far away took a dozen clicks, and every text field in the CRM is typed.
- **Quick picks** as the library's inline `Menu` under the calendar (30 October 2026; a Menu since the design review, so the picks are one tab stop with the arrows, as every other list of actions): Today, Tomorrow, Next week (the next first day of the week) and End of month, each with the day it means at the end as the item's `meta` ("Tomorrow · Sat 31 Oct"), resolved in the provider's time zone (`quickPicks()`), then **No date** last (its `x` icon), unless the field is required. Why a list: four buttons and Clear wrapped to two rows in 240px, and a pick never said which day it was. `showQuickPicks={false}` leaves out both the typed row and the picks. `onNow` adds **Now** first, with the time it means ("Now · 14:30"): the Date and time field's editor (the field types pass, 31 October 2026), which sets the day and the time together when it is chosen. Why a prop: only a caller holding a time of day knows what Now changes.
- **The month**: its title is a button ("October 2026 ⌄") that opens the year's twelve months, three across, the arrows then moving by year; choosing a month shows its days with focus on them. **Today** shows beside it whenever the month on show isn't today's, unless the quick picks are on, since they hold Today already (two Todays read as two different things). The months are one tab stop, the month on show (`aria-current`); the arrows move among them three across, Home and End go to the year's ends (`monthStep()` in `lib/month.ts`), and Esc goes back to the days without closing the popover. Why: reaching a date years away took a click a month.
- **Days** are round (a `size-control` and `space-4` square, `radius-full`, since spec 0072). **Today** is one mark everywhere: the link colour, strong, inside a hairline `accent-line` ring (no dot, which MonthTiles uses for Best). Days outside the month show faded and can't be chosen, and the grid is always six weeks tall, so paging never resizes the popover.
- **The range** is one unbroken band: its days fill their columns, square inside and round at the two ends. Its presets sit under the calendar as the same inline Menu: Last 7 days, This month, Last month, This quarter (`rangePresets()`), the one the range matches checked. `presets="future"` swaps them for Tomorrow, Rest of this week, Next week and Next month (`futureRangePresets()`), for what is planned ahead, as time off is: a past preset there is a wrong answer offered.
- `isReadOnly` shows the date with a lock and `readOnlyReason`; `error` says how to fix it. Drawn by the shared FieldError atom: the alert mark, then the words (5 November 2026).

### MonthCalendar

`<MonthCalendar label="Go to date" value={day} onChange={setDay} />` is the same calendar inline and compact: no field and no popover, shorter days (`size-control`), as wide as its column up to a menu's width, with the same month jump and Today. Why a variant: Bookings' calendars panel keeps a small month for jumping to a date, as Google Calendar does; it is DatePicker's month, so it reuses its grid, keys and look rather than adding a calendar. `shown={{ start, end }}` tints the days the view beside it shows (Bookings' week) as one band in `surface-selected` filling its columns, its ends round (at the month's edge too), the chosen day still accent and no hover inside it (the hover surface is lighter than the band, so a hovered day would seem to leave the week), as Google Calendar's small month marks its week. `autoFocus` puts focus on the chosen day as it mounts, for a month opened in a popover (Bookings' Go to date), so the arrows work at once; inline beside a view it stays off.

### MonthRangeCalendar

`<MonthRangeCalendar label="Days" value={range} onChange={setRange} minValue={today} marked={taken} />` is MonthCalendar's range variant: the month inline, a run of days picked on it: one press is that day (a range of one, said at once, so a single day off never needs a second press), and a second press ends the run there, drawn as the same unbroken band. `minValue` stops days before it (faded, as days outside the month), and `marked` puts a small `text-tertiary` dot under days that already carry something (planned time off), `currentcolor` on a picked day, and `markedLabel` ("time off planned") is said after its date. `error` draws FieldError under the month, describes the month by it and announces it (`isAnnounced`), for a popup whose Add was pressed with no days. Why a variant: Availability's time off popup puts the month beside the hours, as Cal.com's date overrides do, so the days are the popup's first choice rather than a field that opens a popover inside a popup; it is DatePicker's range calendar, so it reuses its grid, keys, band and look.

- **Paste**: a day pasted into the box ("8 Oct 2026", "tomorrow", "2026-10-08T09:00Z") fills it whole, read as Type a date reads text (`parseDateInput`), since a segment takes digits only. `startText` opens Type a date with the key that opened a grid cell's editor.

## States

Empty (placeholder segments), chosen, focus (accent border and ring), invalid, read only, disabled. In the calendar: today, chosen, in range, outside the month, hover (pointer only), focus, choosing a month; the typed row's day found or "No match"; inline, the shown week.

## Keyboard

Enter in the date submits the form around it, as in any text field (Availability's Add a day off).

Type into each segment, or use Up and Down to change it and Left and Right to move. Alt Down (or the calendar button) opens the calendar with focus in Type a date, where Enter chooses the day typed and Down moves to the days; Tab moves to the month, the arrows and the days, where arrows move by day, Page Up and Page Down by month, and Enter chooses; then the quick picks, one tab stop, where Up and Down move and Enter chooses. In the months, the arrows move, Enter chooses, and Esc goes back to the days; elsewhere Esc closes it and returns focus.

MonthCalendar with `autoFocus` (as a popover opens it, like Bookings' Go to date) starts with focus on the chosen day, so the arrows move from it at once.

## Differences from the artifact

- `value` and `onChange` keep `YYYY-MM-DD` strings; `today` comes from the provider's time zone, not a prop; `clearable` is on unless `isRequired`.
- The range variant is new.

## Timefix prototype (spec 0072)

Takes its look from the prototype's DatePicker and Calendar: the field is a Field's filled box (`surface-subtle`, no edge, `space-12` in; typed in or open, white with the `accent-text` edge and the `accent-border` ring), its literals and dash `text-tertiary`, and a round calendar button at its end that fills `surface-selected` under the pointer and while open. The calendar's days are the prototype's: a `size-control` and `space-4` square, `surface-hover` under the pointer, `surface-selected` pressed, the chosen day the accent fill in `text-body-strong`, a range's days on an `accent-soft` band with filled ends; weekdays are `text-label` in `text-tertiary`; the month's title is `text-heading`. Every focus is the outline ring (inside a cell for the month list, around a day). The label is a Field's, hint and resolved day `text-body-sm`.

**Use it for** one date in a form or a record's date field (`DatePicker`), a span in a report or filter (`DateRangePicker`), a month in a side column (`MonthCalendar`). **Don't use it for** a time alone or a year of birth.

**States**: field empty, typed, open, invalid (danger edge, `danger-soft` ring while focused), read only, disabled; day rest, hover, pressed, today, chosen, in range, unavailable, outside the month, focused.

**Differences from the prototype**
- Today keeps the library's one mark (the link colour inside a hairline `accent-text` ring), shared with WeekCalendar and MonthTiles, not the prototype's grey `border-strong` ring: the three move together in tier 3.
- Days outside the month stay visible and faded (the prototype hides them), so the six week grid never reads as missing days.
- The new month doesn't slide in from the side it came from (the prototype's 08 page slide): it needs the paging direction, which React Aria's Calendar doesn't expose to CSS (owed to the scheduling screens, phase 6).
- Kept beyond the prototype: "Type a date", quick picks and Now, the year's months under the title, `MonthCalendar` with its shown band and marked days, `size="sm"`, `isReadOnly`.
