Menu is the list of actions or choices that opens from a button, a row's "…", a column header or a right-click.

**Use it for**: row and column actions, "Move to…" pickers with a filter, view options (Sort by, Show). **Don't use it for** picking a field's value (Select or ComboBox) or a whole command palette.

**The consumer provides**: a `MenuTrigger` holding a Button or IconButton and a `Menu` (`aria-label`, `onAction`). `MenuItem` takes a label, `icon`, `description`, `kbd` (one keycap), `badge` (a Pro Tag), `isDanger`. `MenuSection` takes `title` and, for choices, `selectionMode` with `selectedKeys`. `SubmenuTrigger` pairs a MenuItem with a nested Menu; `filterPlaceholder` adds Linear's filter box. `ContextMenu` wraps a row with `items`, `label`, `onAction`. `MenuList` takes `keepOpen` for a step inside a panel that goes on to another step (FilterBar's field, then operator), so picking doesn't close the panel.

**States**: item rest, focused (grey wash), pressed (deeper wash), submenu open, picked (accent tick, medium label), disabled, danger (red; red wash on focus), empty filter ("No matches").

**Interaction**: arrows move, typing jumps, Enter or Space acts, → opens a submenu, ← and Esc close it. The trigger stays pressed while its menu is open. The surface grows from the trigger (transitions.dev 05). A single choice draws its tick and the menu closes 120ms later; multiple choices stay open. A context menu opens at the pointer, or under the focused row on Shift+F10, and the row stays washed until it closes. Destructive items go last, under a separator.

**Replaces**: Menu, ContextMenu, the row and column header action menus.
