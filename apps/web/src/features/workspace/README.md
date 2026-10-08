# Workspace

Spec 0005, milestones 1 to 3. Every page inside a workspace sits in `WorkspaceFrame` (AppShell and Sidebar), through `WorkspacePage`.

## The frame (`/w/$slug`, WorkspaceFrame)

- **Purpose**: the frame around every page in a workspace.
- **Main task**: move between the workspace's records (People in this loop), switch the theme, sign out from the workspace menu (headed by the person's role: Owner, Admin or Member).
- **Leaves out**: switching or creating workspaces, Quick actions, favourites and lists (#23 and later).

## An object's page (`/w/$slug/objects/$object`, RecordsScreen)

- **Purpose**: one object's records (People in this loop) as a fast table, under the object's name and colour tile.
- **Main task**: read and edit people in place, add a person, and add a column, seeing others' changes live.
- **Leaves out**: filters, sorts, saved views, other objects' tables and presence (#6, #7, #20).

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
- Live (milestone 3): someone else's create, edit or new column shows in the open table within a second, patched in place by the data layer (no reload, nothing polls). A new column reaches the screen through `onDefinitionsChange`, which reloads the route (`router.invalidate()`). While the live connection is down, an info Callout above the table says live updates are paused; previews have no live updates (no `VITE_REALTIME_URL`) and say nothing.
