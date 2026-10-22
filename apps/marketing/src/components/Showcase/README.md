# Showcase

The product's four areas (CRM, Booking pages, Forms, Calendar) as the library's feature tabs, with the chosen area's screens playing in a window under them.

## Why it exists

The owner asked for "better designed tabs" showing the top areas, with "just high res 4k images" (23 October 2026), in place of the live demo, then for slides inside each tab showing what each area can do. The tabs are the library's `Tabs` in its `feature` variant (added for this) drawn under the window (`placement="bottom"`, the owner's ask of 23 October 2026, as were the labels alone with no descriptions), so they behave as the app's tabs do: arrow keys move between them, the line slides. The play runs through the areas: each screen four seconds, then the next area's tab (the owner, 23 October 2026). Each panel is a `Slides` window: the area's screens, whole, fading out at the foot, with the segments and a pause floating over its foot.

## Use

```tsx
<Showcase />
```

Areas and their screens are listed in `src/showcase.ts`.

## States

The tabs' own (chosen, hover, focus) and the Slides' (playing, paused, picked). The first area's first screen loads with the page; the others load when their tab is picked, or as the play reaches them.
