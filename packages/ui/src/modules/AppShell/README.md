# AppShell

The frame every screen inside the app sits in: the sidebar, then the three bars over the view, with an optional side panel.

## Why it exists

New. The artifact composed its screens by hand from the shell pieces; every screen from #10 on needs the same frame, the same landmarks and the same narrow behaviour, so it is built once. It only lays out what you pass (Sidebar, TopBar, ViewBar, Toolbar, a panel) and adds the skip link.

## Use

```tsx
<AppShell
  sidebar={<Sidebar workspace="Brightline" …>…</Sidebar>}
  topBar={<TopBar title="Companies" icon="building" hue="blue" />}
  viewBar={<ViewBar … />}
  toolbar={<Toolbar label="View options">…</Toolbar>}
  panel={record === undefined ? undefined : <RecordPanel … />}
>
  <DataGrid … />
</AppShell>
```

- It fills its parent: give it the window's height (the web app mounts in `data-app-root`, which the base layer sizes to the window).
- `banner` sits under the bars on every page, for a state of the whole app for this person (a calendar that stopped syncing, spec 0024): pass a `Callout` with `placement="banner"`. A slot rather than markup in each page, so it shows on every page in the same place.
- `AppShellSlot` is an empty place a page fills through a portal, for a frame mounted once in a layout route while its pages change (the web app's workspace frame): pass one as `topBar`, `viewBar` or `toolbar` and portal the page's bar into its element. It draws no box (`display: contents`). `viewKey` names the page the view shows: a new name draws a new view box, at its top, so another page arrives fresh rather than as the last page's box moved under new bars.
- The main column is the `main` landmark; the sidebar is the navigation landmark; a side panel is an `aside`.
- `sidebar` is optional. Left out, the page has the whole width and there is no skip link, since there is nothing to skip: for one of our screens embedded in another product's frame, which brings its own navigation (spec 0070, AC-7032). A variant rather than a second shell, so an embedded screen lays out exactly as it does in the app, its view the same size container.
- A skip link ("Skip to content") comes first in the tab order and shows while it has focus; it jumps past the sidebar to the main column.
- Below `bp-page-compact` (1024px) the sidebar folds to its rail and stays folded, through `AppShellContext` (`isCompact`).
- `phoneSidebar` says what the sidebar is on a phone (the shell under 480px, `bp-container-md`): `rail` (the default) keeps the icon rail; `hidden` gives the page the whole width, its TopBar's `back` the way up; `full` shows the sidebar alone, open and the whole width, the page hidden behind it (`AppShellContext`'s `isFull`, which only the sidebar reads). There the skip link is left out, since the page it skips to is hidden; `AppShellContext` also carries `isPhone`, so a screen can tell (Settings' own address opens Profile anywhere wider). Why: the settings sidebar on a phone was 24 unlabelled icons beside a clipped page (critics A and B, 5 November 2026); a phone's settings open on a labelled list that pushes into each page, as iOS, Linear and Notion do. The root is a size container (`app-shell`) for it, since the design system's media queries only take `bp-page-compact`.
- The view is a size container (`container-type: inline-size`), so a view adapts to its own width; the panel takes its content's width.
- A Panel opened with `pushesPage` asks the shell for room (`PanelPushContext`): the main column takes `data-pushed` and gives up the panel's width at its end, bars and all, so the panel never covers the page's tools. It snaps rather than slides (animating the padding would lay the page out again every frame); the panel's own slide carries the motion. Not at the compact width, where a panel fills the screen.

## States

Wide and compact. With no sidebar (embedded). On a phone: the rail, the page alone (`phoneSidebar="hidden"`), or the sidebar alone (`"full"`). With and without a side panel. The skip link hidden, and shown while focused.

## Keyboard

The skip link is the first Tab stop; Enter moves focus to the main column. Then the sidebar, the bars, the view and the panel, in that order.

## Differences from the artifact

Not in the artifact: its screens laid the shell pieces out by hand.
