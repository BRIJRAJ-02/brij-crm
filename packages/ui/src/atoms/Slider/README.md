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

Rest, dragging, focus (the knob takes the focus halo), disabled (the track fades; the label and value stay readable). Forced colours draw the rail, fill and knob in system colours.

## Keyboard

Left and Down step it down, Right and Up step it up, Page Up and Page Down by a tenth, Home and End to its ends.

## Differences from the artifact

The artifact has no Slider card yet; this is the code first version, published with the next `pnpm ui:artifact`.
