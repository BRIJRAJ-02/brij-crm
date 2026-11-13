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
- `error` shows under the chips and describes the group. Drawn by the shared FieldError atom: the alert mark, then the words (5 November 2026).
- `end` puts a control after the last chip, in the same wrapping row and outside the group: a booking page's "+ Custom" length, a dashed Button that opens a Popover. The group's `isDisabled` doesn't reach it: the caller disables or leaves out `end` with the group (the editor leaves it out while read only). Why: adding a choice isn't choosing one, so it can't be a chip in the group, and a full width field under the chips for a rarely used length took a row and a help line of its own (the owner, 22 October 2026).

- `ends` names what the first and last chips mean, under the row at its two ends ("Not likely", "Very likely"), and describes the group: a hosted form's Scale (spec 0063). With `ends`, the points share the row's width evenly, and a long one (0 to 10) keeps one row on a phone (under 480px its points' padding comes down to `space-2`, critique c, 5 November 2026), taking two even rows, 0 to 5 over 6 to 10, only under 320px, where a 10 would clip. `isLabelHidden` keeps the label for screen readers only, where a larger heading shows it (one at a time). Why here: a scale is a short run of single choice chips, which this already is; only its end words are new.

## States

Unselected, selected, hover, pressed, focus, disabled, with an error.

## Keyboard

Tab reaches the group; arrows move between chips; Space or Enter toggles one.

## Differences from the artifact

Not in the artifact.

`isSelectionStrong` fills the held chip with the accent (Button's ToggleButton `isSelectionStrong`), where the chips sit beside an accent filled day and time: a reservation's party size (5 November 2026).

A choice's `dot` (a `Hue`, named as Badge names its dot) puts a colour dot before its label: the colour that choice wears elsewhere on the page, such as a zone's chip over its tables on Menu QR's Tables page ("● Patio (8)", after checklabs' zone pills, 5 November 2026). ToggleButton draws it with StatusDot in the label's own type, as SegmentedControl's `hue` does, so there is one dot in the library. The dot is decorative; the label names the choice. Why a variant: the chips are the same ToggleButtons with one more mark, so a held chip with a dot still looks as any held chip does.

## Timefix prototype (spec 0072)

Takes its rhythm from the prototype's ChoiceChips: a `text-body-sm-strong` label in the text colour, then the chips `space-8` apart, wrapping, with `end` after them; a scale's end words in `text-body-sm`. Each chip is the library's ToggleButton, so its pill, hover (`surface-hover`, the edge stepping up to `border-strong`), focus ring and disabled look are Button's, ported in tier 1.

**Two looks until the guest phases (spec 0072, decision 16).** Guests draw ChoiceChips too (a hosted form or a booking page), and guest pages keep their shipped look and cost until their own port phase (6 to 8). So `ChoiceChips.module.css` is the shipped look, which every page loads, and the prototype's look described here is `ChoiceChips.app.css`: the module's own class names, in the `utilities.app-look` layer, only under `<html data-scale="app">`, loaded by `src/app-look.ts` from the app's layouts and the stories. Change the app's look there, and the shipped look in the module; `app-look.test.ts` keeps their class names in step. The two merge back into the module when the guest pages take the prototype's look.

**Use it for** two to eight short options that should all be seen at once: a meeting length, a guest's interests, a quick filter, a form's scale. **Don't use it for** long lists (Select), actions (Button) or switching views (SegmentedControl, Tabs).

**States**: rest, hover, pressed (the fill deepens, nothing scales), selected, focus visible (the outline ring), disabled, with an error.

**Differences from the prototype**
- A held chip is ToggleButton's selected look (`accent-soft` fill, `accent-text` words and edge), not the prototype's ink fill with a check swapping in: the held look belongs to Button, and moving it (with the check's icon swap) is owed to Button's ToggleButton, outside this folder.
- Chips are Button's `md` (the prototype's `sm`, 28 full); the prototype's `md` 36 chip has no size prop here yet.
- Kept beyond the prototype: `ends` and its scale layout, `isSelectionStrong`, `tone="strong"`, `labelAside`, `error`.

