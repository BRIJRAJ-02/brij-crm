# Workspace

Spec 0005, milestones 1 to 3. Every page inside a workspace sits in `WorkspaceFrame` (AppShell and Sidebar), through `WorkspacePage`.

## The frame (`/w/$slug`, WorkspaceFrame)

- **Purpose**: the frame around every page in a workspace.
- **Main task**: move between the workspace's records (People in this loop), switch the theme, sign out from the workspace menu (headed by the person's role: Owner, Admin or Member), undo the last change (Cmd+Z, Ctrl+Z elsewhere), and list the shortcuts (?).
- **Leaves out**: switching or creating workspaces, Quick actions, favourites and lists (#23 and later).

## An object's page (`/w/$slug/objects/$object`, RecordsScreen)

- **Purpose**: one object's records (People in this loop) as a fast table, under the object's name and colour tile.
- **Main task**: read and edit people in place, sort a column for the visit, add a person, and add a column, seeing others' changes live.
- **Leaves out**: filters, saved views and sorts that last past the visit, other objects' tables and presence (#7, #20).

## New person (NewRecordDialog)

- **Purpose**: add one record without leaving the table.
- **Main task**: type the name and an email, then Create; the row shows at once, and takes focus once the server agrees.
- **Leaves out**: every other attribute (edit those in the table), duplicate checks and templates.

## Add attribute (AddAttributeDialog)

- **Purpose**: add a column to the object, from the view bar. Shown only to people whose role holds `schema.manage` (owners and admins, spec 0009); the server refuses anyone else 403 on its own.
- **Main task**: name it, pick one of the eight types, then Add attribute; the column appears once the server agrees.
- **Leaves out**: select, status, currency and relation types, defaults, uniqueness and descriptions (#13).

## Notes

- The frame's loader reads `access.mine` beside the objects; `useCan(permission)` (in `WorkspacePage.tsx`) answers from it, false while it loads, so a control is never shown and then taken away. It only hides controls: every check is the server's. To see the app as a member locally: `pnpm --filter @crm/core member:add -- --workspace <slug> --email <email> --role member`, then sign in with that email in another browser.
- Signed out goes to `/sign-in?redirect=<this page>`. An unknown workspace and one the person isn't in both answer `NOT_FOUND`, shown as "Workspace not found" inside the frame, with "Open your workspace".
- While a page loads, the sidebar already shows the workspace's name (from `me`), and the page keeps a loading TopBar and EmptyState in their places. A workspace that failed to load hides Records and offers Try again; one with no objects says "No objects yet".
- Sign out from the workspace menu spins the workspace button until it is done. The theme switch stacks when the sidebar is folded to its rail (below `bp-page-compact`).
- `/w/$slug` opens on People: the object with the `people` template key, by its `apiSlug`.
- The sidebar lists People only in this loop (`navObjects`); the other standard objects join it when their tables exist.
- The route's loader warms the object's view (`data.records.view`: its count and first block) beside `attributes.list` and `members.list`; the screen reads the view with `useView` and never fetches. The grid comes from `@crm/ui/grid` inside the route's split component, so it stays out of the first load.
- Columns: every non system attribute by position, then Created at, each at its type's width. Moving, resizing, pinning and hiding are kept for the visit only (saved views come with #6). Company and Owner cells are read only in this loop ("You can’t change this here yet."); Owner shows member names from `members.list`.
- An edit shows at once; a refusal rolls it back, marks the cell and raises a toast with Retry (the data layer does all three). New person waits in the dialog for the server while its row already shows; a refusal takes the row out and puts the message on its field. Add attribute waits for the server, then `router.invalidate()` reads the columns again.
- New person asks for one email even though Email addresses holds several: the list editor's chip, added on blur, grew the dialog under the pointer on its way to Create and the press missed.
- Live (milestone 3): someone else's create, edit or new column shows in the open table within a second, patched in place by the data layer (no reload, nothing polls). A new column reaches the screen through `onDefinitionsChange`, which reloads the route (`router.invalidate()`). While the live connection is down, an info banner Callout above the table says live updates are paused (announced politely); previews have no live updates (no `VITE_REALTIME_URL`) and say nothing.
- Versions and undo (spec 0006, milestone 1): every edit names the version it started from. A paste or range clear is one write for up to 500 records (more is refused with "Paste into at most 500 records at once."); when one of several cells lands, a toast says "Pasted into 40 cells" (or "Cleared 6 cells") with Undo, which undoes that paste only, and only while it is the newest change ("Newer changes came after that one, so it wasn’t undone." otherwise). Cmd+Z on a Mac keyboard, Ctrl+Z elsewhere (the library's `useKeyboardPlatform`, as every Kbd shows it; `undo.ts`, listened for on the document by the frame, `useUndoShortcut.ts`), undoes this tab's last confirmed change, up to 50 back, unless focus is in a text field, an editor or a dialog; the toast says what it undid ("Undid Email on Jane Doe") and how many cells it kept because they changed since. When someone else's later save replaces the person's value, a toast says who, what and where, with Use mine (raised from `main.tsx` through the data layer's `onReplaced`). ? (outside a text field or a grid cell, where typing starts an edit) and Keyboard shortcuts in the workspace menu open ShortcutHelp, which lists both. The grid's own paste toast is off on People (`confirmsPaste={false}`): the screen confirms the paste once its write lands.
- Windows (spec 0006, milestone 2): the table opens newest first (created at, descending), and the column menu's Sort ascending and descending replace the order for the visit; the old rows stay until the new order's first rows are in. The loader warms the view with the columns the table shows (`columns.ts`, shared with the screen), and only those and the name are read; a column shown later is read for the loaded rows, which draw skeletons until then. Others' changes patch values at once and reorder the table 1.5 seconds after the last one (not while a cell is being edited); a row the person edited stays where they see it until they scroll it away, and a record they made sits first, noted New, until they leave the page. A filtered view (#20) past 10,000 rows counts "10,000+". A million rows stay reachable: past 15 million px the grid scales its scroll positions.
