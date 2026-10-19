# ChoiceChips

A labelled row of chips for choosing one or several short options: a booking page's durations (spec 0025 experience).

## Why it exists

New. The experience note shows durations as chips, more than one allowed. SegmentedControl is single choice and switches views; Checkbox lists read as a form of settings rather than a handful of lengths; Select with several values needs a popover for five short words. A multiple selection ToggleButtonGroup with a visible label is what fits.

## Use

```tsx
<ChoiceChips
  label="Duration"
  choices={[{ id: '15', label: '15 min' }, { id: '30', label: '30 min' }]}
  selected={['30']}
  onChange={setSelected}
/>
```

- `isSingle` allows one choice only.
- `error` shows under the chips and describes the group.

## States

Unselected, selected, hover, pressed, focus, disabled, with an error.

## Keyboard

Tab reaches the group; arrows move between chips; Space or Enter toggles one.

## Differences from the artifact

Not in the artifact.
