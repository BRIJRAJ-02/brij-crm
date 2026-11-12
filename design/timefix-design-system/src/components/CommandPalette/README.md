The command palette (⌘K) jumps to any person, record or action from anywhere, and "?" opens a sheet of every keyboard shortcut.

**Use it for**: global search and quick actions (New meeting, Copy my booking link, Add a person), and the one shortcut reference. **Don't use it for**: filtering the current table (use the toolbar search) or picking a value in a field (use a combobox).

**The consumer provides**: `items` (`id`, `label`, `group` such as Recent / Records / Actions, `kind` person, record or action, grey `sub`, 16px `icon`, `shortcut`, extra `keywords`), `onAction`, `onShowShortcuts`, and `isOpen` with `onOpenChange`. `useCommandK(open)` binds ⌘K (Ctrl+K elsewhere). `CommandMenu` is the same contents for inline use. `ShortcutHelp` takes `groups` (title plus rows of label and keys) or uses Timefix's defaults; `ShortcutList` is the list alone.

**States**: empty query (all groups), filtering (empty groups drop out), no results (a sentence that suggests what to try), highlighted row (full-width grey wash, no border), with a shortcut keycap.

**Interaction**: focus starts in the search; Up and Down move the highlight without leaving the field, Enter opens and closes the palette, Esc clears then closes. People and records draw as `PersonLine` rows. The scrim fades and the dialog scales up from .96 over 250ms and back over 150ms (transitions.dev 06, modal); the footer strip names the keys.

**Replaces**: CommandPalette, ShortcutHelp.
