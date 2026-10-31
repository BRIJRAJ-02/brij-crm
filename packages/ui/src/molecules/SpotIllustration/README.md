# SpotIllustration

A small still drawing of what an empty screen will hold: a booking page with a picked time, a form with its button, or a link page with its rows.

## Why it exists

New (spec 0058, AC-8). The first empty moment of Links, Forms and the link page should show what will be here, not only say it. EmptyState's `illustration` slot centres any node but draws nothing, and apps may not style, so the drawing lives here. It reuses Skeleton's still bars (`isStill`), the same bars first run's workspace preview draws with, plus outlined pills and one accent mark, so it follows the theme in light and dark with tokens only.

## Use

```tsx
<EmptyState title="No booking pages yet" illustration={<SpotIllustration kind="booking" />} actions={newButton}>
  Make one and share its link.
</EmptyState>
```

- `kind`: `booking`, `form` or `link-page`.
- It is `size-column` wide, the most EmptyState's slot takes.

## States

One state. It never moves, so reduced motion changes nothing.

## Keyboard

It takes no focus and is hidden from screen readers; the EmptyState title says what is missing.

## Differences from the artifact

The artifact has no illustrations.
