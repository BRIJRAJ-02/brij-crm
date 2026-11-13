# Sidebar, NavItem and NavSection

The app's left column: the workspace switcher, Quick actions, the fixed destinations, and folding Favorites, Records and Lists sections.

## Why it exists

Ported from the artifact's Sidebar card. Every screen inside the app shell (#10 onwards) sits beside it, so it is built once here. Its sections reuse `Disclosure` (its `label` variant), its buttons `Button`, its counts `Badge` and its object marks `Icon`'s hue tiles, so it adds layout and the nav item row and nothing else.

## Use

```tsx
<Sidebar
  workspace="Brightline"
  workspaceMenu={<Menu label="Workspaces">…</Menu>}
  onQuickActions={openPalette}
  isCollapsed={isCollapsed}
  onCollapsedChange={setCollapsed}
  footer={({ isCollapsed }) => (
    <>
      <NavItem icon="user-plus" onPress={invite}>
        Invite teammates
      </NavItem>
      <NavItem icon="settings" href="/settings" kbd="⌘,">
        Settings
      </NavItem>
    </>
  )}
>
  <NavItem icon="square-check" href="/tasks" badge={3}>
    Tasks
  </NavItem>
  <NavSection title="Records">
    <NavItem icon="building" hue="blue" href="/companies" isCurrent>
      Companies
    </NavItem>
  </NavSection>
</Sidebar>
```

- It is the navigation landmark (`<nav>`, "Main navigation", or `label`).
- `NavItem` is a routed link with `href` (`isCurrent` adds `aria-current="page"`), or a button with `onPress` (Invite teammates). Record objects and lists pass `hue` for their tile; a list may pass its emoji as `leading`. `meta` names a favourite's object, or where a link leads ("In Captures"); on the rail, where it has no room, it joins the name and the tooltip ("Booking pages · In Captures"); `badge` is for counts that need action, never totals. `alert` (words for screen readers) puts a small red dot after the name: something there needs a fix (the booking page editor's sections, through SettingsNav, 9 November 2026).
- `NavSection` folds under its label. `isFolded` with `onFoldChange` keeps the fold where the screen says: the app stores each member's folds on the server, so they follow the person to every device (spec 0034, AC-931); without them the section folds on its own (`defaultExpanded`). Why props and not a variant: the fold is the same Disclosure, only owned by the screen. `isLoading` draws skeleton rows after the loading delay, and on the rail a `tile` Skeleton where each icon will go, so a folded sidebar shows it is loading too (it used to stay blank); `emptyLabel` says what goes there when it has no items.
- `add` (`{ label, onAdd }`) puts a quiet "+" after a section's label that makes something in it: Lists' "New list" (spec 0048, AC-4801). Why a prop: the section's label row is the section's own, where only it can place a button; it is the same ghost Button the menu uses, so it needs no new style. Leave it out where the viewer may not make one. With no items, the section's body shows the same action as a visible `NavItem` row (a plus, then the label) in place of `emptyLabel`, a 32px target like the items it stands in for, since the label row's actions show only on hover or focus; the rail draws neither.
- `NavGroup` sets fixed destinations apart after the sections without a label on screen (Bookings and Captures after Records): a section's space above it open, the same space with no hairline on the rail (a rule only where the open sidebar shows a label), and `role="group"` named by `label` for screen readers. Why a new part: a bare `NavItem` after a section sat flush under its last item and read as one of its rows, and a `NavSection` would add a label and a fold these destinations don't want.
- `mark` replaces the workspace's letter avatar with the product's mark (the app passes Timefix's `ProviderMark` at `lg`, F29), as timefix heads its sidebar; it is decoration, so the switcher keeps the workspace's name, and its menu works as before.
- `logo` is the workspace's own logo (Settings › Brand, spec 0060), a picture on our origin that heads the switcher in place of `mark`. It is drawn through `Avatar`'s `contain` fit, the whole picture inside the mark's square on a light plate (the same in both themes, so dark ink reads on the dark sidebar): a wide wordmark is letterboxed, smaller but with every letter, rather than cropped to its middle (a crop cuts letters, and a wider head would move the name for one workspace and not another). While it loads or if it fails, the workspace's letter holds the square. Stories: `WorkspaceLogo`, `WorkspaceWordmark`, `CollapsedWorkspaceLogo`, `WorkspaceLogoFailed`.
- `isWorkspaceLoading` draws the workspace's mark and name as skeletons (after the loading delay, so a quick load flashes nothing), with no menu, while its name isn't known, so no stand in name (the product's) flashes before the real one.
- The workspace button is named "<workspace>, workspace menu". `isWorkspaceBusy` says something chosen from that menu is under way (signing out, once the menu has closed): a `Spinner` named by `workspaceBusyLabel` replaces the chevron (the mark, on the rail), and the button ignores presses while staying focusable. Why: the menu closes on the choice, so without it nothing on screen said the sign out was happening.
- `onQuickActions` shows Quick actions with its ⌘K keycap; on the rail, a search item like the rest, its shortcut in the tooltip ("Quick actions ⌘K") rather than a keycap squeezed in. The screen answers the shortcut itself.
- `isCollapsed` makes it a `size-sidebar-collapsed` rail: plain icons only, one size and one style (an object's hue tile is the open sidebar's), each in a `size-nav-item` square named in a tooltip (with its shortcut, where it has one; the workspace mark names the workspace), the current one in `surface-selected` as when open. Sections draw as groups under a hairline (the first under the head's own), unlabelled groups with space only, and Expand sits at the top under the head, where Collapse is when open, then Quick actions, both items like the rest. The footer's items keep their order and size. `onCollapsedChange` shows the collapse and expand buttons, and `collapseKbd` (the app's `[`) puts their key in their tooltips as a keycap (30 October 2026). A rail item's tooltip shows its shortcut through Tooltip's `kbd`, not as text. The app shell folds it below `bp-page-compact`.
- The footer holds the Settings entry (`NavItem` with `kbd="⌘,"`, spec 0026) and Help (owner, 22 October 2026: the trash left the workspace menu, then the sidebar, for Settings › Workspace and ⌘K; Invite joins with spec 0031). `kbd` shows a soft keycap after an item's name (hidden from its accessible name and stated as `aria-keyshortcuts` instead, and left off on the rail); the screen answers the shortcut itself. The theme switch left the app's footer for Settings › Preferences (spec 0026), though the footer can still hold a compact `ThemeSwitch`, as the artifact's card does. `footer` may be a function of `{ isCollapsed }`, true whenever the sidebar is a rail (by `isCollapsed`, or folded by the app shell below `bp-page-compact`, which the screen can't see), so the footer fits the rail: the ThemeSwitch stacks (`orientation="vertical"`).

## The settings variant (spec 0026)

```tsx
<Sidebar heading="Settings" back={{ label: 'Leave settings', href: from }} label="Settings" keyboard="arrows">
  <NavGroup label="Account" isLabelShown>
    <NavItem icon="sliders-horizontal" href="/settings/account/preferences" isCurrent>
      Preferences
    </NavItem>
  </NavGroup>
</Sidebar>
```

- The head (the workspace row, or the settings variant's back link and title) is `size-topbar` tall. It drew a `border-subtle` hairline level with the page's `TopBar` (owner, 20 October 2026) until spec 0072: the page now sits on its own inset surface (AppShell), so the sidebar has no rules of its own, as the prototype draws it.
- `heading` with `back` replaces the workspace row: a ghost `ButtonLink` (arrow left, named by `back.label`, which is also its tooltip) back to where the person came from, then the title as plain text (not a heading: it comes before the page's h1, and `label` names the landmark). On the rail, the back link alone. The `workspace*` props don't apply.
- `NavGroup` with `isLabelShown` puts its label on screen in a section label's type, with no fold: settings groups are short and always open. On the rail it draws as a group under a hairline, its label left to its name.
- `find` puts a field under the head, the sidebar's width, where Quick actions sits in the app's variant: the settings variant's "Find a setting" (a `Field` with `variant="search"`, 5 November 2026, as Vercel's and Linear's settings). The screen filters its own items as the person types; the sidebar places the field, moves focus from it to the list's first item on Down, and leaves it off on the rail. Why a prop: the head and the body are the sidebar's, and a field dropped into the body would scroll away with the items it filters.
- Inside an AppShell with `phoneSidebar="full"` on a phone, the sidebar is open (never the rail) and the whole screen wide, with no hairline at its end: a phone's settings list.
- `keyboard="arrows"` makes the body one tab stop (a roving tab index): the item focused while focus is inside, else the current page's, else the first. Up and Down move between items, Home and End jump to the ends, and Tab leaves the list in one press. The nav carries `data-keyboard="arrows"`, so the app can leave focus in it after a route change. Why: the settings list is a navigation the person moves through often, and AC-687 asks for arrow keys inside it and Tab past it. The app's own sidebar keeps `tab`.
- Why a variant and not a second navigation: the settings navigation is the same rows, groups, rail and states as the app's sidebar; only the head and the groups' labels differ.

## Customising (spec 0034)

- `menu` on a `NavSection` puts a quiet "<Title> options" button after its label (Move up, Move down, Customise sidebar); `menu` on a `NavItem` a "More for <Name>" button after the name (Hide from sidebar, Remove from favourites). Both show on hover or focus (always to the keyboard, and on touch); neither shows on the rail. Disclosure's `actions` holds the section's.
- `onReorder` makes a section's items reorder (each `NavItem` needs an `id`): a grip (`DragHandle` with `drag`) after the name moves the item through the library's drag wrapper (dnd-kit): dragged, the others slide out of its way; from the keyboard Space lifts it, the arrows move it, Space drops it and Esc puts it back, each step announced ("Deals, moved to position 2 of 5"). Items never leave their section. The screen is told the item and its place among the items shown.
- `onMoveSection` with `position` (`{ index, count }`) gives the section a grip (`DragHandle`'s `manual` variant) after its label that moves it among the sections: dragged, a drop line marks where it lands and Esc puts it back; from the keyboard, with the same keys as items.
- Why sections keep their own grip: each `NavSection` knows only its own place (`position`), and no one list holds the sections, so the drag wrapper (which sorts one list) has nothing to wrap. Items moved to it with the library's other lists.

## States

The current item is a `surface` pill lifted by `shadow-xs` and a hairline (`surface-selected` for a NavItem outside a Sidebar, SettingsNav's); hover (pointer only) `surface-hover`; pressed `surface-selected`; focus the outline ring just inside the item. The workspace switcher stays `surface-selected` while its menu is open. Sections: open, folded, loading (skeleton rows, or tile marks on the rail) and empty. Reordering: an item or section lifted (its grip in the accent, the order previewed), and the drop line while dragging. Menus: shown on hover, focus or while open. Collapsed. Workspace busy (a spinner on the workspace button, in place of the mark on the rail). In forced colours, the current item is outlined in `Highlight`.

## Keyboard

Tab moves through the workspace switcher, the collapse button, Quick actions, each item and each section label (then its grip and menu). An item's grip and More are not tab stops: Tab goes item to item, one stop each, and from an item Right moves to its grip and then its More, Left back, Escape back to the item; they show while the item holds focus, as on hover, and the item states `aria-keyshortcuts="ArrowRight"` so a screen reader says how (forms fixes 2; a pointer and touch are unchanged). Why: a sidebar of a dozen reorderable items with menus was some 40 tab stops. On a grip: Space or Enter lifts, the up and down arrows move, Space or Enter drops, Esc puts it back. Enter follows a link or presses a button; Enter or Space folds a section (with `onFoldChange`, the screen is told and keeps it). With `keyboard="arrows"`, the items are one tab stop and the arrow keys, Home and End move between them.

## Differences from the artifact

- `workspace` is the name; the switcher is the `Menu` you pass as `workspaceMenu`, which the name opens.
- A `NavItem` with `onPress` renders a plain React Aria Button, so it may be a `MenuTrigger`'s trigger: a switcher inside a section, such as the Business group's business switcher (spec 0065 H7), opens its `Menu` from the row, with `aria-haspopup` and focus back on close.
- `search` became `onQuickActions`: the row shows only when the screen opens a palette.
- `current` became `isCurrent`, and `NavItem` takes `href` or `onPress`.
- New: `NavGroup` (with `isLabelShown`), the settings variant (`heading`, `back`, `keyboard`), `NavItem`'s `kbd`, the collapsed rail, section loading and empty states, and `footer` as a function of the folded state.

## Timefix prototype (spec 0072)

Takes its look from the prototype's Sidebar, which also replaces CustomiseSidebar. The column sits straight on `canvas` with no edge of its own; the page beside it is AppShell's inset surface. Items are `size-nav-item` pills (`radius-full`), `space-12` in at the start and `space-8` at the end, icon and label `space-12` apart, the label `text-body-strong` in `text-secondary`. Hover (pointer only) washes `surface-hover` and brings the label up to `text`; a press washes `surface-selected`; the current page is a `surface` pill with `text`, lifted by `shadow-xs` and a `control-border` hairline ring (the prototype's ring is `border-subtle`, about 1.1:1 on the canvas; `control-border` holds 3:1 and more in both themes, so the current page reads without its text colour, as SegmentedControl's chosen pill does). A NavItem outside the sidebar (SettingsNav in a page) keeps a `surface-selected` pill with the same ring. Items sit `space-2` apart. Colour and the current pill's ring move over `duration-quick` on `ease-smooth-out`, on an item and on an item's row (with its grip and menu) alike, and a press washes the row too (a fade, so it stays under reduced motion). Focus is the outline ring (`border-width-focus`, `focus-ring`), offset inward by its own width because the body clips. The sidebar's head lines up with the page's TopBar: AppShell insets the sidebar by the card's own inset. The workspace switcher is `radius-md`, its name `text-body-strong` (the settings variant's heading `text-heading`, a step above its items), and stays `surface-selected` while its menu is open. A group's label, a folding section's label (Disclosure's `label` variant), the empty line and the loading rows are `space-12` in, where the items' icons start, the labels `text-label` in `text-tertiary`; an item's `meta` is `text-caption` in `text-tertiary`. In forced colours the current item keeps its `Highlight` outline, which gives way to the focus ring while it has focus.

**Use it for** the one app navigation inside AppShell, and the settings variant (`heading`, `back`). **Don't use it for** in-page sections (Tabs) or an editor's list of its own sections (SettingsLayout's `SettingsNav`, which draws these same NavItems with a `surface-selected` current pill).

**The consumer provides** `workspace`, `workspaceMenu`, `mark` or `logo`, `onQuickActions`, `isCollapsed` with `onCollapsedChange` and `collapseKbd`, `footer`, and the children: `NavItem` (`icon`, `hue`, `href` with `isCurrent`, or `onPress`, `badge`, `meta`, `kbd`, `alert`, `menu`, `id`), `NavSection` (`title`, `add`, `menu`, `isFolded` with `onFoldChange`, `onReorder`, `onMoveSection`) and `NavGroup`.

**States**: item rest, hover (`ItemHover`), pressed (`ItemPressed`), current, focus visible (`Keyboard`), unread count (`Default`'s Tasks), section folded (`KeptFold`, `SectionMenuAndFold`), menu open with the switcher pressed (`WorkspaceMenu`, `ItemMenu`), rail (`Collapsed`), loading, empty, busy, reordering.

**Differences from the prototype**
- Kept library behaviour the prototype lacks: the settings variant, `NavGroup`, `find`, `keyboard="arrows"`, reordering items and sections, item and section menus, the workspace logo and busy state, loading and empty sections, `alert`, `meta`, and `footer` as a function of the rail. A NavItem outside a Sidebar keeps a `surface-selected` current pill, the prototype's SettingsLayout nav.
- Prop names: the prototype's `WorkspaceSwitcher` is `workspace` with `workspaceMenu`; `onSearch` is `onQuickActions`; `count` and `badge` are both `badge` (a Badge count; the prototype's quiet count and its accent unread dot are one part here); `shortcut` is `kbd`; `dot` is `hue` (a tile) or `leading`; `NavSection`'s `onAdd` is `add`.
- Owed to the shell phase (4): the 56px rail (the library's `size-sidebar-collapsed` is 48) and its width tween with labels fading in place (the library swaps the rail's markup); the search pill (Quick actions is a `lg` secondary Button); the switcher's `size-row` height with the plan line under the name (no `plan` prop); the unread badge's slide and pop (transitions.dev 03, Badge's); the scroll edge hairlines (they need a scroll listener); Getting started and the person row (the footer is the screen's); a section's chevron that shows on hover (Disclosure's label variant draws the section titles).
