# Switch

Turns a setting on or off at once, with no Save.

## Why it exists

Ported from the artifact's Switch card (version 8). Notification preferences, feature toggles and syncs (#28, #36) take effect the moment they change. It wraps React Aria's `Switch`, so it is announced as a switch. Use Checkbox when the choice is saved with a form.

## Use

```tsx
<Switch label="Email me about mentions" description="Sent within a minute." defaultSelected />
```

## States

Off, on (the knob slides with `duration-move`), focus, read only, disabled. Reduced motion moves the knob at once.

## Keyboard

Space toggles it.

## Differences from the artifact

- React Aria's props replace the input attributes; there is no invalid state, since a switch takes effect at once.
