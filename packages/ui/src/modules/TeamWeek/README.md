# TeamWeek

The roster's week (spec 0037, the Team week): people down the side, the days of one week across, each cell that day's hours, and a footer of totals.

## Why it exists

New. Spec 0037 asks for DataTable with cell Popovers first. DataGrid (the artifact's DataTable) is the virtualised record grid that draws attribute values through the field set; roster hours aren't attributes and a page holds at most 50 rows, so it doesn't fit. Table (the short, non virtual list on React Aria's grid) gives the rows, the header, the arrow keys between cells and the sideways scroll on a phone, so TeamWeek is built on it rather than beside it. What Table has no piece for is the cell itself: a block the cell's width holding one to six ranges stacked, in four tones (usual hours, a change for this date only marked by a dot, a day off, time off), that is a button opening an editor in a Popover where the reader may change it and plain text where they may not; and a person's cell with their week's hours and offset under the name and the row's menu at its end. A Button variant would have carried a second look for buttons (house rule 4), and a Tag has no pressed, focus or multi line state. Rows are at most 50 a page (spec 0037, AC-1289), so no virtualisation.

The references (Mobbin): Fresha's roster (hours chips per cell, time off inside the cell, hours under the name), Square's scheduling grid (the footer of per day totals), Wix's work schedule ("one time changes" against the usual week, here the dot).

## Use

```tsx
<TeamWeek
  label="Team week, 2 to 8 November"
  days={[{ id: '2026-11-02', label: 'Mon 2' }, …]}
  people={[{ id, name: 'Sam Lee', meta: '38 h', badge: 'UTC+5:30', cells: [{ tone: 'usual', lines: ['9:00 AM – 5:00 PM'], label: 'Monday 2 November, Sam Lee: 9:00 AM to 5:00 PM' }, …], isEditable: true, actions: <MenuTrigger>…</MenuTrigger> }]}
  footer={{ label: 'Working', totals: [{ value: '4 people', detail: '32 h', label: 'Monday 2 November: 4 people, 32 hours' }, …] }}
  editorLabel={(personId, day) => 'Sam Lee, Monday 2 November'}
  renderEditor={(personId, day, close) => <DayEditor … onDone={close} />}
/>
```

- Every cell has a whole `label` ("Monday 2 November, Sam Lee: 9:00 AM to 5:00 PM, this week only"), which is what a screen reader hears; the drawn lines are hidden from it.
- `isEditable` with `renderEditor` makes a person's cells buttons; otherwise they are text. The screen decides (a past week, See only).
- `badge` shows beside the week's hours only when given: the screen passes the zone's offset only when it differs from the reader's.
- `extra` sits under the name (a Link to the person's schedules); `actions` at the cell's end (the row's menu).
- The footer row follows the people, and is left out with no people. A total's `extra` is one more quiet line under its detail, in the detail's own style (the workspace link's coverage, "Link: 3"), so a second footer row was never needed; the total's `label` says it too.
- `isLoading` shows Table's skeleton rows; `emptyState` shows with no people.

## States

Usual, this week only (the dot), off (dashed, secondary text), away (the yellow tag's surface and text), hover (pointer only), focus (the focus ring), no change on press (rule 8), read only (text). An editable cell's edge is `border`, a control's 3.5:1, loading, empty. Every text colour is a token that meets 4.5:1 in both themes (the tag tokens carry their own pairs).

## Keyboard

Tab enters the grid. The arrow keys move between cells (an editable cell's button takes focus), Enter or Space opens its editor, and Esc closes it back onto the cell. Opened from the keyboard, the Popover appears at once.

## Differences from the artifact

Not in the artifact.
