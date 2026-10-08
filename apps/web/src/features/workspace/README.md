# Workspace

Spec 0005, milestones 1 and 2. Every page inside a workspace sits in `WorkspaceFrame` (AppShell and Sidebar), through `WorkspacePage`.

## The frame (`/w/$slug`, WorkspaceFrame)

- **Purpose**: the frame around every page in a workspace.
- **Main task**: move between the workspace's records (People in this loop), switch the theme, sign out from the workspace menu.
- **Leaves out**: switching or creating workspaces, Quick actions, favourites and lists (#23 and later).

## An object's page (`/w/$slug/objects/$object`, RecordsScreen)

- **Purpose**: one object's records (People in this loop) as a fast table, under the object's name and colour tile.
- **Main task**: read and edit people in place, add a person, and add a column.
- **Leaves out**: filters, sorts, saved views, other objects' tables and live updates (#6, #7, #20).

## New person (NewRecordDialog)

- **Purpose**: add one record without leaving the table.
- **Main task**: type the name and an email, then Create; the row shows at once, and takes focus once the server agrees.
- **Leaves out**: every other attribute (edit those in the table), duplicate checks and templates.

## Add attribute (AddAttributeDialog)

- **Purpose**: add a column to the object, from the view bar.
- **Main task**: name it, pick one of the eight types, then Add attribute; the column appears once the server agrees.
- **Leaves out**: select, status, currency and relation types, defaults, uniqueness and descriptions (#13).

## Notes

- Signed out goes to `/sign-in?redirect=<this page>`. An unknown workspace and one the person isn't in both answer `NOT_FOUND`, shown as "Workspace not found" inside the frame, with "Open your workspace".
- While a page loads, the sidebar already shows the workspace's name (from `me`), and the page keeps a loading TopBar and EmptyState in their places. A workspace that failed to load hides Records and offers Try again; one with no objects says "No objects yet".
- Sign out from the workspace menu spins the workspace button until it is done. The theme switch stacks when the sidebar is folded to its rail (below `bp-page-compact`).
- `/w/$slug` opens on People: the object with the `people` template key, by its `apiSlug`.
- The sidebar lists People only in this loop (`navObjects`); the other standard objects join it when their tables exist.
- The route's loader warms the object's view (`data.records.view`: its count and first block) beside `attributes.list` and `members.list`; the screen reads the view with `useView` and never fetches. The grid comes from `@crm/ui/grid` inside the route's split component, so it stays out of the first load.
- Columns: every non system attribute by position, then Created at, each at its type's width. Moving, resizing, pinning and hiding are kept for the visit only (saved views come with #6). Company and Owner cells are read only in this loop ("You can’t change this here yet."); Owner shows member names from `members.list`.
- An edit shows at once; a refusal rolls it back, marks the cell and raises a toast with Retry (the data layer does all three). New person waits in the dialog for the server while its row already shows; a refusal takes the row out and puts the message on its field. Add attribute waits for the server, then `router.invalidate()` reads the columns again.
- New person asks for one email even though Email addresses holds several: the list editor's chip, added on blur, grew the dialog under the pointer on its way to Create and the press missed.
