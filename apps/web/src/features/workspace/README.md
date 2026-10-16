# Workspace

Spec 0005, milestones 1 to 3; spec 0012 makes the object pages generic. Every page inside a workspace sits in `WorkspaceFrame` (AppShell and Sidebar), through `WorkspacePage`.

## The frame (`/w/$slug`, WorkspaceFrame)

- **Purpose**: the frame around every page in a workspace.
- **Main task**: move between the workspace's objects (every live one, in the workspace's order), open Settings and sign out from the workspace menu (headed by the person's role: Owner, Admin or Member), undo the last change (Cmd+Z, Ctrl+Z elsewhere), and list the shortcuts (?).
- **Leaves out**: switching or creating workspaces, Quick actions, favourites and lists (#23 and later).

## An object's page (`/w/$slug/objects/$object`, RecordsScreen)

- **Purpose**: any live object's records (People, Companies, Deals, a custom Projects) as a fast table, under the object's name and colour tile.
- **Main task**: read and edit records in place, sort a column for the visit, add a record ("New <singular>"), and add a column, seeing others' changes live.
- **Leaves out**: filters, saved views and sorts that last past the visit, and presence (#7, #20).

## Bulk delete (spec 0022, milestone 1: BulkDeleteBar.tsx, bulk.ts)

- **Purpose**: act on the rows ticked in an object's table.
- **Main task**: tick rows (the checkbox column, Space, Shift ranges, Mod+A), then Delete in the floating bar: one record goes at once, several after a danger confirm ("Delete 48 people? They stay in the trash for 30 days."); the toast says "Deleted 48 people" with Undo, and ⌘Z undoes it too. A refused row comes back with its reason on its name cell. Clear or Esc empties the selection and gives focus back to the table.
- **Leaves out**: Edit (milestone 2), "Select all matching" and more than 500 at once (background jobs, milestone 3: the bar says "Changes to more than 500 records arrive soon."). A member who may only read the object sees why instead of Delete.
- A new view (another sort, later a filter or view) starts with nothing ticked, and rows gone on the server leave the selection (the view's `gone`, and `confirm` after a coarse reload). ⌘Z after New <singular> moves the record to the trash ("Undid the create of Ada Lovelace.").

## An archived object's page (ArchivedObjectScreen)

- **Purpose**: what an archived object's address shows (spec 0012, AC-226): "<Plural> is archived", inside the frame.
- **Main task**: owners and admins Restore it in place; everyone can go back to the first live object (or Settings when none is live).
- **Leaves out**: its records, which stay and show again once it is restored.

## New record (NewRecordDialog)

- **Purpose**: add one record of any object without leaving the table.
- **Main task**: fill the primary attribute and every required one, open "Add more fields" for the rest (by position, defaults prefilled), then Create <singular>; the row shows at once, and takes focus once the server agrees.
- **Leaves out**: references and members (edited in the table until #15), files (#32), duplicate checks and templates.

## The table's schema entry points (spec 0012)

- **Purpose**: change the object's columns where they are seen. Shown only to people whose role holds `schema.manage` (owners and admins, spec 0009); the server refuses anyone else 403 on its own.
- **Main task**: Add attribute in the view bar or the "+" header after the last column opens settings' attribute dialog (`features/settings/AttributeDialog.tsx`); the new column appears once the server agrees and its header takes focus. A column's menu adds Edit attribute (the same dialog) and Archive attribute (the confirm; not on the name, none on system columns). In a select, multi select or status cell, owners and admins can type a label no live option has and choose "Create "<label>"" (spec 0012, AC-238): one optimistic write through `data.records.createOption`, the cell showing the label at once (the data layer's pending options, merged into the column with `withPendingOptions`) and rolling back, marked, on a refusal. Members never see the offer.
- **Leaves out**: types with setup and options (milestone 3), and per view column order (#20): moving a column here changes this visit's layout only.

## Notes

- The frame's loader reads `access.mine` beside the objects; `useCan(permission)` (in `WorkspacePage.tsx`) answers from it, false while it loads, so a control is never shown and then taken away. It only hides controls: every check is the server's. To see the app as a member locally: `pnpm --filter @crm/core member:add -- --workspace <slug> --email <email> --role member`, then sign in with that email in another browser.
- Signed out goes to `/sign-in?redirect=<this page>`. An unknown workspace and one the person isn't in both answer `NOT_FOUND`, shown as "Workspace not found" inside the frame, with "Open your workspace".
- While a page loads, the sidebar already shows the workspace's name (from `me`), and the page keeps a loading TopBar and EmptyState in their places. A workspace that failed to load hides Records and offers Try again; one with no objects says "No objects yet".
- Sign out from the workspace menu spins the workspace button until it is done. The theme switch stacks when the sidebar is folded to its rail (below `bp-page-compact`).
- `/w/$slug` opens on the first live object by the workspace's order, by its `apiSlug`, or on Settings, Objects when none is live (spec 0012).
- The sidebar lists every live object, standard and custom, in the workspace's order (`navObjects`); an archived one leaves it, and its address says it is archived.
- The route's loader warms the object's view (`data.records.view`: its count and first block) beside `attributes.list` and `members.list`; the screen reads the view with `useView` and never fetches. The grid comes from `@crm/ui/grid` inside the route's split component, so it stays out of the first load.
- Columns: People opens with Name, Email addresses, Phone numbers, Company, Job title, Primary location, Owner and Last contacted (when the workspace has one), then any other attribute by position, then Created at, each at its type's width; Description, Avatar, the socials, Associated deals, Time zone and Email opt out start hidden (`columns.ts`, the screen's opening layout until saved views, #20, keep a view's own: it is how People opens, not what a person is, so the template's order still drives the API and the record page). The Avatar is read anyway and drawn in the Name cell (`rowAvatar`); a person with no name shows "Unnamed person", muted. Company chips name the linked company, read by the data layer (`referenceDisplays`); a company the person can't see says "Unavailable". Moving, resizing, pinning and hiding are kept for the visit only (saved views come with #6). Company and Owner cells are read only in this loop ("You can’t change this here yet."); Owner shows member names from `members.list`.
- An edit shows at once; a refused value rolls back and marks the cell, which says why (no toast); a passing failure (the server busy or out of reach) rolls back with a toast that names the field and offers Retry (the data layer does all of it). A person's name is required, so clearing it is refused in the cell. Dialogs have a title bar with a close button, Cancel with its Esc keycap and the primary with ⌘↵, and New person starts in its first field. New person waits in the dialog for the server while its row already shows; a refusal takes the row out and puts the message on its field. An attribute write waits for the server, then the data layer reads the columns again and the routes reload.
- The create dialog asks for one value of a list type (Email addresses, behind "Add more fields" on People) even though it holds several: the list editor's chip, added on blur, grew the dialog under the pointer on its way to Create and the press missed.
- Live (milestone 3): someone else's create, edit or new column shows in the open table within a second, patched in place by the data layer (no reload, nothing polls). A new column reaches the screen through `onDefinitionsChange`, which reloads the route (`router.invalidate()`). While the live connection is down, a one line Callout in the view bar says live updates are paused (announced politely), so the table never moves; previews have no live updates (no `VITE_REALTIME_URL`) and say nothing.
- Versions and undo (spec 0006, milestone 1): every edit names the version it started from. A paste or range clear is one write for up to 500 records (more is refused with "Paste into at most 500 records at once."); when one of several cells lands, a toast says "Pasted into 40 cells" (or "Cleared 6 cells") with Undo, which undoes that paste only, and only while it is the newest change ("Newer changes came after that one, so it wasn’t undone." otherwise). Cmd+Z on a Mac keyboard, Ctrl+Z elsewhere (the library's `useKeyboardPlatform`, as every Kbd shows it; `undo.ts`, listened for on the document by the frame, `useUndoShortcut.ts`), undoes this tab's last confirmed change, up to 50 back, unless focus is in a text field, an editor or a dialog; the toast says what it undid ("Undid Email on Jane Doe") and how many cells it kept because they changed since. When someone else's later save replaces the person's value, a toast says who, what and where, with Use mine (raised from `main.tsx` through the data layer's `onReplaced`). ? (outside a text field or a grid cell, where typing starts an edit) and Keyboard shortcuts in the workspace menu open ShortcutHelp, which lists both. The grid's own paste toast is off on People (`confirmsPaste={false}`): the screen confirms the paste once its write lands.
- Windows (spec 0006, milestone 2): the table opens newest first (created at, descending), and the column menu's Sort ascending and descending replace the order for the visit; the old rows stay until the new order's first rows are in. The loader warms the view with the columns the table shows (`columns.ts`, shared with the screen), and only those and the name are read; a column shown later is read for the loaded rows, which draw skeletons until then. Others' changes patch values at once and reorder the table 1.5 seconds after the last one (not while a cell is being edited); a row the person edited stays where they see it until they scroll it away, and a record they made sits first, noted New, until they leave the page. A filtered view (#20) past 10,000 rows counts "10,000+". A million rows stay reachable: past 15 million px the grid scales its scroll positions.
