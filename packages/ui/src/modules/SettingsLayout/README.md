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

- The app's settings pages (since 21 October 2026) sit under a `TopBar` that carries their trail and h1, like every other page, so they pass no `nav` and keep the default `titleLevel`; the bar's hairline lines up with the settings sidebar's head. Without a TopBar, a page can pass `titleLevel={1}` and its `trail`: the trail ("Account › Preferences"; a place without `href` is a group's name, plain text) sits over the title, which is then the page's h1 (no TopBar above), and the header ends in a hairline before the body. Cards in the body then take h2 titles (`CardTitleLevel`). While loading, the trail stays and the h1 stays (visually hidden), so the header doesn't shift and the app's focus and the tab's title have it.
- `header="bar"` (the app's settings pages, the owner's call on 21 October 2026): the TopBar above holds the trail, an object's tile and badge, and the page's one primary action at its end (where People's "New person" sits), so the layout draws no title block and the sections follow at once, their headings h2 under the bar's h1. Why: a big title with a line of description under it repeated the trail and the first section. A page that needs context gets it from its first section's heading, not a title.
- `hasTabs` says the body opens with Tabs (an object's page): the header drops its hairline, as the tabs' underline divides the page, so two rules never stack.
- `SettingsRow` is one setting in a Card: its title over a muted description, its control at the end (a Select with `isLabelHidden` and the same label, a Switch, a Button), a hairline between rows, and the control dropping under the text when the row is narrow. Why a new part: no molecule drew a setting as title, description and a control on the right (Field puts its label above its box, DescriptionList is terms and values with no control, and Card is the group around the rows). It lives beside SettingsStack because the rhythm belongs to the settings page.
- A `SettingsRow` can also stand for one thing of a kind in a Card of them (a connected calendar each, the compact row Attio and Calendly use): `leading` puts a mark before the text (a `ProviderMark`), `meta` sits beside the title (a `Default` Badge, or an `InfoTip` when the title needs a word of help), the `description` carries its state (a `Badge` with a state `dot`, and when it last synced), and the controls and a "···" menu sit at the end. Why not a card per thing: a card of label and value pairs per account read heavy and left half the page empty (the owner, 21 October 2026).
- `nav` (optional) lists the settings pages as a column beside the page, in order; `currentNavId` marks the one shown (`aria-current="page"`). The navigation is a `nav` landmark named by `navLabel` ("Settings").
- `titleRef` reaches the visible title, which takes focus by script (never a tab stop) when the control in use went away with its change (an archived row, a cancelled job's Cancel); the TopBar's h1 is visually hidden under a trail, so focus there would show nothing.
- `title` is the page's second level heading by default: the `TopBar` above holds the h1 (as the crumbs' current place), which takes focus after a route change, as on a record page.
- `icon` with `hue` draws an object's tile before the title; `meta` sits beside the title (a "Standard" or "Custom" Badge).
- `description` is one line under the title; `actions` sit at the end of the header. One primary at most, as everywhere.
- The body is the screen's: `Tabs` for an object's Attributes and Configuration, `Card`s for sections (a danger zone is a Card whose action is a `danger` Button), `Table` for lists, `EmptyState` for empty and failed reads, `Callout` for a read only note.
- `SettingsStack` keeps that rhythm inside a tab's panel: its sections stack `space-16` apart, under a breath below the tabs, as they do directly in the body. Why: a `TabPanel` lays out nothing itself, so an object's Attributes and Configuration tabs would otherwise butt their Cards together. Not a TabPanel variant: the record panel's tabs fill their slot edge to edge with one scrolling region, and the rhythm belongs to the settings page (its body's gap, below the tabs' hairline), so it lives beside the layout that owns it.
- `isLoading` holds the header's place with skeletons after the loading delay (marked busy, "Loading settings" for screen readers); the navigation stays usable.
- The page takes the view's whole width inside the app's `space-16` gutter, like every other page (owner, 20 October 2026); it used to stop at `size-dialog-wide`. Below 480px wide (a container query, as RecordHeader) the navigation sits above the page.

### The settings page pattern

Every settings page builds its body from three pieces, so Profile, Security, Workspace › General, Members and the rest read as one product:

1. **Settings in sections.** `SettingsSection` takes a `title` and an optional `description`, and holds the section's Cards. The heading sits above the cards, one column across the page's width at every size (the owner, 21 October 2026: a label column beside the cards took a third of the width for a short line and left the rest empty), and a `description` comes only when the heading alone doesn't say what the settings change. A hairline sits between one section and the next. The title is an h2 under the page's h1 (an h3 under a TopBar), the section is a region named by it, and Cards inside take titles one level under it (h3, or h4 under a TopBar). Inside a section:
   - a **Card of `SettingsRow`s**, one setting per row (title and description at the start, its control at the end): Preferences › Appearance.
   - a **Card holding a `Form` with `columns={2}`**, its Save in the Card's `footer`: the fields sit two to a row, so none stretches across the page. Leave the Card's `title` out when the section's title already says it (an object's Names and look).
   - **`SettingsGrid`** for several cards of one kind (a card per calendar, per integration): as many columns as keep each card at least `size-panel` wide, one on a phone.
   - a **danger section last** (Archive, Delete): a Card with a `danger` Button in its `actions`.
2. **Lists run the full width.** A `Table` (Objects, an object's attributes, Background jobs, Members) goes straight in the body with no section, so its columns get the room.
3. **Page level notes and states span the width too:** a read only `Callout`, a result `Callout`, and an `EmptyState` for empty and failed reads sit in the body outside any section.

```tsx
<SettingsLayout titleLevel={1} trail={trail} title="General" description="Your workspace’s name and address.">
  <SettingsSection title="Workspace" description="What members see in the sidebar and in emails.">
    <Card
      footer={
        <Button variant="primary" type="submit" form="workspace">
          Save
        </Button>
      }
    >
      <Form id="workspace" columns={2} onSubmit={save}>
        <Field label="Name" name="name" />
        <Field label="Web address" name="slug" />
      </Form>
    </Card>
  </SettingsSection>
  <SettingsSection title="Danger zone">
    <Card title="Delete workspace" description="…" actions={<Button variant="danger">Delete workspace</Button>} />
  </SettingsSection>
</SettingsLayout>
```

Inside an object's tabs, wrap the sections in `SettingsStack` as before. Why `SettingsSection` and `SettingsGrid` are new parts here: nothing in the library put a group's title beside its cards (Card's own title sits inside its frame, and SectionBar is a list's header), and the split and the grid belong to the settings page's layout, so they live beside it rather than as Card variants.

## States

Loaded, loading (the trail stays, skeletons for the title and description), sections (the heading above the cards), a grid of cards, with and without the navigation column, a trail, a tile, badge, description and actions, current entry, hover and focus on the entries (NavItem's), narrow. Empty, error and read only states are the body's (EmptyState, Callout). SettingsRow: with and without a description, wide (control at the end) and narrow (control under the text); disabled and read only are its control's.

## Keyboard

Tab moves through the navigation's links, then the header's actions, then the body. Enter follows a link.

## Differences from the artifact

Not in the artifact.
