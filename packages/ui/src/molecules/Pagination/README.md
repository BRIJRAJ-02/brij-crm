# Pagination

A list's footer: rows per page, "1–10 of 42", and previous and next (the Bookings list, spec 0025).

## Why it exists

New. Lists in the app either load as you scroll (DataGrid, the trash) or show everything. The Bookings list is paged, as the reference product's is, with 10, 25, 50 or 100 rows per page.

## Use

```tsx
<Pagination
  label="Upcoming bookings"
  page={1}
  pageSize={10}
  total={42}
  pageSizes={[10, 25, 50, 100]}
  onPage={setPage}
  onPageSize={(size) => { setSize(size); setPage(1); }}
/>
```

- With `total` 0 it draws nothing.
- Previous is disabled on the first page and Next on the last.
- The rows per page Select's label is visually hidden, with the same words beside it.

## States

Pages, the first page and the last page (with their buttons disabled), and hidden.

## Keyboard

Tab moves to the rows per page Select, then Previous and Next.

## Differences from the artifact

Not in the artifact.
