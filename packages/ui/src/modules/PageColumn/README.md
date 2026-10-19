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

`width="narrow"` keeps a form to about the page card's width.

## States

None of its own.

## Keyboard

None of its own.

## Differences from the artifact

Not in the artifact.
