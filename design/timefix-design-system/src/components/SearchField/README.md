SearchField narrows a list or opens search: an outlined pill with a search icon, a clear button, and an optional shortcut.

**Use it for**: filtering a table, board or picker list as you type, and the command search trigger in the top bar (with `shortcut="⌘K"`). **Don't use it for** a value that is saved (use TextField) or for picking one option from a known list (use a Select or ComboBox).

**The consumer provides**: `label` (the accessible name, "Search people"), `placeholder`, `value`/`onChange` or `defaultValue`, `onSubmit` (Enter), `onClear`, `size` (`md` 36, `sm` 28 in toolbars), `shortcut` ("⌘K", which also answers Ctrl+K, or a single key like "/"), `isDisabled`.

**States**: empty (placeholder, shortcut keycap), hover (border darkens), focus (accent edge and 2px accent-border ring; the keycap hides), with text (round clear button), disabled.

**Interaction**: type to filter; Esc or the clear button empties it and keeps focus in the field. Clearing plays transitions.dev input clear with dissolve: the text falls 12px and blurs out over 400ms, the placeholder drops in from above, and a soft streak glows under each word (multiply in light, screen in dark). With reduced motion it clears at once. The shortcut focuses and selects the field from anywhere outside another input.

**Replaces**: Field `variant="search"`, the Toolbar and CommandPalette search triggers.
