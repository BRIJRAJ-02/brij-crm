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
  footer={<><NavItem icon="user-plus" onPress={invite}>Invite teammates</NavItem><ThemeSwitch controller={context.theme} isCompact /></>}
>
  <NavItem icon="square-check" href="/tasks" badge={3}>Tasks</NavItem>
  <NavSection title="Records">
    <NavItem icon="building" hue="blue" href="/companies" isCurrent>Companies</NavItem>
  </NavSection>
</Sidebar>
```

- It is the navigation landmark (`<nav>`, "Main navigation", or `label`).
- `NavItem` is a routed link with `href` (`isCurrent` adds `aria-current="page"`), or a button with `onPress` (Invite teammates). Record objects and lists pass `hue` for their tile; a list may pass its emoji as `leading`. `meta` names a favourite's object; `badge` is for counts that need action, never totals.
- `NavSection` folds under its label. `isLoading` draws skeleton rows after the loading delay; `emptyLabel` says what goes there when it has no items.
- `onQuickActions` shows Quick actions with its ⌘K keycap. The screen answers the shortcut itself.
- `isCollapsed` makes it a `size-sidebar-collapsed` rail: icons only, each named in a tooltip, sections drawn as groups under a hairline, and the expand button at the bottom. `onCollapsedChange` shows the collapse and expand buttons. The app shell folds it below `bp-page-compact`.
- The footer carries `ThemeSwitch` (compact), as the artifact's card does.

## States

The current item takes `surface-selected`; hover (pointer only) `surface-hover`; focus the inset ring. Sections: open, folded, loading (skeletons) and empty. Collapsed. In forced colours, the current item is outlined in `Highlight`.

## Keyboard

Tab moves through the workspace switcher, the collapse button, Quick actions, each item and each section label. Enter follows a link or presses a button; Enter or Space folds a section.

## Differences from the artifact

- `workspace` is the name; the switcher is the `Menu` you pass as `workspaceMenu`, which the name opens.
- `search` became `onQuickActions`: the row shows only when the screen opens a palette.
- `current` became `isCurrent`, and `NavItem` takes `href` or `onPress`.
- New: the collapsed rail, section loading and empty states.
