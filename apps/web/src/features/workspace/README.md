# Workspace

Spec 0005, milestone 1. Every page inside a workspace sits in `WorkspaceFrame` (AppShell and Sidebar), through `WorkspacePage`.

## The frame (`/w/$slug`, WorkspaceFrame)

- **Purpose**: the frame around every page in a workspace.
- **Main task**: move between the workspace's records (People in this loop), switch the theme, sign out from the workspace menu.
- **Leaves out**: switching or creating workspaces, Quick actions, favourites and lists (#23 and later).

## An object's page (`/w/$slug/objects/$object`, ObjectScreen)

- **Purpose**: one object's records under its name and colour tile.
- **Main task**: see the records; in milestone 1 there are none, and the page says so plainly.
- **Leaves out**: the table, "New person" and "Add attribute", which arrive with records in milestone 2.

## Notes

- Signed out goes to `/sign-in?redirect=<this page>`. An unknown workspace and one the person isn't in both answer `NOT_FOUND`, shown as "Workspace not found" inside the frame, with "Open your workspace".
- While a page loads, the sidebar already shows the workspace's name (from `me`), and the page keeps a loading TopBar and EmptyState in their places. A workspace that failed to load hides Records and offers Try again; one with no objects says "No objects yet".
- Sign out from the workspace menu spins the workspace button until it is done. The theme switch stacks when the sidebar is folded to its rail (below `bp-page-compact`).
- `/w/$slug` opens on People: the object with the `people` template key, by its `apiSlug`.
- The sidebar lists People only in this loop (`navObjects`); the other standard objects join it when their tables exist.
