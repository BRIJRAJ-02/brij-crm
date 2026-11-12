The app shell is the frame of every signed-in page: the sidebar on the grey canvas and one white surface, inset 8px with a 14px radius, holding a 56px top bar, an optional toolbar row and the full-width page.

**Use it for**: every app screen (Bookings, Companies, Forms). `AsideLayout` adds a 440px right panel for record previews and comments. **Don't use it for**: public booking, form and link pages, or settings (use `SettingsLayout` inside the shell).

**The consumer provides**: `AppShell` `sidebar` and children; `TopBar` `title` (a `Breadcrumbs` at `size="title"`) and `actions` (presence, Share, a "…" menu); `Toolbar` `start` (a `SegmentedControl` view switcher, Filter, Sort) and `end` (a `sm` `SearchField` with `className={TOOLBAR_SEARCH}`, one ink + New); `PageBody` for padded scrolling content; `AsideLayout` `aside`, `isAsideOpen`, `asideLabel`.

**States**: sidebar expanded or rail, aside closed or open (the chosen row keeps a pale blue wash), toolbar search empty or filled (× clears), no results.

**Interaction**: ⌘K and the sidebar's search open the command palette. Tab order runs sidebar, top bar, toolbar, content, aside. The aside's track opens over 400ms (closes over 350ms) while the panel slides 30px in (transitions.dev 07, panel reveal); the toolbar search takes the accent focus edge. Pages are full width; the toolbar scrolls sideways on narrow screens.

**Replaces**: AppShell, Toolbar, PreviewLayout, AsideLayout.

On a phone, toasts rise above the tab bar, and above a floating bar too when one is up (`--tf-toast-lift`).

**Phone**: under 40rem the top bar's title clips (overflow hidden) so its actions stay on screen.
