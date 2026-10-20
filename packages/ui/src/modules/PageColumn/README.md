# PageColumn

A page body that isn't a grid or a settings page: padded with the app's 16px gutter (the one RecordLayout, Toolbar and Tabs keep), a readable width, its children stacked (spec 0025: Bookings › Calendar, List and Availability, the Captures empty and failed states, and a booking page editor's loading and failed states).

## Why it exists

New. Screens may not carry CSS, and the frame's body is edge to edge for grids. SettingsLayout brings the settings navigation, which these pages leave behind (they sit in the sidebar, not in Settings), so they need the padding and width alone.

## Use

```tsx
<PageColumn width="full" aside={<TimeZoneCard />}>
  <WeeklyHoursCard />
</PageColumn>
```

A list of rows doesn't need one: LinkList's `density="compact"` runs edge to edge and carries the gutter inside its rows (Captures › Links and Forms).

`width="narrow"` keeps a form to the page card's width; `width="full"` takes the view's whole width inside the padding (Bookings' tabs). `align="center"` fills the view's height and centres what it holds, for a list's empty state alone on the page (Captures › Links and Forms). `actions` sit at the column's top end, for a page whose TopBar belongs to a layout. `aside` (with `width="full"`, the only width with room for both) adds a side column (the panel's width) beside the children, which take the rest; when the two can't keep the page card's and the panel's widths side by side, it wraps under them at full width: Bookings › Availability puts the time zone and days off beside the week. `stack="aside-first"` puts the side column above the children once they stack (Availability: the time zone before the week on a phone); side by side it stays at the end. It renders the side column first in the DOM, so reading and Tab order match the stacked screen; use it only when the side column is context the children read in. `footer` takes a bar (an "Unsaved changes" Callout with Save) that sticks to the foot of the view while the column scrolls, so it stays in sight wherever the person is editing. A footer that draws nothing (SaveBar with nothing unsaved) takes no room, and the bar's wrapper lets the pointer through to the page under it; what it holds takes the pointer back.

## States

Default, narrow and full width, centred; with or without a side column (stacked under or above the children) and a footer bar, empty or not.

## Keyboard

None of its own.

## Differences from the artifact

Not in the artifact. Its padding was space-24 until 20 October 2026, when it took the app's space-16 gutter.
