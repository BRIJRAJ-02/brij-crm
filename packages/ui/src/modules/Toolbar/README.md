# TopBar, ViewBar, Toolbar and SortChip

The three bars above a view: TopBar with the page title, ViewBar with the view switcher and the view's actions, and Toolbar with the sorts and filters.

## Why it exists

Ported from the artifact's Toolbar card (ViewBar is new: the artifact drew it as a second TopBar). Every object's table and board (#20, #21) sits under these three, so the bars are built once. They hold library controls (Button, SplitButton, FilterChip, Menu, Breadcrumbs, AvatarStack) and add only the bars; the sort chip is a FilterChip.

## Use

```tsx
<TopBar title="Companies" icon="building" hue="blue" titleRef={headingRef}>
  <AvatarStack people={here} />
</TopBar>
<ViewBar
  views={views} currentViewId={viewId} onViewChange={openView} onCreateView={createView}
  actions={viewActions} onAction={runViewAction}
  settings={{ onPress: openSettings, ref: settingsRef, isOpen }}
  layout={{ label: 'Layout', segments: [{ value: 'table', label: 'Table', icon: 'table' }, { value: 'board', label: 'Board', icon: 'kanban' }], value: kind, onChange: setKind }}
>
  {isLocked && <Callout placement="bar">Locked by Ada</Callout>}
</ViewBar>
<Toolbar label="View options" end={isChanged && <><Button variant="ghost">Discard changes</Button><SplitButton menu={saveMenu}>Save</SplitButton></>}>
  <SortChip attribute="Funding raised" direction="descending" onPress={openSorts} />
  <FilterChip … />
  <Button variant="dashed" icon="list-filter">Filter</Button>
</Toolbar>
```

- **TopBar**: `title` is the page's one `h1`. It takes `tabIndex -1`, so the app can move focus to it after a route change (`titleRef`) without adding a tab stop. `icon` with `hue` draws the object's tile. With `crumbs`, the trail ends with the title as its current place, and the `h1` stays for screen readers. `meta` sits beside the title; `children` at the end. `isLoading` is the page still loading: after the loading delay a skeleton line (ViewBar's loading line) stands in for the icon and title, the bar keeps its `size-bar` height and is marked busy, and the `h1` keeps `title` ("Loading") for screen readers and focus. Why a variant: a page's pending state had no bar at all, so the page jumped down by a bar's height when it arrived; leaving `title` empty would have left an empty heading.
- **ViewBar**: the switcher is a ghost button naming the current view; its menu marks the current one with a check (a view's own icon shows only for a lock or a chosen icon, so a row never carries a check and a grid both) and ends its first group with Create view when `onCreateView` is given. A `ViewChoice` with a `section` is listed under that heading (Menu's own `MenuSection`), in the order the sections first appear, after the choices with none; `isLocked` shows the `lock` icon in place of the view's own, on the button and in the menu, and "Locked" at the end of its menu item, which screen readers hear too. Why a variant: the switcher must show private views apart and mark locked ones (spec 0020, milestone 2), and both are the same switcher with more facts, not a second component. `isLoading` shows a skeleton until the views arrive. The end of the bar is drawn by the bar itself, on one `size-control` line (the owner, 22 October 2026: three loose ghost buttons and a taller switch looked odd): `children` first (notices only: the lock line, a paused connection), then `settings`, one secondary View settings button with the hairline keycap edge (`isOpen` marks it expanded, `ref` anchors the screen's popover), then `layout`, Table or Board as a compact SegmentedControl, `space-8` apart. Why props, not children: every object and list gets the same end, the same heights and the same phone behaviour without each page arranging it. Add attribute is not in the bar; it lives under View settings and in the table's "+" column. Without `views` (a page with no saved views: Booking pages and Forms, spec 0034), the bar holds the page's tools at its end and no switcher. Why a variant: those list pages stand in People's chrome (the owner, 21 October 2026: "to reduce page shifts"), and when Captures' Links and Forms tabs became pages of their own, the tab strip that held their search went with them; an empty tab list isn't a tablist, and this keeps the page's content where an object's view starts.
- `actions` are the current view's own (Attio keeps them in the view's dropdown the same way) (Rename, Duplicate, Copy link, Make private, Lock, Set as default, Delete view) in the menu's second group, after one hairline (the views and Create view are the first; owner items 51 and 55, 31 October 2026: no heading and no further dividers), run by `onAction(id)`; `startsGroup` is kept for callers but draws nothing now, a `reason` disables it and says why, `isDanger` reds it. They are plain menu items (the section takes no selection), not choices like the views above them. Why a variant: the view menu was a "···" button of its own in the bar; the owner asked for one quiet bar, and a view's actions belong with the views (Notion's and Attio's view menus hold them the same way). The caller leaves out what can never apply to this view, and keeps a disabled item only where the person could act after a change. An action with `choices` is a submenu of states, the current one checked, chosen as `onAction('<id>/<choice id>')`: Who can see it (Only me, Everyone, Everyone with only admins editing). Why a variant: sharing and locking were three separate items (Share, Make private, Lock or Unlock); one choice of three states says where the view stands (30 October 2026). A `ViewChoice` with `isMovable` moves by keyboard (Alt with an arrow) through `onMoveView`, in place of the Move up and Move down items that went the same day.
- **Toolbar**: a React Aria toolbar named by `label`. `status` is spoken to screen readers when it changes and never shown: what the view's filter now matches ("124 people match", spec 0020 AC-487). Why a variant: a filter change moves the rows and the count with no other word for a screen reader, and only the bar that holds the filter knows when to say it. The start states the view's condition (SortChips, FilterChips, the dashed Filter); `end` shows only while the view has unsaved changes: Discard changes (ghost) and Save (split primary), the one blue action.
- **SortChip**: the sort in the filter chips' shape, a FilterChip with no styles of its own: one compact chip, the direction's arrow and the attribute (owner item 40, 31 October 2026: the direction in words split it into three boxes), "+N" for further sorts, and remove (`onRemove` takes every sort away; without it there is none). Every part opens the sort builder. The group is named in full ("Sort: Funding raised, descending, and 1 more"), its remove "Remove sort" or "Remove sorts". `ref` reaches the chip, so the screen can anchor the builder's Popover to it. Why: the owner asked for sorts and filters to read and look alike (spec 0020, milestone 2); the one button "Sorted by Funding raised +1" it replaced had its own CSS. `isDefault` is the order nobody chose (a view with no sorts runs Created at, newest first): FilterChip's `muted` tone reading "Sorted by Created at", no direction part and no remove, every part still opening the builder. Why a variant: with no chip at all the order was a mystery (the CRM flow pass, 30 October 2026; Attio states its default order the same way), and a normal chip would have read as a choice someone made, with a remove that does nothing.
- **ToolbarSearch**, in Toolbar's `search` slot (after the sorts and filters, before `end`): Field's `search` variant from the start, its placeholder the `label` ("Search people"), compact until it is focused or holds text, when it widens (`duration-move`); Esc clears the text and keeps focus. Owner item 50, 31 October 2026: the lone magnifier at the bar's far end read as nothing. No `/` shortcut: `/` already opens the command menu's search everywhere. The screen narrows its view by `value` and never saves it. Why new: a view had no quick way to find one record by name, and the bar's only search was a page's own; why in this module: it belongs to the Toolbar's end and nowhere else.
- The switcher's menu gets Menu's search field ("Search views") once it lists eight views or more, so a long list narrows as you type.

## States

Bars: with and without actions; the views loading; the page loading (TopBar). ViewBar: grouped (a Private section) and locked choices; tools only (no switcher); its end with Table chosen, with Board chosen and View settings open beside a lock line, disabled (`isDisabled` on `settings` and `layout`), by keyboard, and on a phone. Toolbar: with unsaved changes (Save shows) and without. SortChip: FilterChip's states (hover and focus per part), with more sorts, a long name, and read only (no remove part).

On a phone (21 October 2026): TopBar is a size container, so its Breadcrumbs show only the current place under 480px; ViewBar is a size container: under 480px View settings and Table or Board show their icons alone (`isLabelCollapsible` on Button and SegmentedControl), keeping their names, and should it still be too narrow the bar scrolls sideways on its own, never the page.

## Keyboard

Tab reaches the switcher and each action in the bars: in the view bar the switcher, View settings, then the chosen layout, where the arrow keys switch Table and Board. Tab enters the toolbar once, and the left and right arrows move between its controls. The switcher's menu opens with Enter, Space or the down arrow; in it, Alt with Up or Down moves a view marked `isMovable` up or down its group (`onMoveView`), focus staying on it.

## Differences from the artifact

- `TopBar` names its title `title`, and its end slot is `children`; `crumbs`, `titleRef` and `isLoading` are new.
- `ViewBar` is new, replacing the second TopBar the artifact drew for the view bar.
- `Toolbar`'s end slot is `end`, so the unsaved changes sit apart from the view's condition.
- `SortChip` takes `attribute`, `direction` and `more` rather than its text as children, and is drawn as a FilterChip.
