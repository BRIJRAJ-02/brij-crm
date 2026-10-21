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

- Wide, the aside is a `size-measure` column `space-16` from the main column while `isAsideOpen`; the caller's toggle folds it (and remembers it, per browser).
- Narrower than `bp-container-md` plus `size-measure` of its own width, the aside leaves the page; `isAsideOpen` then opens it as a sheet (Panel) titled `asideLabel`, closed by its close button or Escape (`onAsideClose`). `onNarrowChange` tells the caller, so one toggle does the right thing: fold the column, or open the sheet.
- The aside is a landmark named `asideLabel`.

## States

Aside beside, aside folded, narrow with the sheet closed, narrow with the sheet open.

## Keyboard

The aside comes before the main column in the tab order, as it reads. The sheet takes focus when it opens; Escape closes it and focus returns to the toggle.

## Differences from the artifact

Not in the artifact.
