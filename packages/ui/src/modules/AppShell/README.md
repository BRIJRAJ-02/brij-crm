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

- It fills its parent: give it the window's height.
- The main column is the `main` landmark; the sidebar is the navigation landmark; a side panel is an `aside`.
- A skip link ("Skip to content") comes first in the tab order and shows while it has focus; it jumps past the sidebar to the main column.
- Below `bp-page-compact` (1024px) the sidebar folds to its rail and stays folded, through `AppShellContext` (`isCompact`).
- The view is a size container (`container-type: inline-size`), so a view adapts to its own width; the panel takes its content's width.

## States

Wide and compact. With and without a side panel. The skip link hidden, and shown while focused.

## Keyboard

The skip link is the first Tab stop; Enter moves focus to the main column. Then the sidebar, the bars, the view and the panel, in that order.

## Differences from the artifact

Not in the artifact: its screens laid the shell pieces out by hand.
