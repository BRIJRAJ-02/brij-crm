# Slider

Picks one number along a track: a photo's zoom in PhotoCrop.

## Why it exists

New (4 November 2026, spec 0068 AC-6809). The cropper's zoom needed a control that a pointer drags and a keyboard steps, and nothing in the library picked a number from a range: Field takes typed numbers, SegmentedControl a few named choices. It wraps React Aria's `Slider`, `SliderTrack`, `SliderFill` and `SliderThumb`, so a screen reader hears a slider with its value as formatted (`150%`), and the keys are React Aria's.

## Use

```tsx
<Slider
  label="Zoom"
  value={zoom}
  onChange={setZoom}
  minValue={1}
  maxValue={4}
  step={0.01}
  formatOptions={{ style: 'percent' }}
/>
```

- `isLabelHidden`: the label for screen readers only, where the slider's place names it (between a photo's minus and plus).
- `showsValue`: the formatted value beside the label.
- `onChangeEnd`: once the pointer lets go or after a key, for a value that is saved rather than shown.

## States

Rest, hover and dragging (the value bubble shows), focus (the thumb takes the outline ring and shows the bubble), disabled (the track fades; the label and value stay readable). Forced colours draw the rail, fill and knob in system colours.

## Keyboard

Left and Down step it down, Right and Up step it up, Page Up and Page Down by a tenth, Home and End to its ends.

## Differences from the artifact

The artifact has no Slider card yet; this is the code first version, published with the next `pnpm ui:artifact`.

## Timefix prototype (spec 0072)

Takes its look from the prototype's Slider: a 4px `surface-selected` rail with the accent fill, a 20px white thumb with `shadow-sm`, and a value bubble (`surface-inverse`, label type, tabular figures) that rises over the thumb on hover, drag or keyboard focus (transitions.dev 17: `--duration-quick`, `--ease-out`, from 4px lower and `--scale-small`) and leaves at once. The label and value sit in a row above in `body-sm-strong`.

**Differences from the prototype**: the thumb's edge is `control-border` (the prototype's `border-strong` falls under 3:1 against the surface), darkening to `text-secondary` on hover and the accent while dragged. The bubble is hidden from screen readers; the thumb's own input says the value. Under reduced motion it fades without rising. Ranges, ticks and marks are owed to the screen phase that needs them.
