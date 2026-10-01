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
- `isLoading` shows skeleton rows through `useDelayedLoading`; `emptyState` shows with no rows.
- `onRowAction` opens a row on Enter or a click.

## States

Loading (skeletons), empty, rows, hover (pointer only), focus (row and cell).

## Keyboard

Tab enters the table; the arrow keys move between rows and cells; Enter opens a row with `onRowAction`.

## Differences from the artifact

Not in the artifact (the artifact's DataTable becomes DataGrid).
