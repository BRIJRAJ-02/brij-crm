# DataGrid

The record table: rows from outside, each value through the field set, and a spreadsheet's keyboard.

## Why it exists

New. Every object's table view (#20), lists (#21) and the import preview's table need one grid that holds a million rows without holding them all. React Aria's `Table` keeps every item in memory and TanStack Table expects the full data array (spec 0003, the data grid), so the grid is built here on TanStack Virtual with column state of its own. The small settings table is `Table`, not this.

## Use

```tsx
import { DataGrid } from '@crm/ui/grid';

<DataGrid
  label="Companies"
  columns={columns}
  pinnedCount={1}
  rows={rowSource}
  getValue={(row, columnId) => row.values[columnId] ?? null}
  getDisplay={(row, columnId) => row.displays[columnId]}
  rowHeader="name"
  selection={selection}
  onSelectionChange={setSelection}
  onColumnsChange={saveColumns}
  onCellChange={write}
  onCellsChange={writeMany}
  cellErrors={refusals}
/>;
```

- Import it from `@crm/ui/grid`, its own entry, inside a lazily loaded route, so it never sits in the first load.
- `rows` is a `RowSource`: `count`, `getItem(index)` (`undefined` while a row loads, which draws skeletons), `getKey`, `onRangeChange` (the rows on screen plus 8 either way) and, optionally, `resolveKeys` so a shift range can span rows not loaded yet.
- Values leave already valid: `onCellChange` and `onCellsChange` receive values their type's schema accepts. A refusal from the data layer comes back through `cellErrors` and shows as the cell's error.
- Columns are `{ id, attribute, width, isHidden? }`. Widths hold inside `size-column-min` and `size-column-max`; start a new column at `columnWidthFor(attribute)`, its type's tier as pixels. The first `pinnedCount` columns are pinned, and `rowHeader` is always first. A computed column shows the function mark in its header, an AI one the sparkle.
- `footer` draws calculations the screen worked out; the grid never computes over loaded rows.
- `editorProps(column)` gives a column's reference or file editor its search, uploads and the signed in member.
- `onSort` and `onFilter` add Sort and Filter to the column menu.
- `focusRow` (`{ index }`, a new object each time) moves focus to that row's first cell and scrolls it into view, after any closing dialog has handed focus back: a screen passes the row it just made (spec 0005, "New person"). Why a prop: the grid owns its focused cell, and nothing outside could move it without reaching into its DOM.

## States

- `status`: `loading` (the header, marked busy, with skeleton rows once the loading delay has passed, and "Loading rows" for screen readers), `error` (with `onRetry`) and `no-access` (the locked empty state), both drawn instead of the grid, and `ready`.
- No rows: the header stays, so the columns and their menus do too, with `emptyState` (or "No records yet") under it.
- A row still loading draws skeleton cells. A read only cell says why (its own reason, or the field set's: computed, set by the system, read only) and never opens. A refused value, from the data layer or a paste, shows the danger edge. Either reason is the cell's description for screen readers, and shows in a tooltip on hover or keyboard focus; Esc hides it.
- Selected rows take `surface-selected`, and keep it under the pointer; a cell range takes `accent-soft`, so it reads apart from them; the focused cell carries the inset focus ring. In forced colours, selection and ranges are outlined in `Highlight`.
- The focused row and the row being edited stay drawn while they scroll off screen, so focus and a draft survive the scroll.
- One tooltip serves the whole grid: after the tooltip delay on hover, or at once on keyboard focus, it shows a cell's reason, or else the full text of anything cut in it (`TruncatedText`, and chips that mark their label `data-truncated`). Cells mount no tooltip of their own.
- Rows recycle by their place on screen, so a scroll step of any length redraws rows in place, in order, and the header stays as it is. Each row is its own layout box (`contain: strict`), except one being edited, whose error floats below it.

## Keyboard

The ⌘ key on a Mac, Ctrl elsewhere (Mod):

- Tab enters and leaves at the one focused cell. Arrows move a cell; Home and End go to the row's ends; Mod with Home or End to the grid's ends; Page Up and Page Down a screen.
- Enter or F2 edits; typing a character edits and replaces the value. Enter commits and moves down, Tab commits and moves right (Shift reverses), Esc cancels. An edit writes to the record it opened on.
- How each type edits: typed types in the cell; a select or status as its list, open at once on the cell (arrows and Enter choose; a typed key is dropped); the rest in a popover on the cell with its first control focused, where Tab moves between its fields (a member or record search opens at once, starting with the typed key). A rating takes a typed digit or the arrows as a draft that Enter commits.
- Space on the checkbox column ticks the row, and on the header's checkbox ticks or clears the rows on screen. Space opens the record on the row header, and toggles a checkbox value.
- Mod+Enter follows a link in the cell (an email, a website).
- Delete or Backspace clears the cell or range (a checkbox becomes false; a required value refuses).
- Shift with an arrow draws a cell range; Shift with a click extends it. Mod+A selects the rows on screen. Esc clears the range.
- Mod+C copies the range as tab separated text, and announces how many cells. Mod+V pastes through each column's type: a full paste says so in a toast; otherwise one toast counts what was left and why (refused, outside the table, read only), and refused cells keep their reason.
- The footer is the last row the arrows reach; it reads, and nothing in it edits.
- On a header, Alt+Down or Enter opens the column menu: Move left and right, Pin or Unpin, Hide (focus moves to the column that takes its place), Resize, and Sort and Filter when the screen handles them. In resize mode Left and Right step the width by `space-8`, the width is announced and the keys show on the header; Enter or Esc finish, and any other key, a click or a move ends it too.
- The selection count is announced after Space, Shift ranges and Mod+A, and a cell range's size as it grows.
- By pointer: drag a header to reorder it (React Aria drag and drop), dropping before or after by which half the pointer is over; drag its end edge to resize; double click a cell to edit; click a name to open its record, or a checkbox's mark to toggle it. Cells take no text selection, so a shift click draws a range.

## Differences from the artifact

The artifact's `DataTable` card drew a static table. This is the grid the spec describes: virtualised rows and columns, rows from outside, editing in place through the field set, and column state that leaves through `onColumnsChange`. A select or status opens as its list on the cell, with no popover around it, so one key reaches the choices.
