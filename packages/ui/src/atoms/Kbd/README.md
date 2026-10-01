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
- `tone`: `raised` (the default) has a hairline keycap edge (`shadow-control`), for a shortcut on its own; `soft` is grey and flat, inside buttons and menu items; `onAccent` is edged in `on-accent-kbd` on a primary button, with its text on the accent itself.
- Inside a control, hide the caps from screen readers and give the control `aria-keyshortcuts` instead (`keyShortcuts()` in `shortcuts.ts` turns `⌘↵` into `Meta+Enter`). Button does both for you.
- Its height and minimum width are `size-kbd` (16px).

## States

It has none of its own; it takes its control's.

## Keyboard

It is a label, not a control, so it takes no focus.

## Differences from the artifact

- `tone` replaces the artifact's `soft` flag and the primary button's CSS override, so no other component styles its insides.
- The `onAccent` cap is edged rather than filled: on-accent text on the `on-accent-kbd` fill measured 3.3:1, under the 4.5:1 rule; on the accent itself it holds 4.6:1.
- The text is `children: string`, one keycap. Several keycaps are several Kbds (Button's `kbd` takes a list).
- Platform aware keys (⌘ on Mac, Ctrl elsewhere) arrive with the full Kbd in milestone 2.
