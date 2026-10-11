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

Open and closed (the Modal's own).

## Keyboard

Esc closes it and returns focus to where it opened from.

## Differences from the artifact

Not in the artifact.
