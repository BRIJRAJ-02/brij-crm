# Kbd

A keycap that shows the shortcut for the control it sits in, after its label.

## Why it exists

Ported from the design system artifact's Kbd card. Buttons, menu items and the command palette show their shortcuts with it.

## Use

```tsx
<Kbd>⌘K</Kbd>
<Kbd tone="soft">ESC</Kbd>
```

- Put it inside the control it triggers (Quick actions ⌘K, Cancel ESC, primary ⌘↵), after the label. Button does this for you through its `kbd` prop.
- Use the symbols ⌘ ⇧ ⌥ ↵. Don't spell out "Cmd+Enter".
- `tone`: `raised` (the default) has a hairline edge on the surface, for a shortcut on its own; `soft` is grey and flat, inside buttons and menu items; `onAccent` (inside an ink or red button) and `onInverse` (inside a Tooltip, "Search ⌘K") are clear, in the label's own colour, edged with 30% of that colour (spec 0072).
- Inside a control, hide the caps from screen readers and give the control `aria-keyshortcuts` instead (`keyShortcuts()` in `shortcuts.ts` turns `⌘↵` into `Meta+Enter`). Button does both for you.
- Its height and minimum width are `space-20` (20, the prototype's keycap; 18 in the app); inside a tooltip 18.

## States

It has none of its own; it takes its control's.

## Keyboard

It is a label, not a control, so it takes no focus.

## Differences from the artifact

- `tone` replaces the artifact's `soft` flag and the primary button's CSS override, so no other component styles its insides.
- The `onAccent` cap is edged rather than filled: its words sit on the button's own fill, which already holds them at 4.5:1 or more.
- The text is `children: string`, one keycap. Several keycaps are several Kbds (Button's `kbd` takes a list).
- Platform aware keys (⌘ on Mac, Ctrl elsewhere) arrive with the full Kbd in milestone 2.

## Timefix prototype (spec 0072)

Takes its look from the prototype's Kbd: a 20px keycap (`space-20`) with a hairline edge on the surface, in `text-tertiary` and the keycap type. Inside an ink button (`onAccent`) or a tooltip (`onInverse`) it turns clear, in the label's own colour, with a faint edge mixed from that colour.

**Two looks until the guest phases (spec 0072, decision 16).** Guests draw Kbd too (a booking, menu or reservation page), and guest pages keep their shipped look and cost until their own port phase (6 to 8). So `Kbd.module.css` is the shipped look, which every page loads, and the prototype's look described here is `Kbd.app.css`: the module's own class names, in the `utilities.app-look` layer, only under `<html data-scale="app">`, loaded by `src/app-look.ts` from the app's layouts and the stories. Change the app's look there, and the shipped look in the module; `app-look.test.ts` keeps their class names in step.

**Differences from the prototype**: `soft` (a filled cap inside a secondary button or a menu item) is kept. The legacy `shadow-control`, `on-accent-kbd` and `border-inverse` are no longer used: the clear caps take their edge from `currentColor`, which works on an ink, red or inverse fill alike.
