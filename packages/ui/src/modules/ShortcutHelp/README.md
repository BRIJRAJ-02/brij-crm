# ShortcutHelp

A dialog listing the keyboard shortcuts in use, in groups, each with its keycaps.

## Why it exists

New. The core loop (#10) needs one place that lists the shortcuts the screens answer, so "Keyboard parity" holds: every shortcut shown in a `Kbd` works, and every one is listed. It is a `Modal` holding a `DescriptionList` per group, with `Kbd` caps; nothing else is new.

## Use

```tsx
<ShortcutHelp
  isOpen={isOpen}
  onOpenChange={setOpen}
  groups={[{ title: 'Everywhere', shortcuts: [{ label: 'Quick actions', keys: ['⌘', 'K'] }] }]}
/>
```

- Write keys with Mac symbols (⌘, ⇧, ⌥); other keyboards see Ctrl, Shift and Alt.
- One keycap per key pressed together.
- The screen opens it, conventionally with ?. Its title bar has the Modal's close button.
- `GRID_SHORTCUTS` (from `@crm/ui`, plain data kept beside the DataGrid so the list and the grid's keys change together) is the "In the table" group; a screen with a table lists it.
- On a touch only device (no hover, a coarse pointer), shortcuts held with a modifier (⌘, ⌥, ⇧) are left out, and a group left empty goes too.

## States

Open and closed (the Modal's own); on a touch only device, the shortcuts held with a modifier left out.

## Keyboard

Esc closes it and returns focus to where it opened from.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Takes its look from CommandPalette (spec 0072): the prototype folds ShortcutHelp into its CommandPalette, whose CSS draws the shortcut sheet. Groups sit side by side, each at least `size-menu` wide (one column in the default dialog's width), `space-24` apart down and `space-32` across; each group's title is `text-label` in `text-tertiary`, `space-4` over its rows; a shortcut's keycaps sit together `space-4` apart. The rows are DescriptionList's (its ported look: the label in the term column, the keycaps as the value), the keycaps Kbd's and the sheet Modal's.

**Use it for** the one list of keyboard shortcuts, opened with "?" or from a menu. **Don't use it for** a single shortcut beside its control (Kbd in a Tooltip or a MenuItem).

**The consumer provides** `groups` (a title and its `shortcuts`, each a label and its keys in Mac symbols; `GRID_SHORTCUTS` for a screen with a table), `isOpen` and `onOpenChange`.

**States**: open, closed, touch only (modifier shortcuts left out).

**Interaction**: Esc or the close button closes it and returns focus to where it opened from.

**Differences from the prototype**
- It keeps its own export and props: the prototype's `rows` is the library's `shortcuts`, and there are no default groups (the prototype's `DEFAULT_SHORTCUTS`): the screen lists the shortcuts it answers, so a listed key always works. No `ShortcutList` export.
- The sheet is Modal's default dialog (`size-dialog`), not the prototype's wide sheet (`size-dialog-wide`), so the groups stack in one column; a wider sheet is a Modal variant in the TSX, left for the lead. The title is Modal's title bar, not the prototype's 18px heading (Modal is phase 2).
- Rows are DescriptionList rows (a control tall, the label in `text-body-sm`), not the prototype's flex rows with a hairline between them: restyling them would reach into DescriptionList.
- Kept beyond the prototype: touch only devices leave out the shortcuts held with a modifier.

**Repeats from its replacer** (AC-4): the keycap group (`inline-flex`, `space-4` apart, centred), as CommandPalette's foot sets each key (`.key`), and the group title's type (`text-label` in `text-tertiary`, the Menu headings the palette's sections draw); they leave with this export.
