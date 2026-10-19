# PageColumn

A page body that isn't a grid or a settings page: padded, a readable width, its children stacked (spec 0025: Captures › Links, Bookings › Availability).

## Why it exists

New. Screens may not carry CSS, and the frame's body is edge to edge for grids. SettingsLayout brings the settings navigation, which these pages leave behind (they sit in the sidebar, not in Settings), so they need the padding and width alone.

## Use

```tsx
<PageColumn>
  <LinkList … />
</PageColumn>
```

`width="narrow"` keeps a form to the page card's width. `actions` sit at the column's top end, for a page whose TopBar belongs to a layout (Captures › Links' New booking page). `footer` takes a bar (an "Unsaved changes" Callout with Save) that sticks to the foot of the view while the column scrolls, so it stays in sight wherever the person is editing.

## States

With or without a footer bar.

## Keyboard

None of its own.

## Differences from the artifact

Not in the artifact.
