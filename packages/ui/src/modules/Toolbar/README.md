# TopBar, ViewBar, Toolbar and SortChip

The three bars above a view: TopBar with the page title, ViewBar with the view switcher and the view's actions, and Toolbar with the sorts and filters.

## Why it exists

Ported from the artifact's Toolbar card (ViewBar is new: the artifact drew it as a second TopBar). Every object's table and board (#20, #21) sits under these three, so the bars are built once. They hold library controls (Button, SplitButton, FilterChip, Menu, Breadcrumbs, AvatarStack) and add only the bars and the sort chip.

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

- **TopBar**: `title` is the page's one `h1`. It takes `tabIndex -1`, so the app can move focus to it after a route change (`titleRef`) without adding a tab stop. `icon` with `hue` draws the object's tile. With `crumbs`, the trail ends with the title as its current place, and the `h1` stays for screen readers. `meta` sits beside the title; `children` at the end.
- **ViewBar**: the switcher is a ghost button naming the current view; its menu marks the current one and ends with Create view when `onCreateView` is given. `isLoading` shows a skeleton until the views arrive. `children` sit at the end: View settings, Import / Export, the Table and Board switch.
- **Toolbar**: a React Aria toolbar named by `label`. The start states the view's condition (SortChips, FilterChips, the dashed Filter); `end` shows only while the view has unsaved changes: Discard changes (ghost) and Save (split primary), the one blue action.
- **SortChip**: "Sorted by Funding raised", with the direction's arrow and "+N" for further sorts. It is a button named for screen readers in full ("Sorted by Funding raised, descending, and 1 more") that opens the sort builder.

## States

Bars: with and without actions; the views loading. Toolbar: with unsaved changes (Save shows) and without. SortChip: hover (pointer only), focus (accent edge and ring), pressed (scales to `scale-press`).

## Keyboard

Tab reaches the switcher and each action in the bars. Tab enters the toolbar once, and the left and right arrows move between its controls. The switcher's menu opens with Enter, Space or the down arrow.

## Differences from the artifact

- `TopBar` names its title `title`, and its end slot is `children`; `crumbs` and `titleRef` are new.
- `ViewBar` is new, replacing the second TopBar the artifact drew for the view bar.
- `Toolbar`'s end slot is `end`, so the unsaved changes sit apart from the view's condition.
- `SortChip` takes `attribute`, `direction` and `more` rather than its text as children.
