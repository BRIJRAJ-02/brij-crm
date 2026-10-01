# HuePicker

One of the nine hues, as named swatches.

## Why it exists

New. A select option's colour and an object's tile (#13) are picked from the same nine hues the tag and dot tokens define. It is a React Aria `RadioGroup`, so the arrow keys move between hues, and each swatch is named ("Green") with a tooltip.

## Use

```tsx
<HuePicker label="Option colour" value={hue} onChange={setHue} />
```

## States

Chosen (a tick and a ring), hover tooltip, focus (accent outline), pressed, disabled.

## Keyboard

Tab reaches the chosen hue; the arrow keys move and choose.

## Differences from the artifact

Not in the artifact.
