# Showcase

The product's four areas (CRM, Booking pages, Forms, Calendar) as the library's feature tabs, with the chosen area's screen in a window under them.

## Why it exists

The owner asked for "better designed tabs" showing the top areas, with "just high res 4k images" (23 October 2026), in place of the live demo. The tabs are the library's `Tabs` in its new `feature` variant (added for this), so they behave as the app's tabs do: arrow keys move between them, the line slides. The window is the same chrome every screen on the site uses. The screens are 3840 × 2400 WebPs of a seeded demo workspace, dark.

## Use

```tsx
<Showcase />
```

Areas and screens are listed in `src/showcase.ts`.

## States

The tabs' own (chosen, hover, focus). The first screen loads with the page; the others load when picked.
