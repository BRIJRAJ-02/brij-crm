# Showcase

The product's four areas (CRM, Booking pages, Forms, Calendar) as the library's feature tabs, with the chosen area's screens playing in a window under them.

## Why it exists

The owner asked for "better designed tabs" showing the top areas, with "just high res 4k images" (23 October 2026), in place of the live demo, then for slides inside each tab showing what each area can do. The tabs are the library's `Tabs` in its `feature` variant (added for this), so they behave as the app's tabs do: arrow keys move between them, the line slides. Each panel is a `Slides` window: the area's screens, cross fading, with a segment per screen and a pause.

## Use

```tsx
<Showcase />
```

Areas and their screens are listed in `src/showcase.ts`.

## States

The tabs' own (chosen, hover, focus) and the Slides' (playing, paused, picked). The first area's first screen loads with the page; the others load when their tab is picked, or as the play reaches them.
