# Tag and TagList

One select option as a coloured tag; several in a row, with "+N" for the rest.

## Why it exists

Ported from the artifact's Tag card. It is the select attribute's one display, so a tag in a cell is the same tag in the record panel, on a card and in a filter. Screens never draw it themselves: they render values through the field set (lint stops a screen importing it).

## Use

```tsx
<Tag hue="green">Won</Tag>
<Tag isArchived>Legacy</Tag>
<TagList tags={options} maxVisible={3} />
```

- `hue` is the option's hue, one of the nine. Gray when none.
- `isArchived`: an archived option still on an old value shows gray with a dashed edge, and "(archived)" for screen readers.
- `TagList` shows `maxVisible` tags, then a "+N" chip that opens all of them in a popover. Cards pass 3; grid cells measure their width (milestone 3). Stories always pass a number, so screenshots don't depend on width.

## States

Archived. The "+N" chip has hover, focus and pressed.

## Keyboard

Tags take no focus. The "+N" chip is a button: Enter or Space opens the popover, Esc closes it and returns focus.

## Differences from the artifact

- `hue` replaces `color`; `isArchived` is new.
- `TagList` takes `tags` (id, label, hue) rather than children, so it can count and fold the rest into "+N".

## Timefix prototype (spec 0072)

Takes its look from the prototype's Tag at its table size (`sm`): 22px (`space-20` and `space-2`), no outline, the words in the option's `tag-<hue>-text` on its `tag-<hue>-bg`, label type. The "+N" chip is the prototype's outline tag made pressable (hairline edge on the surface, a hover wash, the outline ring).

**Use it for**: select and multi select values, everywhere they show. **Don't** use a tag as an action; a removable filter is a FilterChip.

**Differences from the prototype**
- No `size` prop yet: every library tag is a value in a cell, a card or a field, which the prototype draws at `sm`. The prototype's `md` (26) and `pill` (30) are owed to the screen phase that first needs them, as Badge's `chip-lg` already draws the 26.
- No `status` shapes or `icon`: a status value is a StatusDot, through the field set.
- Archived keeps a dashed `border-strong` edge, since the prototype has no archived look.
- The "+N" chip's focus ring sits 1px out, as the prototype's pressable tag's does, rather than 2px: a 2px gap would touch the next tag in a row.
