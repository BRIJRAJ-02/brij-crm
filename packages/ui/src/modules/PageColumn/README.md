# PageColumn

A page body that isn't a grid or a settings page: padded with the app's 16px gutter (the one RecordLayout, Toolbar and Tabs keep), the view's whole width, its children stacked (spec 0025: Bookings › Calendar, List and Availability, the Captures empty and failed states, and a booking page editor's loading and failed states).

## Why it exists

New. Screens may not carry CSS, and the frame's body is edge to edge for grids. SettingsLayout brings the settings navigation, which these pages leave behind (they sit in the sidebar, not in Settings), so they need the padding alone.

## Use

```tsx
<PageColumn aside={<TimeZoneCard />}>
  <WeeklyHoursCard />
</PageColumn>
```

A list of rows doesn't need one: LinkList's `density="compact"` runs edge to edge and carries the gutter inside its rows (Captures › Links and Forms).

Every page is full width (owner, 20 October 2026): the column takes the view's whole width inside the gutter, and there is no readable or narrow cap. Cards that hold one long field size the field inside themselves. `align="center"` fills the view's height and centres what it holds, for a list's empty state alone on the page (Captures › Links and Forms). `align="fill"` gives its child the view's whole height, for a grid that scrolls inside it (Bookings › Calendar's week). Why a variant: only the column knows the view's height, and a week cut at twelve hours left a gap under it (the owner, 22 October 2026). `actions` sit at the column's top end, for a page whose TopBar belongs to a layout. `aside` adds a side column (the panel's width) beside the children, which take the rest; when the two can't keep the page card's and the panel's widths side by side, it wraps under them at full width: Bookings › Availability puts the time zone and days off beside the week. `stack="aside-first"` puts the side column above the children once they stack (Availability: the time zone before the week on a phone); side by side it stays at the end. It renders the side column first in the DOM, so reading and Tab order match the stacked screen; use it only when the side column is context the children read in. `footer` takes a bar (an "Unsaved changes" Callout with Save) that sticks to the foot of the view while the column scrolls, so it stays in sight wherever the person is editing. A footer that draws nothing (SaveBar with nothing unsaved) takes no room, and the bar's wrapper lets the pointer through to the page under it; what it holds takes the pointer back.

## States

Default and centred; with or without a side column (stacked under or above the children) and a footer bar, empty or not.

## Keyboard

None of its own.

## Differences from the artifact

Not in the artifact. Its padding was space-24 until 20 October 2026, when it took the app's space-16 gutter. The same day its `width` prop went: `default` capped it at the wide dialog's width and `narrow` at the page card's, and every page is now full width.
