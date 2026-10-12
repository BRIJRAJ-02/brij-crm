# SettingsLayout

The frame of every settings page: the settings navigation beside the page, and the page's header over its body.

## Why it exists

New (spec 0012, pulled forward from spec 0003's milestone 4; in the inventory as a module). Objects and attributes (#13) open the first settings pages, and members, roles, security, billing and the API (#8, #23 to #25, #34 to #39, #42) add theirs; each needs the same navigation, the same header and the same narrow behaviour. Nothing in the library drew a page header with a description and actions inside the view (RecordHeader is a record's, with an avatar and viewers; Card is a framed group, not a page), and the settings navigation is a column of its own beside the page. A variant of RecordHeader would have carried a record's avatar, presence and copy into every settings page, so it is a new module. It reuses what exists: the navigation rows are the Sidebar's `NavItem`s, the tile is `Icon`'s hue tile, the loading head is `Skeleton`. Sections inside the body are `Card`s, tabs are `Tabs`, lists are `Table`s, and the trail back sits in the `TopBar` above as its `crumbs`, so it adds layout only, and no new tokens.

## Use

```tsx
<TopBar title="Objects" crumbs={[{ id: 'settings', label: 'Settings', href: '/w/acme/settings' }]} />
<SettingsLayout
  nav={[{ id: 'objects', label: 'Objects', href: '/w/acme/settings/objects', icon: 'box' }]}
  currentNavId="objects"
  title="Objects"
  description="Shape the records your workspace keeps."
  actions={<Button variant="primary" icon="plus">New object</Button>}
>
  <Meter label="Custom objects" value={3} maxValue={50} />
  <Table … />
</SettingsLayout>
```

- `nav` lists the settings pages, in order; `currentNavId` marks the one shown (`aria-current="page"`). The navigation is a `nav` landmark named by `navLabel` ("Settings").
- `titleRef` reaches the visible title, which takes focus by script (never a tab stop) when the control in use went away with its change (an archived row, a cancelled job's Cancel); the TopBar's h1 is visually hidden under a trail, so focus there would show nothing.
- `title` is the page's second level heading: the `TopBar` above holds the h1 (as the crumbs' current place), which takes focus after a route change, as on a record page.
- `icon` with `hue` draws an object's tile before the title; `meta` sits beside the title (a "Standard" or "Custom" Badge).
- `description` is one line under the title; `actions` sit at the end of the header. One primary at most, as everywhere.
- The body is the screen's: `Tabs` for an object's Attributes and Configuration, `Card`s for sections (a danger zone is a Card whose action is a `danger` Button), `Table` for lists, `EmptyState` for empty and failed reads, `Callout` for a read only note.
- `SettingsStack` keeps that rhythm inside a tab's panel: its sections stack `space-16` apart, under a breath below the tabs, as they do directly in the body. Why: a `TabPanel` lays out nothing itself, so an object's Attributes and Configuration tabs would otherwise butt their Cards together. Not a TabPanel variant: the record panel's tabs fill their slot edge to edge with one scrolling region, and the rhythm belongs to the settings page (its body's gap, below the tabs' hairline), so it lives beside the layout that owns it.
- `isLoading` holds the header's place with skeletons after the loading delay (marked busy, "Loading settings" for screen readers); the navigation stays usable.
- The page is capped at `size-dialog-wide`. Below 480px wide (a container query, as RecordHeader) the navigation sits above the page.

## States

Loaded, loading (the header's skeletons), with and without a tile, badge, description and actions, current entry, hover and focus on the entries (NavItem's), narrow. Empty, error and read only states are the body's (EmptyState, Callout).

## Keyboard

Tab moves through the navigation's links, then the header's actions, then the body. Enter follows a link.

## Differences from the artifact

Not in the artifact.
