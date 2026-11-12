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
  onPageSize={(size) => {
    setSize(size);
    setPage(1);
  }}
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

## Timefix prototype (spec 0072)

Takes its look from the prototype's Pagination (the `compact` pager with a rows per page Select): the range and the rows per page caption in `text-body-sm` and `text-secondary` with tabular figures, `space-16` between the two groups, and Previous and Next as ghost icon Buttons `space-2` apart, so their wash and outline ring are Button's.

**Use it for** a paged list's foot (Bookings). **Don't use it for** a list that loads as you scroll (DataGrid) or one short enough to show whole.

**States**: pages, first page (Previous disabled), last page (Next disabled), hidden (nothing to page).

**Differences from the prototype**
- No numbered pages or gaps: the library pages by Previous and Next with a rows per page Select, as the reference product's list does; the prototype's numbered pills (the current one raised on `surface-raised` with a hairline) are owed to the screen that pages by number.
- The range changes in place; the prototype's digit pop-in (transitions.dev 02) is owed to phase 2's NumberPop, which this part can render once it lands.
