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
