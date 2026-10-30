# TeamWeek

The roster's week (spec 0037, the Team week): people down the side, the days of one week across as equals, each cell that day's hours as a calm block, a footer of totals and a legend under it.

## Why it exists

New. Spec 0037 asks for DataTable with cell Popovers first. DataGrid (the artifact's DataTable) is the virtualised record grid that draws attribute values through the field set; roster hours aren't attributes and a page holds at most 50 rows, so it doesn't fit. Table (the short, non virtual list on React Aria's grid) gives the rows, the header, the arrow keys between cells and the sideways scroll on a phone, so TeamWeek is built on it rather than beside it, with Table's `even` layout (the name column one set width, the seven days sharing the rest as equals), its current and quiet columns (today, the weekend) and its `total` row tone (the footer). What Table has no piece for is the cell itself: a block the cell's width holding one to six ranges stacked, in four tones (usual hours, a change for this date only marked by a dot, a day off, time off), that is a button opening an editor in a Popover where the reader may change it and plain text where they may not; a person's cell with their week's hours and offset under the name and the row's menu at its end; and the legend for those tones. A Button variant would have carried a second look for buttons (house rule 4), and a Tag has no pressed, focus or multi line state. Rows are at most 50 a page (spec 0037, AC-1289), so no virtualisation.

The references (Mobbin, read again for the owner's "better UI" pass, 30 October 2026):

- Square, Scheduling (https://mobbin.com/screens/66ea4b9b-7284-4f6a-bc5f-cb0860a34724): a fixed name column and evenly spaced days, the hours under each name, and a footer of per day totals aligned with the columns, the bold count over the quiet hours.
- Fresha, Scheduled shifts (https://mobbin.com/screens/29d98072-7a05-4e01-bb50-b1bda3ba68ad): soft filled hour blocks the cell's width, no edge at rest, ranges stacked, time off inside the cell.
- Wix, Work Schedule (https://mobbin.com/screens/79d464be-aae9-4d31-95f8-958c0b48646c): today's column marked in the accent with a line under its header, and one quiet line under the grid saying a click makes a one time change.
- Workable, Work calendar (https://mobbin.com/screens/89497ca9-3871-43e5-858e-edf7b49f05d8): Today and the week stepper on the left of one toolbar, time off as one band across the days it covers.
- Deputy, Schedule (https://mobbin.com/screens/42d9229d-2df6-4245-a3c1-0802e8c89350): the legend of what each look means, under the grid.

## Use

```tsx
<TeamWeek
  label="Team week, 2 to 8 November"
  days={[{ id: '2026-11-02', label: 'Mon 2', weekday: 'Mon', date: '2', isToday: false }, …, { id: '2026-11-08', label: 'Sun 8', weekday: 'Sun', date: '8', isQuiet: true }]}
  people={[{ id, name: 'Sam Lee', meta: '38 h', badge: 'UTC+5:30', cells: [{ tone: 'usual', lines: ['9 am – 5 pm'], label: 'Monday 2 November, Sam Lee: 9:00 am to 5:00 pm' }, …], isEditable: true, actions: <MenuTrigger>…</MenuTrigger> }]}
  footer={{ label: 'Working', totals: [{ value: '4 people', detail: '32 h', label: 'Monday 2 November: 4 people, 32 hours' }, …] }}
  legend={{ items: [{ tone: 'usual', label: 'Usual hours' }, …], hint: 'Select a day to change that date only.' }}
  editorLabel={(personId, day) => 'Sam Lee, Monday 2 November'}
  renderEditor={(personId, day, close) => <DayEditor … onDone={close} />}
/>
```

- Every cell has a whole `label` ("Monday 2 November, Sam Lee: 9:00 am to 5:00 pm, this week only"), which is what a screen reader hears; the drawn lines are hidden from it.
- A day with `weekday` and `date` heads its column with the two apart, the date in a small circle that is the accent on `isToday` (as WeekCalendar marks today), its header in the link colour over an accent line; a screen reader hears the `label`, with ", today" on today. `isQuiet` tints the whole column a step off the page (the weekend).
- `isEditable` with `renderEditor` makes a person's cells buttons; otherwise they are text. The screen decides (a past week, See only).
- `badge` follows the week's hours on the line under the name, after a middle dot ("36 h · UTC+5:30"), only when given: the screen passes the zone's offset only when it differs from the reader's.
- `extra` sits under the name (a Link to the person's schedules); `actions` at the cell's end (the row's menu), so it stays beside the name.
- Days away in a row join into one band across the cells' gaps; the band says "Away" (and its reason) once, on its first day, while each day's label still says it in full.
- The footer row follows the people, set apart by Table's `total` tone, and is left out with no people. Each total draws the same lines every day, a day nobody works too ("Nobody", "0 h"). A total's `extra` is one more quiet line under its detail (the workspace link's coverage, "Link: 3").
- `legend` draws one quiet line under the grid: a swatch per tone and its meaning, then the `hint`. It shows only with people.
- `isLoading` shows Table's skeleton rows; `emptyState` shows with no people.

## States

Editable: usual (the grey tag's surface with a `border-subtle` hairline), this week only (the blue tag's surface and the dot), off (a dashed control edge, secondary text), away (the yellow tag's surface and text, joined across days through Table's `--table-cell-inline` padding). Read only (a past week, a See only row): the same words with no block, so a filled block always means "select to change" (Away keeps its band), and the screen says "View only" after that person's hours. today, the weekend, hover (pointer only: a control's edge appears), focus (the focus ring, above a joined neighbour), no change on press (rule 8), read only (text), loading, empty. Every text colour is a token that meets 4.5:1 in both themes (the tag tokens carry their own pairs). Below 480px of its container (a phone) the picture gives its room to the name, Table narrows the name column and the week scrolls sideways.

Rows are taller than Table's 34px (a 24px picture over two lines, the blocks `size-input` high with `space-6` above and below), on purpose: the owner found 34px rows cramped here.

Today's date circle repeats WeekCalendar's look at `size-chip` rather than its `size-control`, since it sits in a 36px table header beside the weekday rather than over it; the two stay separate until a third use earns a shared DayNumber.

## Keyboard

Tab enters the grid. The arrow keys move between cells (an editable cell's button takes focus), Enter or Space opens its editor, and Esc closes it back onto the cell. Opened from the keyboard, the Popover appears at once.

## Differences from the artifact

Not in the artifact.
