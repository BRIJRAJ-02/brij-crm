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
- `NavItem` is a routed link with `href` (`isCurrent` adds `aria-current="page"`), or a button with `onPress` (Invite teammates). Record objects and lists pass `hue` for their tile; a list may pass its emoji as `leading`. `meta` names a favourite's object, or where a link leads ("In Captures"); on the rail, where it has no room, it joins the name and the tooltip ("Booking pages · In Captures"); `badge` is for counts that need action, never totals.
- `NavSection` folds under its label. `isLoading` draws skeleton rows after the loading delay, and on the rail a `tile` Skeleton where each icon will go, so a folded sidebar shows it is loading too (it used to stay blank); `emptyLabel` says what goes there when it has no items.
- `NavGroup` sets fixed destinations apart after the sections without a label on screen (Bookings, Captures and Trash after Records): a section's space above it open, a section's hairline on the rail, and `role="group"` named by `label` for screen readers. Why a new part: a bare `NavItem` after a section sat flush under its last item and read as one of its rows, and a `NavSection` would add a label and a fold these destinations don't want.
- `mark` replaces the workspace's letter avatar with the product's mark (the app passes Timefix's `ProviderMark` at `lg`, F29), as timefix heads its sidebar; it is decoration, so the switcher keeps the workspace's name, and its menu works as before.
- `isWorkspaceLoading` draws the workspace's mark and name as skeletons (after the loading delay, so a quick load flashes nothing), with no menu, while its name isn't known, so no stand in name (the product's) flashes before the real one.
- The workspace button is named "<workspace>, workspace menu". `isWorkspaceBusy` says something chosen from that menu is under way (signing out, once the menu has closed): a `Spinner` named by `workspaceBusyLabel` replaces the chevron (the mark, on the rail), and the button ignores presses while staying focusable. Why: the menu closes on the choice, so without it nothing on screen said the sign out was happening.
- `onQuickActions` shows Quick actions with its ⌘K keycap. The screen answers the shortcut itself.
- `isCollapsed` makes it a `size-sidebar-collapsed` rail: icons only, each named in a tooltip, sections drawn as groups under a hairline (the first under the head's own), and the expand button at the bottom. `onCollapsedChange` shows the collapse and expand buttons. The app shell folds it below `bp-page-compact`.
- The footer holds Invite, help and the Settings entry (`NavItem` with `kbd="⌘,"`, spec 0026). `kbd` shows a soft keycap after an item's name (hidden from its accessible name and stated as `aria-keyshortcuts` instead, and left off on the rail); the screen answers the shortcut itself. The theme switch left the app's footer for Settings › Preferences (spec 0026), though the footer can still hold a compact `ThemeSwitch`, as the artifact's card does. `footer` may be a function of `{ isCollapsed }`, true whenever the sidebar is a rail (by `isCollapsed`, or folded by the app shell below `bp-page-compact`, which the screen can't see), so the footer fits the rail: the ThemeSwitch stacks (`orientation="vertical"`).

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

- The head (the workspace row, or the settings variant's back link and title) is `size-bar` tall with a `border-subtle` hairline under it, the same height and line as the page's `TopBar`, so the two read as one line across the sidebar and the page (owner, 20 October 2026).
- `heading` with `back` replaces the workspace row: a ghost `ButtonLink` (arrow left, named by `back.label`, which is also its tooltip) back to where the person came from, then the title as plain text (not a heading: it comes before the page's h1, and `label` names the landmark). On the rail, the back link alone. The `workspace*` props don't apply.
- `NavGroup` with `isLabelShown` puts its label on screen in a section label's type, with no fold: settings groups are short and always open. On the rail it draws as an unlabelled group (the label stays its name).
- `keyboard="arrows"` makes the body one tab stop (a roving tab index): the item focused while focus is inside, else the current page's, else the first. Up and Down move between items, Home and End jump to the ends, and Tab leaves the list in one press. The nav carries `data-keyboard="arrows"`, so the app can leave focus in it after a route change. Why: the settings list is a navigation the person moves through often, and AC-687 asks for arrow keys inside it and Tab past it. The app's own sidebar keeps `tab`.
- Why a variant and not a second navigation: the settings navigation is the same rows, groups, rail and states as the app's sidebar; only the head and the groups' labels differ.

## States

The current item takes `surface-selected`; hover (pointer only) `surface-hover`; focus the inset ring. Sections: open, folded, loading (skeleton rows, or tile marks on the rail) and empty. Collapsed. Workspace busy (a spinner on the workspace button, in place of the mark on the rail). In forced colours, the current item is outlined in `Highlight`.

## Keyboard

Tab moves through the workspace switcher, the collapse button, Quick actions, each item and each section label. Enter follows a link or presses a button; Enter or Space folds a section. With `keyboard="arrows"`, the items are one tab stop and the arrow keys, Home and End move between them.

## Differences from the artifact

- `workspace` is the name; the switcher is the `Menu` you pass as `workspaceMenu`, which the name opens.
- `search` became `onQuickActions`: the row shows only when the screen opens a palette.
- `current` became `isCurrent`, and `NavItem` takes `href` or `onPress`.
- New: `NavGroup` (with `isLabelShown`), the settings variant (`heading`, `back`, `keyboard`), `NavItem`'s `kbd`, the collapsed rail, section loading and empty states, and `footer` as a function of the folded state.
