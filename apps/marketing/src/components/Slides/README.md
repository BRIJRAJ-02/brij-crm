# Slides

An area's screens in the app's window, playing in turn.

## Why it exists

The owner asked for "slides/images moving" inside each tab, showing what the area can do (23 October 2026). Each area of the showcase has a few 3840 × 2400 screens of the demo workspace; this plays them in one window, cross fading, with a way to pick one and a way to pause. The window's chrome (the lights, the address) is the site's own marketing frame, drawn once here (`aria-hidden`, decorative); the frame fades out over its last fifth, so the screen is whole and the window dissolves into the page instead of being cut (the owner, 23 October 2026: "don't cut, faded"). The controls are the library's, in a glass pill floating at the window's foot (the owner's ask; the page shows through a blur): a `SegmentedControl` (`size="compact"`, `isFitted`) with a segment per screen, so the arrow keys move between them, and a ghost icon `Button` for pause and play. Nothing in the library plays images, and a marketing carousel has no place in the app, so it lives here.

## Use

```tsx
<Slides area={SHOWCASE[0]} isFirst />
```

The screens, their addresses and captions live in `src/showcase.ts`. `isFirst` loads the first screen with the page (eager, high priority); every other screen loads lazily.

## States

- **Playing:** the next screen every 2 seconds, and after the last `onEnd` (the showcase moves to the next area), each fading in over `duration-modal` with `ease-out`. The play stops while the pointer or focus is on the window, while the page is hidden, and for anyone who asked for reduced motion (then the fade goes too; the segments still switch).
- **Paused:** the Pause button (its name says what it will do: "Pause the screens", "Play the screens"). WCAG 2.2.2: anything that moves for more than five seconds can be paused.
- **Picked:** choosing a segment shows that screen; the play carries on from it once the pointer leaves.
- Screens not on show are `aria-hidden`, so a screen reader hears only the one shown. On a phone the window is 3:4 and shows the top of the app's own phone screen (`<area>-<n>-phone.webp`), readable at the phone's width.
