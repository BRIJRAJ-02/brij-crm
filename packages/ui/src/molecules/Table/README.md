# Table

A small, non virtual list in rows and columns: members, API keys, invoices, webhooks.

## Why it exists

New. Settings lists (#23, #25, #34, #35, #42) are short and need columns, a row header and row actions. It wraps React Aria's `Table`, so the arrow keys move between cells. Records never use it: React Aria's Table holds every row in memory, so records go through DataGrid (milestone 3).

## Use

```tsx
<Table label="Members" columns={columns} rows={members} getRowId={(m) => m.id}
  renderCell={(member, column) => …} emptyState={<EmptyState title="No members yet" />} />
```

- One column is the `isRowHeader` (it names the row for screen readers).
- `align="end"` for numbers and actions; `isLabelHidden` keeps an actions column's label for screen readers only.
- A column with `isInline` lays its cells out as one centred line of pieces `space-6` apart: a tile before a name, several Badges side by side.
- `info` puts help beside a header's label, an `InfoTip` (what each role may do), only where the header alone isn't clear. Why a variant: a header is a string, and help beside it is the same InfoTip a settings row uses.
- `isLoading` shows skeleton rows through `useDelayedLoading`; `emptyState` shows with no rows.
- `onRowAction` opens a row on Enter or a click.
- `selected` with `onSelectedChange` adds a leading column of Checkboxes for a bulk action (a form's submissions marked spam): the header's selects every row, indeterminate while some are picked; `getSelectLabel` names each ("Select Ada Lovelace"). Pair it with BulkActionBar. Why a variant: a short list needs a bulk action now and then, and DataGrid is for records only.
- Directly in a settings page's body (SettingsLayout sets the library's page edge) the table runs out through the page's `space-16` gutter to its edges, its rows' hairlines meeting the sidebar's, and its first and last columns' text sit on the content edges, in line with the section headings, the Tabs' first label and a Card's border. There a reorderable table's handles sit in that gutter, inside each row's first cell, not in a column of their own, so a table that reorders keeps its text where one that doesn't has it (owner feedback, 22 October 2026). Inside a Card, Modal, Popover or Panel it keeps to that box as before.
- `isHeaderSticky` keeps the header in view while the page scrolls under it, on the page surface.
- `onReorder` makes rows movable (objects in settings, #13): a leading column holds each row's `DragHandle` (named by `getRowLabel`, "Move Projects"), and a drop calls `onReorder(id, targetId, 'before' | 'after')`; while a row is held, an accent line shows where it would land, for the pointer and the keyboard alike (`DropIndicator`), and the held row fades (`opacity-busy`, as in ViewSettings and SortBuilder). `getRowLabel` comes with it. The screen saves the move and passes the new order back as `rows`. Pair it with Move up and Move down in a row menu, so a move is one keystroke away too. Why a variant: settings lists are short Tables, and React Aria's Table takes drag and drop hooks itself; a GridList copy of the table would have duplicated its columns, header and states.

## States

Loading (skeletons), empty, rows, hover (pointer only), focus (row and cell), reorderable (a handle per row; the held row fades, an accent line marks where it lands, `Highlight` in forced colours).

A table wider than its slot (a phone) scrolls sideways in its own frame, never the page around it (21 October 2026). Focus rings are inset, so the frame never clips one.

## Keyboard

Tab enters the table; the arrow keys move between rows and cells; Enter opens a row with `onRowAction`. With `onReorder`, Enter on a row's handle picks it up, the arrows choose where, Enter drops it and Esc puts it back.

## Differences from the artifact

Not in the artifact (the artifact's DataTable becomes DataGrid).
