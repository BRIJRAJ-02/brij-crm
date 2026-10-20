# 0034. App shell and sidebar v2: rationale

## Context

Today the sidebar (`packages/ui/src/modules/Sidebar`, drawn by `apps/web/src/features/workspace/WorkspaceFrame.tsx`) has the workspace menu, a Records section of object hue tiles, an unlabelled group of Bookings, Captures and Trash, and a ThemeSwitch footer that spec 0026 is moving into Settings. A builder is working on 0026 and on the sidebar's header logo now. There are no favourites, no tasks or inbox entries, nothing to fold or reorder that is remembered, and the rail exists in the library but isn't wired.

The owner decided on 20 October 2026 that CRM team basics and scheduling get equal capacity, and gave the order: Inbox and Tasks on top, Favourites, Records, Lists, a Scheduling group (Bookings, Availability, Booking pages, Forms) replacing Captures, then Trash, Invite, Settings and Help at the foot. The roadmap's recommendation, taken unless the owner says otherwise, is that sidebar preferences live on the server per member so they follow the person.

Forces: one client data layer (spec 0006) with optimistic writes; realtime through audience channels with ids only (spec 0007), where a personal channel per member was turned down; the access door (spec 0009) means names of things a member can't read must never reach their browser; the 250 kB first load budget; WCAG AA and full keyboard use.

## Options considered

### Option 1: server stored preferences, one row per member, changed by operations (chosen)

`member_nav_prefs` holds order, hidden, pinned, folded sections and the rail; the server resolves it through the access door; the client applies each operation optimistically.

**Pros**: follows the person across devices; the server filters unreadable favourites, so nothing leaks; operations under a row lock never lose a concurrent change.
**Cons**: a table, two procedures, a realtime kind; a round trip per change (hidden by the optimistic apply).

### Option 2: browser storage only

Keep order and folds in `localStorage`, as many apps do for the rail.

**Pros**: no server work; instant.
**Cons**: lost on a new browser or device and in private windows; favourites in the browser would hold record ids the member may lose access to, and showing their names would need a per item access check anyway.

### Option 3: one row per item (a `member_nav_items` table)

**Pros**: each change is a single row write; easy to query "who starred this record".
**Cons**: reordering rewrites positions across many rows; section state still needs a second table; no current need to query favourites across members.

### Option 4: a workspace wide sidebar set by admins

**Pros**: one layout for the team, simpler.
**Cons**: not what the owner asked for (per member order, pins and hiding); kept as a Follow-up for an admin default.

## Rationale

Option 1 is the only one that meets "follows the person" and the access rule together: the server already has to resolve favourites through the door, so storing them there costs little more. One jsonb row keeps a reorder to one write, and sending operations rather than the whole document means two tabs never overwrite each other. The `nav` event carries only a member id, the same exposure as the `members` kind, so it rides the existing audience channels instead of reviving the per member channel spec 0007 rejected.

Calls made without a question, each with its runner up:
- Favourites hold views and records only (runner up: objects too), since objects already sit in Records and starring one would duplicate it.
- Favourites hidden while empty (runner up: an empty section with a hint), to keep a new member's sidebar short; the star button teaches it.
- A Customise sidebar dialog as well as per item menus (runner up: menus only), taken from Linear, so a hidden item can always be brought back from one place.
- Scheduling is hidden for guests (runner up: shown read only), since a guest reads only what's shared with them.
- `[` toggles the rail (runner up: ⌘.), as in Linear, and doesn't clash with the browser.
- Limits of 50 favourites and 400 stored items (runner up: none), to keep the row and the read small.

## Evidence

- **Attio** (Mobbin, web): workspace menu, Quick actions ⌘K with a search button, Notifications, Tasks, Notes, Emails, Reports, Automations, then folding Favorites (views and records, with the object name in grey), Records, Lists; Invite teammates and Help and first steps at the foot. The model for the top half and the foot.
- **Linear** (Mobbin, web): Inbox and My issues on top, folding Workspace and Your teams sections, and a Customize sidebar dialog where each item is Always show or Don't show, grouped Personal and Workspace. The model for hiding and bringing back.
- **Cal.com** (Mobbin, web): Event types, Bookings, Availability, Teams, Routing, Workflows, Insights in one flat group, Settings at the foot. The model for the Scheduling group's contents.
- **Calendly** (Mobbin, web): Scheduling, Calendar, Contacts, Automations with Settings at the foot; schedules live under Availability.
- **The owner's earlier scheduling app** (`nav-items.tsx`, read only): one flat list ordered by area, rows owned by an "app" that can be switched off, and a rule that a row names a route checked by a test. The route walking test (AC-944) comes from there.

## References

**Project sources**: spec 0003 (Sidebar inventory row: workspace switcher, Quick actions, favourites, records, lists), spec 0006 (one data layer, optimistic writes), spec 0007 (audience channels, ids only), spec 0009 (access door, `removeMember`), spec 0019 (My tasks), spec 0022 (Trash for every member), spec 0026 (Settings and ⌘,), spec 0031 (workspace menu contents, invites, guest role), `docs/plan/roadmap-2026-10-20.md`.

**Practices**: optimistic UI with rollback; operations rather than whole document writes for concurrent edits; WAI-ARIA drag and drop announcements.
