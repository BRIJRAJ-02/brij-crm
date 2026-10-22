# ChoiceChips

A labelled row of chips for choosing one or several short options: a booking page's durations (spec 0025 experience).

## Why it exists

New. The experience note shows durations as chips, more than one allowed. SegmentedControl is single choice and switches views; Checkbox lists read as a form of settings rather than a handful of lengths; Select with several values needs a popover for five short words. A multiple selection ToggleButtonGroup with a visible label is what fits. The chips are the library's `ToggleButton`, so a held chip looks as any held toggle does; the label is a Field's label, so the group lines up with the fields around it. Only the layout and the label are its own CSS.

## Use

```tsx
<ChoiceChips
  label="Duration"
  choices={[
    { id: '15', label: '15 min' },
    { id: '30', label: '30 min' },
  ]}
  selected={['30']}
  onChange={setSelected}
/>
```

- `isSingle` allows one choice only.
- `error` shows under the chips and describes the group.
- `end` puts a control after the last chip, in the same wrapping row and outside the group: a booking page's "+ Custom" length, a dashed Button that opens a Popover. The group's `isDisabled` doesn't reach it: the caller disables or leaves out `end` with the group (the editor leaves it out while read only). Why: adding a choice isn't choosing one, so it can't be a chip in the group, and a full width field under the chips for a rarely used length took a row and a help line of its own (the owner, 22 October 2026).

## States

Unselected, selected, hover, pressed, focus, disabled, with an error.

## Keyboard

Tab reaches the group; arrows move between chips; Space or Enter toggles one.

## Differences from the artifact

Not in the artifact.
