# HuePicker

One of the nine hues, as named swatches.

## Why it exists

New. A select option's colour and an object's tile (#13) are picked from the same nine hues the tag and dot tokens define. It is a React Aria `RadioGroup`, so the arrow keys move between hues, and each swatch is named ("Green") with a tooltip.

## Use

```tsx
<HuePicker label="Option colour" value={hue} onChange={setHue} />
<HuePicker label="Colour" value={hue} onChange={setHue} isLabelShown />
```

- `isCompact` draws one swatch in the chosen hue, named "<label>: <hue>", which opens the nine in a Popover and closes it on a choice (read only, it is the swatch alone). Why a variant: an option's row in the OptionsEditor (spec 0012) has room for one swatch, not nine, and a second swatch style would have been a new element for the same thing.
- `label` names the group for screen readers. `isLabelShown` also draws it above the swatches as a field's label, for a form that stacks it with Fields (the new object dialog, an object's Configuration). Why a variant: in a form beside labelled Fields, swatches with no visible label read as decoration.

## States

Compact: the swatch (hover, focus, pressed), the popover open, read only. Full: chosen (a tick and a ring), hover tooltip, focus (accent outline), pressed, disabled, read only (`isReadOnly`: the chosen hue stays at full contrast and the group is reachable by keyboard, but nothing changes; for a member in settings).

## Keyboard

Tab reaches the chosen hue; the arrow keys move and choose.

## Differences from the artifact

Not in the artifact.
