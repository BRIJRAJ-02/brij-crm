Slider picks a value, or a from–to range, along a track: notice periods, buffers, price filters, shares.

**Use it for**: a setting where the feel of "more or less" matters and the bounds are known (0–48 hours, $0–$500). Give it a range (`[from, to]`) for filters. **Don't use it for** exact amounts people type (use NumberField), or for fewer than five choices (use ChoiceChips).

**The consumer provides**: `label`, `value`/`onChange` (a number or a two number array) or `defaultValue`, `onChangeEnd` for saving, `minValue`, `maxValue`, `step`, `formatOptions` (hours, money, percent), `ticks` (`{ value, label }`, label only the few that orient), `thumbLabels` for a range's two thumbs, `showOutput`, `isDisabled`.

**States**: rest (grey rail, accent fill for the chosen part), hover (thumb edge darkens, bubble shows), dragging (accent edge, bubble follows), focus-visible (ring and bubble), disabled.

**Interaction**: drag the thumb or press the track; arrows step by `step`, Page Up/Down by a tenth, Home/End to the ends. The value bubble appears like transitions.dev tooltip (150ms ease-out, from 0.98 and 4px lower) and leaves at once. The value also shows, tabular, at the end of the label row. Range thumbs never cross.

**Replaces**: Slider.
