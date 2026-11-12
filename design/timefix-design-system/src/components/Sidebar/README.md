The sidebar is the app's left column, sitting straight on the grey canvas: workspace switcher, search, destinations with counts, folding sections, and the person at the bottom, folding to a 56px rail.

**Use it for**: the one app navigation inside `AppShell`. **Don't use it for**: settings navigation (use `SettingsLayout`'s nav) or in-page sections (use `Tabs`).

**The consumer provides**: `header` (a `WorkspaceSwitcher` with name, plan, mark and its `NavMenuItem`s), `onSearch` (opens the command palette), `NavItem`s (`label`, 16px `icon` or colour `dot`, `isCurrent`, `count`, unread `badge`, `shortcut`), `NavSection`s (`title`, `onAdd`), a `footer` with `GettingStarted` (`done`, `total`) and `PersonRow` (name, email, menu items), plus `isCollapsed` and `onCollapsedChange`.

**States**: item rest (grey), hover (wash), current (white pill, hairline, shadow-xs), focus-visible, unread badge, section folded (chevron points right), menus open (trigger stays pressed), rail.

**Interaction**: each item is a link and a tab stop; menus open with Enter and move with arrows. The unread badge slides in diagonally 8px and pops from 0 on the bounce curve (transitions.dev 03, notification badge), and the item never moves. Sections fold with the accordion motion (21). The workspace and person menus grow from their trigger (05). Folding to the rail tweens the width over 250ms while labels fade; icons hold their position. Drag to reorder favourites is not built yet.

**Replaces**: Sidebar, CustomiseSidebar.
