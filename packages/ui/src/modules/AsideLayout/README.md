# AsideLayout

A main column with an aside at its start: the Bookings calendars beside the week and the list.

## Why it exists

New. PreviewLayout keeps its column at the end for a preview and folds it into a Disclosure under the body; RecordLayout's sidebar is a record's details. The calendars list sits at the start, as Google Calendar keeps it, folds away by the caller's toggle, and on a phone opens as a sheet, which neither of them does.

## Use

```tsx
<AsideLayout
  aside={<CalendarList … />}
  asideLabel="Calendars"
  isAsideOpen={isOpen}
  onAsideClose={() => setOpen(false)}
  onNarrowChange={setNarrow}
>
  <WeekCalendar … />
</AsideLayout>
```

- Wide, the aside is a `size-menu` column `space-16` from the main column while `isAsideOpen`; the caller's toggle folds it (and remembers it, per browser).
- Narrower than `bp-container-md` plus `size-menu` of its own width, the aside leaves the page; `isAsideOpen` then opens it as a sheet (Panel) titled `asideLabel`, closed by its close button or Escape (`onAsideClose`). `onNarrowChange` tells the caller, so one toggle does the right thing: fold the column, or open the sheet.
- The aside is a landmark named `asideLabel`.
- `isFill` takes the height its parent gives (PageColumn `align="fill"`) and passes it to the main column, so a child that fills (WeekCalendar `isFill`) reaches the view's foot. The main column scrolls what overflows it (a long list), so a sticky header in it sticks to its top. Why a variant: the layout sits between the page and the grid, and the height can't pass through it otherwise.
- `isFlush` sits it edge to edge, as Google Calendar's page is (PageColumn `align="flush"`): no gap, the aside padded `space-12` above and below and the page gutter (`space-16`) at its sides, so it starts on the tabs' line, its items `space-16` apart, parted from the main column by a hairline and scrolling on its own, so the grid takes the rest of the view. Why a variant: the owner asked for the week to fill the area with no card and no gap round it (22 October 2026), while the list keeps the page's gutter.

## States

Aside beside, aside folded, narrow with the sheet closed, narrow with the sheet open.

## Keyboard

The aside comes before the main column in the tab order, as it reads. The sheet takes focus when it opens; Escape closes it and focus returns to the toggle.

## Differences from the artifact

Not in the artifact.
