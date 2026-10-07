# 0017. The screens of the record page and panel

## Summary

The record page is one new layout module (`RecordLayout`) around modules that already exist: RecordHeader on top, Tabs with the main column, and AttributeList plus one relationship section per side in a sidebar. The side panel is the existing RecordPanel with the same Details content and the same feed. Three small library variants are needed: an ActivityFeed entry for link changes and an inline layout for Overview, a busy step on RecordPanel's Previous and Next, and the relationship section's short form for Overview. Every state, including "This record isn't available.", a trashed record and a record lost while open, is designed.

## Routes (`apps/web/src/routes`)

| Route | File | Screen | Guard |
|---|---|---|---|
| `/w/$slug/objects/$object/$recordId` | `w.$slug.objects.$object_.$recordId.index.tsx` (new) | redirects to `…/$recordId/overview` | a member (the door) |
| `/w/$slug/objects/$object/$recordId/$tab` | `w.$slug.objects.$object_.$recordId.$tab.tsx` (new) | the record page; `$tab` in `overview`, `activity` (#19 adds `notes`, `tasks`), anything else redirects to `overview` | a member; an unknown object shows #13's missing page, an archived one #13's archived page |
| `/w/$slug/objects/$object` | `w.$slug.objects.$object.tsx` (exists) | the table, now with search params `record` (uuid) and `panelTab` (`details` default, `activity`, #19's `notes`, `tasks`), validated with Zod; invalid values are dropped | as today |

The trailing underscore in `$object_` keeps the record page out of the table route's layout, so the table doesn't render under it. The record route loads lazily, outside the first load. The loader warms `records.one` and the first activity page; it never hands rows to the screen.

Screen code lives in `apps/web/src/features/records/` (new): `README.md` with the three line briefs below, `strings.ts` with every string, `RecordPage.tsx`, `RecordDetails.tsx` (the sidebar content, shared by the page and the panel), `OverviewTab.tsx`, `ActivityTab.tsx`, `RecordSidePanel.tsx`.

## Library work (`packages/ui`, before the screens that use it)

Each gets a README (why it exists, its states, its keys), a story per state, the three browser tests, axe, a screenshot, `design-system-guardian`, then the artifact publish.

- **RecordLayout** (new module). Why new: no module lays out a header, a tab bar with its panel, and a fixed sidebar; AppShell's slots are the app frame, and RecordPanel is a floating panel. Props: `header` (node), `tabs` (`TabItem[]`), `selectedTab`, `onTabChange`, `children` (the selected tab's panel), `sidebar` (node), `sidebarLabel` ("Details"), `isSidebarExpanded` and `onSidebarExpandedChange` (controlled, for the narrow layout), `isLoading`. At or above `bp-container-md` the sidebar sits on the right at the Panel molecule's `md` width, and the tab panel and the sidebar each scroll inside themselves at the content area's full height. Below it, the sidebar renders above the tabs inside a Disclosure (`sidebarLabel` as its title, closed by default) and the tab panel keeps the content area's height so a feed can scroll inside it. Reuses Tabs and Disclosure; no new tokens.
- **ActivityFeed** (variants). A `links` entry: `{ kind: 'links', attribute, added, addedCount, removed, removedCount }` reads "added Jane Doe, Ada Lovelace, Alan Turing and 97 others to Team" and "removed …", each name a flat RecordChip link, "and N others" plain text; when both are set it reads both in one entry. A `layout` prop: `feed` (today's, virtualised, scrolling inside its slot) or `inline` (draws every entry it is given, at most 10, with no scroll of its own, for Overview). Prepending entries in `feed` layout keeps the first visible entry fixed on screen.
- **RecordPanel** (variant). `pendingStep?: 'previous' | 'next'` shows that button busy (the Button's pending state) and ignores presses until it clears.
- **RelatedRecords** (spec 0014's `packages/ui` module, gaining a variant here; see build plan task 11). A titled list of `RecordChip` rows from a `ListSource<RecordRefDisplay>`, virtualised, with the total in the heading, "Show more", "Add" and per row "Remove" (each optional, so read only sides leave them out), and, new here, a `limit` plus `onViewAll` that turns it into the short form for Overview: at most `limit` rows and a "View all <N>" link button instead of "Show more". Its states: loading, empty ("No <plural> yet", with "Add" when allowed), error with Retry, read only.
- **Icons**: `link` (Copy link), `layout-dashboard` (Overview), `activity` (Activity) added to the Icon registry if missing.

## The record page

Brief: Purpose: everything about one record in one place. Main task: read and edit its details, and see what happened to it. Leaves out: deleting and restoring the record (#22), presence (#26), notes and tasks (#19), comments (#29).

- **Top bar**: the object's icon tile, crumbs "<Plural> › <record name>" (Breadcrumbs), the record name as the page's h1.
- **Header**: RecordHeader with `record` (the store's display), `objectName` (singular), and children: a ghost Button "Copy link" (icon `link`). Copying raises the toast "Link copied". `viewers` stays empty until #26.
- **Tabs**: "Overview" and "Activity" (#19 adds "Notes" and "Tasks" with counts). The tab is the URL's `$tab`; switching tabs replaces the URL (no new history entry per tab).
- **Sidebar** (`RecordDetails`):
  - AttributeList, label "Details", one untitled section (until #18) with the attributes Details lists (value sourcing in [index.md](index.md)); `onCommit` writes through the data layer; `editorProps` gives the record reference editor its `onSearch` (spec 0014's `records.search` source, with "At …" notes) and the member editor its `me`.
  - Then one RelatedRecords per many side, heading "<attribute title>" with the total ("150,000 people"), 20 rows, "Show more", "Add" (opens ReferencePicker in a Popover anchored to the button), "Remove" per row. No confirm on Remove: the row leaves at once and a toast "Removed <name> from <Title>." offers Undo; Undo, or Cmd+Z, puts it back through spec 0006's undo stack (see the index's value sourcing).
- **Overview** (`OverviewTab`), top to bottom, each block a Card with an h3:
  - Highlights (#18).
  - "Recent activity": ActivityFeed `layout="inline"` with the newest 5 entries, then a Link button "View all" to the Activity tab.
  - Open tasks (#19).
  - "Related": one RelatedRecords short form per many side (`limit` 5); "View all <N>" moves focus to that side's section heading in the sidebar, first opening the narrow layout's Disclosure (`isSidebarExpanded`).
- **Activity** (`ActivityTab`): ActivityFeed, `layout="feed"`, label "Activity", filling the tab panel, fed by `activity.forRecord`.

### States of the page

| State | When | What shows |
|---|---|---|
| loading | `records.one` is `loading` | RecordLayout `isLoading`: header and Details skeletons after the loading delay; the tab shows its own skeleton |
| unavailable | `records.one` is `deleted` on the first load and `records.trashed` answers `unavailable`, or `records.activity` answers `NOT_FOUND` before the record loads | the top bar with the object only, and EmptyState (icon `search`): "This record isn't available." (`recordUnavailable`, the panel's string too) with a Link "Back to <Plural>". The same for a missing or hidden record |
| trashed | `records.trashed` answers `trashed` on the first load | the page read only from the trashed body: a danger Callout above the layout, "This <singular> was deleted." (with "Restore" from #22); AttributeList without `onCommit`; no relationship sections and no Related cards (a trashed record's links are hidden until restore); Activity as usual |
| no longer available | `records.one` goes from `ready` to `deleted` (a delete, or access lost) | a danger Callout above the layout, "This <singular> is no longer available."; open editors close without saving; AttributeList loses `onCommit`; sections lose Add and Remove; the feed stays as loaded |
| failed | `records.one` is `error` | EmptyState "We couldn't load this record." with "Try again" (`retry`) |
| read only object | the object's `access` is `read` (spec 0009) | AttributeList shows every value with its lock and the object's reason; no Add or Remove |
| archived object | the object is archived | #13's archived page |
| offline, live paused | spec 0006 and 0005 frame Callouts | unchanged; edits follow spec 0006's offline rule |

A block on Overview that fails shows its own error with "Try again" and leaves the other blocks working.

## The side panel

Brief: Purpose: review records from a table without leaving it. Main task: read, edit and step to the next record. Leaves out: the Overview tab (the full page has it).

- Opened by a plain primary click on a record's name in the table, or on a chip in a relation cell; the name and chips are real links to the full page, so Cmd or Ctrl click and middle click open it in a new browser tab.
- RecordPanel with `record` (the store's display), `status` (from `records.one`; `no-access` is never used: an unknown or hidden id clears `?record=` and shows EmptyState "This record isn't available." with Close, spec 0014 AC-306, the page's string; a trashed one shows read only with "This <singular> was deleted."), `tabs`: Details (`RecordDetails`, the same component as the sidebar) and Activity (ActivityFeed `feed`), with #19's Notes and Tasks after.
- `selectedTab` is `?panelTab=`; stepping keeps the tab.
- Previous and Next come from `neighbours(recordId)` on the table's window: at the first or last row of the view the button is disabled (passed but inert, so the header doesn't shift); when the next row isn't loaded, pressing Next sets `pendingStep: 'next'`, loads its block, then moves. When `neighbours` returns nothing, both are left out.
- `onOpenPage` goes to the full page on `overview`, or `activity` when the panel showed Activity. `actions`: the same "Copy link".
- Deleted, or access lost, while open: the same "This <singular> is no longer available." Callout inside the panel's content, read only, until closed.
- Esc closes the panel (Esc inside an editor cancels the edit first); `record` and `panelTab` leave the URL; focus returns to the cell it was opened from, or to the grid when that row is gone.

## Keyboard and focus

- On entering the page, focus moves to the h1 (spec 0005's route rule). Tab order: top bar, header actions, the tab list (arrows switch tabs), the tab panel, then the sidebar (on the narrow layout the Details Disclosure comes before the tabs, matching what you see).
- The feed is one tab stop (its feed pattern); AttributeList and RelatedRecords follow their own READMEs.
- "View all <N>" focuses the section's heading (focusable with `tabIndex = -1`), after opening the Disclosure when narrow.
- The panel follows RecordPanel's README; no new shortcuts are added.
- Every string lives in `apps/web/src/features/records/strings.ts`; `dxe quick`, `ux-interaction-reviewer` and `design-system-guardian` run before each milestone lands.

## Rationale (short)

One `RecordDetails` component feeds both the page's sidebar and the panel's Details tab, so an attribute edits the same way in both. The layout is a library module because the house rule allows no one off page markup; the rest is composition of modules that were built for this page in spec 0003. Overview's related cards jump to the sidebar instead of opening another list, so there is one place to page, add and remove.
