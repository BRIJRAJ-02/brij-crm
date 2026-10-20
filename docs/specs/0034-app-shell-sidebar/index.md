# 0034. App shell and sidebar v2

**Date**: 2026-10-20
**Status**: Proposed
**Numbering**: handed out by the coordinator on 20 October 2026 (roadmap, Release 1). This spec owns AC-921 to AC-960; 0031 owns AC-801 to AC-840, 0032 AC-841 to AC-880, 0033 AC-881 to AC-920.

## Summary

The sidebar gets the order the owner chose on 20 October 2026: the workspace menu, Quick actions and search, then Inbox and Tasks, then Favourites, Records, Lists and a new Scheduling group (Bookings, Availability, Booking pages, Forms) that replaces Captures, with Trash, Invite teammates, Settings and Help at the foot. Each person can fold, reorder and hide its parts, star views and records as favourites, and shrink it to a narrow rail. Those choices are stored on the server for each member, so they follow the person to any browser, show at once when made, and reach the person's other open tabs within a second. Anything a member can't see (an object, a view, a record) never shows in their sidebar.

Reasoning and options: see [rationale.md](rationale.md).

## Dependencies

| Feature | What this spec needs | When it is missing |
|---|---|---|
| Spec 0026 settings area | the Settings entry at the foot with ⌘,; ThemeSwitch already gone from the footer (AC-685) | 0034 removes the ThemeSwitch itself if 0026 hasn't landed |
| Spec 0031 workspaces and members | the workspace menu's contents (AC-801: the workspace list, Create workspace), the invite dialog, the `members.invite` permission check, the guest role | the menu shows the current workspace only; Invite teammates is hidden |
| Spec 0019 notes and tasks | My tasks at `/w/$slug/tasks` (AC-436) and the task reads for the count | Tasks is left out until My tasks ships |
| #28 notifications | the inbox page and its unread count | Inbox is left out |
| #51 lists | lists the member may read | the Lists section is left out |
| Command menu (its own small spec, Release 1) | a palette over records, views and pages, opened by ⌘K | Quick actions is left out; hidden objects stay reachable by their address |
| Spec 0007 realtime, spec 0009 access | the outbox and relay, `filterEvent`, `removeMember` | hard prerequisite |
| Spec 0035 availability schedules | the Availability page as a list of schedules | Availability opens today's single hours screen at its new address |

## Requirements

**User stories**:
- As a member, I want my daily work (inbox, tasks, favourites) at the top and scheduling in its own group, so I find things where I expect them.
- As a member, I want to order, fold and hide what the sidebar shows, so it fits how I work, and to find it the same on my laptop and my phone.
- As a member, I want to star the views and records I use most, so they are one click away.
- As a member, I want a narrow rail when I need room, and I want it to stay that way.

**Acceptance criteria** (AC-921 to AC-944 used; the rest of the range is spare):

*Layout*
- **AC-921**: From top to bottom the sidebar shows: the workspace menu; Quick actions (⌘K) with a search button; Inbox and Tasks; the Favourites, Records, Lists and Scheduling sections (in the member's section order, default as listed); then at the foot Trash, Invite teammates, Settings and Help and shortcuts. There is no theme switch in it (spec 0026, AC-685).
- **AC-922**: The workspace menu (the workspace's name and mark) opens: the member's workspaces with the current one checked, Create workspace (both from spec 0031, AC-801), Invite people (only with `members.invite`), Settings (⌘,), then Sign out. Picking an item works by pointer and keyboard; signing out shows the busy spinner as today.
- **AC-923**: Quick actions opens the command menu, and its search button opens it in search mode (`/` does the same when focus isn't in a text field). The row is left out until the command menu exists.
- **AC-924**: Inbox shows only once notifications (#28) exist, with its unread count as a badge. Tasks opens My tasks (spec 0019, AC-436) with a badge counting my open tasks that are overdue or due today by my local date; no badge at zero; the count updates live. Badges count what needs action, never totals.
- **AC-925**: Favourites lists the views and records the member starred, in their order: a view with its object's hue tile and the object's name as `meta`, a record with its object's tile and its display name. The section is left out while the member has none.
- **AC-926**: Records lists every live object the member may read: those the member ordered first, in their order, then any others in the workspace's object order. A new object appears at the end without the member doing anything.
- **AC-927**: Lists shows the lists (#51) the member may read, the same way as Records, and is left out until lists exist.
- **AC-928**: Scheduling holds Bookings (`/w/$slug/bookings`), Availability (`/w/$slug/availability`), Booking pages (`/w/$slug/booking-pages`) and Forms (`/w/$slug/forms`), shown to owners, admins and members, and left out for guests (spec 0031).
- **AC-929**: Every old address redirects, replacing the history entry and keeping the query: `/captures` and `/captures/links` to `/booking-pages`; `/captures/links/$pageId` to `/booking-pages/$pageId`; `/captures/forms` to `/forms`; `/captures/forms/$formId` (and `/preview`) to `/forms/$formId` (and `/preview`); `/bookings/availability` to `/availability`.
- **AC-930**: The foot holds Trash (every member, spec 0022), Invite teammates (only with `members.invite`; it opens spec 0031's invite dialog), Settings (⌘, from anywhere, spec 0026), and Help and shortcuts, a menu with Keyboard shortcuts (`?`, the ShortcutHelp dialog) and, once one exists, the help centre.

*Customising*
- **AC-931**: Favourites, Records, Lists and Scheduling fold and unfold from their label (Enter or Space); the fold state is kept for the member and restored on every device.
- **AC-932**: Items inside a section reorder by drag (a drop line, dnd-kit) and by keyboard on the item's handle (Space lifts, arrows move, Space drops, Esc cancels, each move announced: "Deals, moved to position 2 of 5"). Items never move between sections. Sections reorder the same way by their label's handle, and by Move up and Move down in the section's menu.
- **AC-933**: An object, a list, or a Scheduling item can be hidden from its item menu ("Hide from sidebar"), and every item can be shown or hidden in a **Customise sidebar** dialog (from the workspace menu and from each section's menu) that lists each section's items with a switch and ends with Reset to default. The workspace menu, Quick actions, Trash and Settings can't be hidden. A hidden object stays reachable by the command menu and by its address.
- **AC-934**: A view or a record is starred from its header (a star button, "Add to favourites") and from the command menu, and unstarred the same way or from the item's menu in Favourites. At most 50 favourites; the 51st is refused with "You have 50 favourites. Remove one first."
- **AC-935**: The collapse button at the top (and `[` when focus isn't in a text field) shrinks the sidebar to the 48px rail (`size-sidebar-collapsed`): icons only, each named in a tooltip, sections as groups under a hairline, favourites as their tiles. The choice is kept for the member. Below `bp-page-compact` the shell folds it to the rail on its own without changing the stored choice.

*Stored per member*
- **AC-936**: Order, hidden items, favourites, folded sections, section order and the rail are stored on the server per member per workspace. A member with nothing stored sees the defaults, and the first change creates their row. The stored choices arrive with the first workspace read, so the sidebar never flashes the default order first.
- **AC-937**: Every change shows at once and is saved in the background; a refusal rolls the sidebar back and shows a toast with Retry. The change reaches the member's other open tabs and devices within 1 second, and no other member's sidebar changes.
- **AC-938**: Changes are sent as single operations (move, hide, show, star, unstar, fold, move section, rail, reset) and applied to the stored row under a row lock, so two tabs changing different things at the same moment both keep their change.

*Access*
- **AC-939**: A favourite or an item the member can no longer read, or that was deleted or moved to the trash, drops out of the sidebar with no placeholder, and comes back if access returns or the record is restored. Names and ids of things the member can't read never reach the browser: the server resolves the sidebar through the access door.
- **AC-940**: Ids that point at nothing any more (purged for good) are removed from the stored row on its next write and by the daily cleanup.
- **AC-941**: Removing a member deletes their stored sidebar (spec 0009's `removeMember` hook).

*Quality*
- **AC-942**: The sidebar is the "Main navigation" landmark; the current page's item has `aria-current="page"`; Tab follows the visual order; every control is named; contrast meets WCAG AA in both themes; forced colours outline the current item.
- **AC-943**: The sidebar reads only through the data layer (`packages/data`); the first load of the web app stays within its 250 kB budget; reordering 50 items keeps every frame under 16 ms on the reference laptop.
- **AC-944**: Every route the sidebar links to is checked by a test that walks the item list and asserts the route exists, so a renamed route can't leave a dead item.

## Decision

Rebuild the sidebar's contents in `WorkspaceFrame` from one item model (fixed destinations, objects, lists, favourites and Scheduling pages), resolved on the server per member through the access door and stored in one `member_nav_prefs` row per member, changed by small operations that are optimistic in the data layer and live through a new `nav` outbox kind. The library's Sidebar gains reorder, item menus, a controlled fold and the rail; no second navigation component. See [rationale.md](rationale.md).

## Feature design

### The item model

| Kind | Ids | Section | Can hide | Can star |
|---|---|---|---|---|
| `page` | `inbox`, `tasks` | top | yes | no |
| `page` | `bookings`, `availability`, `booking_pages`, `forms` | Scheduling | yes | no |
| `object` | object id | Records | yes | no |
| `list` | list id | Lists | yes | no |
| `view` | view id | Favourites | no (unstar instead) | yes |
| `record` | record id | Favourites | no (unstar instead) | yes |

Fixed and never stored: the workspace menu, Quick actions, Trash, Invite teammates, Settings, Help and shortcuts. Defaults (no stored row): sections in the order Favourites, Records, Lists, Scheduling, all open; Scheduling in the order Bookings, Availability, Booking pages, Forms; nothing hidden; the full width sidebar.

### Data model

All in a tenant table: `workspace_id` first, forced row level security with the standard policy, audit columns (spec 0004).

**`member_nav_prefs`**
- `workspace_id`, `member_id` (primary key together; foreign key to `members`, cascade on delete).
- `items` jsonb, an ordered array of `{ kind, id, pinned, hidden }` (kind as in the table above; `pinned` true makes it a favourite, and only views and records may be pinned; order inside the array is the order inside its section). At most 400 entries, checked in core and by a `jsonb_array_length` check.
- `sections` jsonb: `{ order: ('favourites' | 'records' | 'lists' | 'scheduling')[], folded: string[] }`.
- `rail` boolean, default false.
- `version` integer, incremented by each write (the client ignores a stale echo).

Ids in `items` carry no foreign keys (they point at four tables), so a purge never fails on them; reads skip what doesn't resolve (AC-939) and writes and the cleanup prune it (AC-940).

### Services (`packages/core/src/navigation/`, new)

- `readNav(scope)`: loads the row (or the defaults), then resolves it through the access door in one round of reads: readable live objects (with hue, icon, plural name and slug), readable lists (once #51 exists), the starred views the member may read, and the starred records through the engine's record read (so a record the member can't read, or one in the trash, is left out). Answers the resolved `SidebarModel`, never a raw id that failed to resolve.
- `changeNav(scope, op)`: takes `select … for update` on the row (insert with defaults when missing), applies one operation, prunes ids that resolve to nothing, checks the limits (400 items, 50 pinned), writes, bumps `version`, and writes one `nav` outbox row naming the member. Pure apply function `applyNavOp(prefs, op)` in core with unit tests.
- Operations (a Zod union in `packages/contracts/src/navigation.ts`): `move { kind, id, toIndex }`, `hide { kind, id }`, `show { kind, id }`, `star { kind: 'view' | 'record', id }`, `unstar { kind, id }`, `fold { section, folded }`, `moveSection { section, toIndex }`, `rail { on }`, `reset`.
- `star` checks the member can read the view or record first, and answers `NOT_FOUND` for one they can't read, the same answer as a missing one.

### API surface

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `nav.get` | none | `SidebarModel` (sections in order with folded state, each section's resolved items with label, icon or hue, href parts, hidden flag; rail; counts for Tasks and Inbox; `version`) | signed in member | none |
| `nav.change` | `op` (the union above) | `{ version }` | signed in member; the row is always the caller's own | `VALUE_INVALID` (unknown op, index out of range), `NOT_FOUND` (star of an unreadable or missing item), `NAV_LIMIT` (`{ code, message }`, 50 favourites or 400 items) |

`nav.get` is part of the workspace boot read the shell already makes, so the first paint has the member's order (AC-936).

### Client (`packages/data`)

- A `navigation` store holding the `SidebarModel`; `change(op)` applies `applyNavOp` to the local copy at once, sends it, and on refusal restores the copy and raises the toast with Retry (AC-937).
- The live router handles `nav`: when the event names this member, it rereads `nav.get` (ignoring an answer whose `version` is older than the local one). Events naming another member do nothing.
- The Tasks count comes from the tasks store's "due by today, assigned to me, open" count and stays live through the `tasks` kind; the Inbox count from #28's store.
- Other kinds that change what the sidebar shows (`definitions` for objects, `views`, `records` for a starred record's name or trash state, `access`) mark the model stale and reread it, coarse and debounced as spec 0006 settles.

### Realtime

New outbox kind `nav` carrying `{ memberId }` and nothing else. `filterEvent` passes it to every audience unchanged: it names one member id and no content, the same exposure as a `members` event, and the receiving clients ignore it unless it is theirs. A per member channel was turned down in spec 0007 and isn't brought back for this.

### Routes

New routes `/w/$slug/availability`, `/w/$slug/booking-pages`, `/w/$slug/booking-pages/$pageId`, `/w/$slug/forms`, `/w/$slug/forms/$formId`, `/w/$slug/forms/$formId/preview` render today's screens; the old `captures` routes and `bookings/availability` become redirects (AC-929). Bookings keeps its address and its tabs, without the Availability tab.

### Library work (`packages/ui`, through `design-system-guardian`)

- `Sidebar`: `sections` become reorderable (a `DragHandle` on hover or focus of the label, dnd-kit as decided on 13 October); `NavSection` gets controlled `isFolded` and `onFoldChange`, and a `menu` slot (Move up, Move down, Customise sidebar).
- `NavItem`: a `menu` slot (a quiet `…` button on hover or focus: Hide from sidebar, or Remove from favourites) and reorder support inside its section.
- The rail already exists (`isCollapsed`); it gains favourites as tiles and the section hairlines for every section.
- `CustomiseSidebar`: a Modal of sections, each a list of rows (icon, name, Switch), then Reset to default (a quiet button with a confirm). Built from Modal, Switch and the list row; a new module only because no existing one lists switches by group; its README says so.
- The star button on the record header and view header: `IconButton` with `aria-pressed`, labelled "Add to favourites" or "Remove from favourites".

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| Show Records | objects, their order, hue and icon | `objects` (readable, live) through the access door; order from `items`, then the workspace's object position |
| Show Favourites | each item's name and tile | the view's name and its object; the record's display name through the engine's record read |
| Tasks badge | count | open tasks assigned to the member with `due_on <=` today in the browser's time zone (sent with the read as `today`) |
| Inbox badge | count | #28's unread count |
| Scheduling items shown | which of four | role (guest or not, spec 0031), then `hidden` |
| Invite teammates shown | yes or no | `members.invite` for the member's role (spec 0009) |
| Rail on first paint | on or off | `member_nav_prefs.rail`, or the compact breakpoint |
| Help centre link | URL | none yet; left out until one exists (Follow-up) |

### Key invariants

- One row per member per workspace; only that member writes it; `nav.change` never takes a member id.
- Only views and records may be pinned; only `page`, `object` and `list` may be hidden.
- Nothing unreadable leaves the server: `readNav` resolves through the access door, and a star needs read access first.
- Fixed items are never stored and can't be hidden.

### Security model

Any signed in member reads and writes their own row; no admin reads another member's sidebar. A guest's sidebar shows only Favourites and Records they can read, Tasks and Inbox, and Trash and Settings as their role allows. The `nav` event carries a member id only.

### Critical test scenarios

- Happy path: hide Deals, move People first, fold Scheduling, turn on the rail in tab A; tab B and a second browser of the same member show it within a second; another member sees no change; verifies **AC-931**, **AC-932**, **AC-933**, **AC-935**, **AC-937**.
- Concurrency: tab A stars a record while tab B moves a section at the same moment; both survive; verifies **AC-938**.
- Access: star a record, then an access rule (spec 0032) hides its object; the favourite disappears and the read's payload has no trace of it; restore access and it returns; verifies **AC-939**.
- Trash: star a record, move it to the trash, then restore it; verifies **AC-939**.
- Redirects: each old address lands on its new one with the query kept; verifies **AC-929**.
- Limits: the 51st star is refused with `NAV_LIMIT` and the sidebar rolls back; verifies **AC-934**, **AC-937**.
- Guards: `member_nav_prefs` forces row level security and a cross workspace read returns nothing; removing a member deletes the row; verifies **AC-941**.
- Keyboard: reorder an item and a section by keyboard with the announcements; axe clean; verifies **AC-932**, **AC-942**.

## Build plan

**Milestone 1: the new order, end to end** (one thread: table, core, API, data layer, realtime, screen)
1. Migration: `member_nav_prefs` with its checks, the guard tests, `removeMember` hook, the `nav` outbox kind and its `filterEvent` rule, satisfies **AC-936**, **AC-941**.
2. Contracts and core: the op union, `applyNavOp`, `readNav` (objects and pages only), `changeNav` with the row lock for `fold` and `rail`, satisfies **AC-936**, **AC-938**.
3. API: `nav.get` in the boot read and `nav.change`, satisfies **AC-936**.
4. Data layer: the navigation store, optimistic changes with rollback, the `nav` handler, satisfies **AC-937**.
5. Screens: the new order and Scheduling group in `WorkspaceFrame`, the new routes and redirects, the workspace menu order, the foot (Trash, Invite, Settings, Help and shortcuts), folding and the rail stored, the route walking test, satisfies **AC-921**, **AC-922**, **AC-928**, **AC-929**, **AC-930**, **AC-931**, **AC-935**, **AC-942**, **AC-944**.

**Milestone 2: order and hide**
6. Ops `move`, `hide`, `show`, `moveSection`, `reset`; pruning and the daily cleanup phase, satisfies **AC-926**, **AC-932**, **AC-933**, **AC-940**.
7. Library: reorder in Sidebar and NavSection, item and section menus, the `CustomiseSidebar` module, stories and screenshots; the guardian and `ux-interaction-reviewer`, satisfies **AC-932**, **AC-933**, **AC-942**, **AC-943**.

**Milestone 3: favourites**
8. Ops `star` and `unstar` with the read check and the limit; `readNav` resolving views and records through the door; the stale marking from `views`, `records` and `access`, satisfies **AC-925**, **AC-934**, **AC-939**.
9. The star button on the record and view headers; favourites on the rail; Playwright for access and trash drop outs; `security-access-reviewer`, `state-performance-reviewer`, satisfies **AC-925**, **AC-934**, **AC-939**.

**Milestone 4: counts and the parts that wait on other features**
10. Tasks with its badge once My tasks ships; Quick actions and search once the command menu ships; Inbox once #28 ships; Lists once #51 ships. Each is a small addition to the item table, satisfies **AC-923**, **AC-924**, **AC-927**.

## Consequences

**Positive**:
- One item model for every sidebar entry: later sections (Reports, Automations) are a row in the table, not a new layout.
- Choices follow the person, which matters once members use several devices and workspaces.
- Scheduling becomes four plain destinations with their own addresses, no Captures tab to explain.

**Negative / tradeoffs**:
- A server round trip and a table for what many apps keep in the browser; it is small and optimistic, but it is more code.
- The sidebar must reread when objects, views, records or access change, which adds reads on busy workspaces (debounced, coarse).
- Every member's clients receive every member's `nav` events and drop most of them; the cost is one tiny message per change.

**Neutral**:
- `/captures/*` and `/bookings/availability` live on as redirects; links in emails sent before keep working.
- Spec 0026's settings sidebar stays a variant of the same Sidebar; it has no stored preferences.

## Follow-up

- [ ] Help centre: link it from Help and shortcuts once it exists.
- [ ] Workspace wide default order set by an admin (Attio's "default sidebar"), if teams ask for one.
- [ ] Starring from a table row's menu and from the board card.
- [ ] Reports, Automations and Notes as items when those features land.

## Rationale

See [rationale.md](rationale.md).
