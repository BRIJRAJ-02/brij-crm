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
- `info` puts help beside a header's label, an `InfoTip` (what each role may do), only where the header alone isn't clear. Why a variant: a header is a string, and help beside it is the same InfoTip a settings row uses. By keyboard the help sits in the header row: Up from the rows, then Right along the headers to its button.
- `isLoading` shows skeleton rows through `useDelayedLoading`; `emptyState` shows with no rows.
- `onRowAction` opens a row on Enter or a click.
- `selected` with `onSelectedChange` adds a leading column of Checkboxes for a bulk action (a form's submissions marked spam): the header's selects every row, indeterminate while some are picked; `getSelectLabel` names each ("Select Ada Lovelace"). Pair it with BulkActionBar. Why a variant: a short list needs a bulk action now and then, and DataGrid is for records only.
- Directly in a settings page's body (SettingsLayout sets the library's page edge) the table runs out through the page's `space-16` gutter to its edges, its rows' hairlines meeting the sidebar's, and its first and last columns' text sit on the content edges, in line with the section headings, the Tabs' first label and a Card's border. There a reorderable table's handles sit in that gutter, inside each row's first cell, not in a column of their own, so a table that reorders keeps its text where one that doesn't has it (owner feedback, 22 October 2026). Inside a Card, Modal, Popover or Panel it keeps to that box as before.
- A column's `size`: `fit` shrinks it to its widest content (its label, a checkbox), so columns of controls keep one width from table to table; `fill` takes what the rest leave and lets a TruncatedText in it cut with an ellipsis rather than widen the table. Why a variant: a long name beside columns of checkboxes pushed them off a card (first made for Settings › Calendars' list of calendars, the owner, 22 October 2026).
- A column's `showsOnHover` shows its cells' content only while the row is hovered, holds focus or has its menu open (always on touch): a row's options button in a long list of calendars, so the list isn't a column of identical buttons.
- `isHeaderHidden` draws no header row while the column labels still size the columns: a short table in a Card whose title already says what its rows are (the booking editor's Days off), or a second table continuing one above it, so headers never repeat. Give each cell's control its full name, since the header is no longer read. Why a variant: two tables in a row repeated their headers (the owner's brief, 22 October 2026).
- `isHeaderSticky` keeps the header in view while the page scrolls under it, on the page surface.
- `layout="even"` gives the row header column one set width (`size-column` plus `space-32`, room for a picture beside a name) and shares the rest evenly between the other columns, whatever their content (a fixed table layout). With `isScrollable` each shared column keeps at least `size-column-min`, and below 480px of the frame (a phone) the row header narrows to `size-column-narrow` plus `space-32` while each shared column keeps `size-column-narrow`, so the frame scrolls rather than crushing them. Why a variant: by content, the roster's name column took half a 1920px screen and the weekend shrank to a sliver (the owner, 30 October 2026); a week's days are equals.
- A column's `heading` draws in place of its label (a weekday beside its date); the label stays its text value, so the heading should carry a VisuallyHidden copy of what is heard. `isCurrent` marks the column for now (today): its header in the link colour on `accent-soft` over a thick accent line (it wins over a quiet tint), since the line alone was lost in dark (31 October 2026); only the header, since the same blue down the column swallowed a week's own blue blocks. `tone: 'quiet'` tints the whole column `surface-sunken` (a weekend), a step down into the page in both themes (`surface-subtle` sat a hair under the page in dark and didn't show, 31 October 2026). Why variants: a week's columns need today and the weekend told apart, and a header is otherwise a string.
- `getRowTone` returning `total` sets a row of sums apart: a control's edge above it, no hairline under it, and no hover (the roster's totals, Square's footer row).
- `isScrollable` lets a table wider than its slot (a phone, a dialog) scroll sideways inside its own box rather than cut its last columns off; cells keep their natural width and the arrow keys scroll each into view. It is ignored with `isHeaderSticky`, whose header sticks to the page. Where it hides columns past an end, that end fades over 24px, so the frame shows it scrolls (22 October 2026).
- `onReorder` makes rows movable (objects in settings, #13): a leading column holds each row's `DragHandle` (named by `getRowLabel`, "Move Projects"), and a drop calls `onReorder(id, targetId, 'before' | 'after')`; the move runs through the library's drag wrapper (dnd-kit): the held row lifts (`shadow-md` on `surface-raised`) and the others slide out of its way, for the pointer and the keyboard alike (Space or Enter on the grip lifts, the arrows move, Space or Enter drops, Escape puts it back, each step announced). `getRowLabel` comes with it. The screen saves the move and passes the new order back as `rows`. Pair it with Move up and Move down in a row menu, so a move is one keystroke away too. Why a variant: settings lists are short Tables; a GridList copy of the table would have duplicated its columns, header and states.

## States

Loading (skeletons), empty, rows, hover (pointer only), focus (row and cell), reorderable (a handle per row; the held row fades, an accent line marks where it lands, `Highlight` in forced colours). Even layout: the current column (link coloured header on `accent-soft` over a thick accent line), quiet columns (`surface-sunken`, only on rows at rest, so hover and selection still show), a total row (a control's edge above, no hover), and on a phone the row header held at the start edge while the rest scroll, with only the end fading.

A table wider than its slot (a phone) scrolls sideways in its own frame, never the page around it (21 October 2026). Focus rings are inset, so the frame never clips one.

## Keyboard

Tab enters the table; the arrow keys move between rows and cells; Enter opens a row with `onRowAction`. With `onReorder`, Enter on a row's handle picks it up, the arrows choose where, Enter drops it and Esc puts it back.

## Differences from the artifact

Not in the artifact (the artifact's DataTable becomes DataGrid).
