# TopBar, ViewBar, Toolbar and SortChip

The three bars above a view: TopBar with the page title, ViewBar with the view switcher and the view's actions, and Toolbar with the sorts and filters.

## Why it exists

Ported from the artifact's Toolbar card (ViewBar is new: the artifact drew it as a second TopBar). Every object's table and board (#20, #21) sits under these three, so the bars are built once. They hold library controls (Button, SplitButton, FilterChip, Menu, Breadcrumbs, AvatarStack) and add only the bars; the sort chip is a FilterChip.

## Use

```tsx
<TopBar title="Companies" icon="building" hue="blue" titleRef={headingRef}>
  <AvatarStack people={here} />
</TopBar>
<ViewBar views={views} currentViewId={viewId} onViewChange={openView} onCreateView={createView}>
  <Button icon="settings">View settings</Button>
</ViewBar>
<Toolbar label="View options" end={isChanged && <><Button variant="ghost">Discard changes</Button><SplitButton menu={saveMenu}>Save</SplitButton></>}>
  <SortChip attribute="Funding raised" direction="descending" onPress={openSorts} />
  <FilterChip … />
  <Button variant="dashed" icon="list-filter">Filter</Button>
</Toolbar>
```

- **TopBar**: `title` is the page's one `h1`. It takes `tabIndex -1`, so the app can move focus to it after a route change (`titleRef`) without adding a tab stop. `icon` with `hue` draws the object's tile. With `crumbs`, the trail ends with the title as its current place, and the `h1` stays for screen readers. `meta` sits beside the title; `children` at the end. `isLoading` is the page still loading: after the loading delay a skeleton line (ViewBar's loading line) stands in for the icon and title, the bar keeps its `size-bar` height and is marked busy, and the `h1` keeps `title` ("Loading") for screen readers and focus. Why a variant: a page's pending state had no bar at all, so the page jumped down by a bar's height when it arrived; leaving `title` empty would have left an empty heading.
- **ViewBar**: the switcher is a ghost button naming the current view; its menu marks the current one and ends with Create view when `onCreateView` is given. A `ViewChoice` with a `section` is listed under that heading (Menu's own `MenuSection`), in the order the sections first appear, after the choices with none; `isLocked` shows the `lock` icon in place of the view's own, on the button and in the menu, and "Locked" at the end of its menu item, which screen readers hear too. Why a variant: the switcher must show private views apart and mark locked ones (spec 0020, milestone 2), and both are the same switcher with more facts, not a second component. `isLoading` shows a skeleton until the views arrive. `children` sit at the end: View settings and the Table and Board switch, nothing more (the owner, 21 October 2026: the bar had four things at its end).
- `actions` are the current view's own (Rename, Duplicate, Copy link, Make private, Lock, Set as default, Delete view) under a "This view" heading at the end of the switcher's menu, after Create view, run by `onAction(id)`; `startsGroup` puts a hairline before one, a `reason` disables it and says why, `isDanger` reds it. They are plain menu items (the section takes no selection), not choices like the views above them. Why a variant: the view menu was a "···" button of its own in the bar; the owner asked for one quiet bar, and a view's actions belong with the views (Notion's and Attio's view menus hold them the same way). The caller leaves out what can never apply to this view, and keeps a disabled item only where the person could act after a change.
- **Toolbar**: a React Aria toolbar named by `label`. `status` is spoken to screen readers when it changes and never shown: what the view's filter now matches ("124 people match", spec 0020 AC-487). Why a variant: a filter change moves the rows and the count with no other word for a screen reader, and only the bar that holds the filter knows when to say it. The start states the view's condition (SortChips, FilterChips, the dashed Filter); `end` shows only while the view has unsaved changes: Discard changes (ghost) and Save (split primary), the one blue action.
- **SortChip**: the sort in the filter chips' shape, a FilterChip with no styles of its own: the direction's arrow and the attribute, the direction in words ("descending"), "+N" for further sorts, and remove (`onRemove` takes every sort away; without it there is none). Every part opens the sort builder. The group is named in full ("Sort: Funding raised, descending, and 1 more"), its remove "Remove sort" or "Remove sorts". `ref` reaches the chip, so the screen can anchor the builder's Popover to it. Why: the owner asked for sorts and filters to read and look alike (spec 0020, milestone 2); the one button "Sorted by Funding raised +1" it replaced had its own CSS.

## States

Bars: with and without actions; the views loading; the page loading (TopBar). ViewBar: grouped (a Private section) and locked choices. Toolbar: with unsaved changes (Save shows) and without. SortChip: FilterChip's states (hover and focus per part), with more sorts, a long name, and read only (no remove part).

## Keyboard

Tab reaches the switcher and each action in the bars. Tab enters the toolbar once, and the left and right arrows move between its controls. The switcher's menu opens with Enter, Space or the down arrow.

## Differences from the artifact

- `TopBar` names its title `title`, and its end slot is `children`; `crumbs`, `titleRef` and `isLoading` are new.
- `ViewBar` is new, replacing the second TopBar the artifact drew for the view bar.
- `Toolbar`'s end slot is `end`, so the unsaved changes sit apart from the view's condition.
- `SortChip` takes `attribute`, `direction` and `more` rather than its text as children, and is drawn as a FilterChip.
