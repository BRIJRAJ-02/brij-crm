# Switch

Turns a setting on or off at once, with no Save.

## Why it exists

Ported from the artifact's Switch card (version 8). Notification preferences, feature toggles and syncs (#28, #36) take effect the moment they change. It wraps React Aria's `Switch`, so it is announced as a switch. Use Checkbox when the choice is saved with a form.

## Use

```tsx
<Switch label="Email me about mentions" description="Sent within a minute." defaultSelected />
```

- **`isLabelHidden`:** the label is read by screen readers only (a link card's switch).
  - The switch is then just its 28px track, so an invisible hit area grows it to 32 by 34. A press just beside the track still toggles it, and nothing drawn changes (the owner asked for controls that can't be missed, 20 October 2026).
  - It uses Button sm's technique, an `::after` on the control. Give it about 2px of room across and 8px up and down before another target.

## States

Off, on (the knob slides with `duration-move`), focus, read only, disabled. Reduced motion moves the knob at once.

## Keyboard

Space toggles it.

## Differences from the artifact

- React Aria's props replace the input attributes; there is no invalid state, since a switch takes effect at once.
