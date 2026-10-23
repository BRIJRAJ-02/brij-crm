# 0048. Lists and pipelines: verify

How each criterion is checked. Heavy suites run on GitHub CI (lanes push and read CI), not on the laptop; locally, run single test files only. Each milestone adds its checklist here with what ran, as spec 0046 does.

## Data model and migration (AC-4803, AC-4838)

- `packages/db/src/guards.test.ts`: `lists` and `list_entries` force row level security and have a policy; a cross workspace read of each returns nothing.
- Migration test: `lists_name` refuses a second "sales pipeline" against "Sales Pipeline", archived lists included; the migration stops with a list of duplicates when a workspace has two lists of one name; existing lists gain Added and Added by.
- `packages/core/src/engine/lists.test.ts` (new): `toApiSlug` with `_2` on a clash; the API name never changes on rename.

## Making and managing lists (AC-4801 to AC-4805, AC-4828 to AC-4832, AC-4834)

- Core: Blank makes one table view and the system fields; Pipeline makes Stage (five options in order), Owner, the board grouped by Stage as default and the table view; the 501st list is `LIMIT_REACHED` even under concurrent creates.
- Core: a member makes a list over an object they can write; over a read only object, 403; without `lists.manage` (an API key), 403. A member changes their own list; another member gets 403 with the creator's name; an admin changes any list.
- Core: turning "Each record once" on with a duplicate is `CONFIG_INVALID` with the count; with none, it lands.
- Core: archive and restore record a `definitions` event with `listId`; an archived list refuses `entries.add` with `NOT_FOUND`; an archived object makes its lists answer as archived and restore with it.
- `packages/contracts/src/access.test.ts`: the pinned role table now holds `lists.manage` for owner, admin and member, and `KEY_FORBIDDEN_PERMISSIONS` holds it.
- Audit: `list.created`, `list.updated`, `list.archived`, `list.restored` each have a History sentence (spec 0046's walk test).
- Browser tests: the New list Modal (object Select by write level, the name clash sentence, Create off at the limit with its sentence), the sidebar's Lists section (order, hide, Customise), Settings › Lists (counts for owners and admins only, Archived Disclosure), General and Fields tabs (read only with the LockReason for non managers), the archive Modal and the archived page.

## The list page and views (AC-4806 to AC-4812, AC-4842)

- Data layer (`packages/data/src/data.test.ts` and an entries test): `data.entries.view` windows by position and cursor; record bodies land in the record store and entries in the entry store; an edit of a list field is optimistic, rolls back on refusal with its sentence, and is undone; an object field edit in a row writes the record; the replaced notice fires on a later save by someone else.
- Browser tests: the header, the record column pinned, the column picker's two groups, Added newest first, the "+" field column for managers only, Enter opening the record panel with the entry first, every state (loading, error with Try again, empty with Add and Import, filtered empty, not found, archived).
- View behaviour on a list: shared and private views, drafts, Save, Save as new view, lock, default, rename, duplicate, delete, and a filter over a list field and an object field together.

## Adding and removing (AC-4813 to AC-4819, AC-4825, AC-4826)

- Core: an add with a client id replayed answers the same entry; another object's record is `CONFIG_INVALID`; a deleted record `RECORD_DELETED`; a missing required list field `VALUE_REQUIRED`; two concurrent adds to an "Each record once" list give one entry and one `ENTRY_EXISTS`.
- Core: `addEntries` with 500 ids reports added, already in and refused separately; `removeEntries` and `restoreEntries` with 500; a restore blocked by a re added record stays removed and is reported.
- Core: record delete hides the record's entries in every list; restore brings them back.
- Jobs: `entries.addMatching` over an object's all matching selection and `entries.removeMatching` over a list's, in slices of 500, with counts and the result.
- Browser tests: the Add Modal (search, "Already in this list", Create <singular>, required fields), the pinned row and Toast; one entry Remove with Undo and no confirm; 48 ticked with the confirm Modal; the object bulk bar's Add to list with the "already in it" count and Undo; the list bulk bar's Edit and Remove, and no Delete.

## Boards (AC-4815, AC-4820, AC-4821)

- Core: `entries.groups` grouped by a list status and by an object select, counts exact unfiltered, under a record rule counts only what the reader sees.
- Browser tests: spec 0021's board suite run against a list parent (columns, 25 a column, pointer and keyboard drag, a refused move put back, Cmd+Z, the stuck badge from the entry's stage history), column "+" with the option preset, the empty state with Add field for managers.

## Lists around the record (AC-4812, AC-4822 to AC-4824, AC-4827)

- Core: `entries.forRecord` returns at most 100 entries in readable lists only, ordered by list name then Added.
- Browser tests: the record page's Lists section (cards, first 4 fields then Show all values, in place edits, "Not in any list"), Add to list from the header, the section and ⌘K, the required fields Modal, the card menu's Open list and Remove from list.
- ⌘K: lists as destinations with "List · <plural>", "Create list" only with `lists.manage`, "Add to list…" on a record page; the route walking test (spec 0039, AC-1104) covers the list addresses.

## Import into a list (AC-4833)

- Core: a `.csv` and an `.xlsx` into a list: rows match records by the object's rule or create them, add entries with list values, update entries in an "Each record once" list; the summary counts; undo removes the added entries and created records.
- Browser test: Import on the list menu opens spec 0040's flow with the list's and the object's fields in the match step.

## Access (AC-4834 to AC-4837)

- `packages/core/src/access/table.test.ts`: every new service has an entry; the walk refuses each to a principal without access.
- Core: at `none` on the object, every list, entry, view and attribute procedure answers `NOT_FOUND` with an unknown list's words; at `read`, writes are 403 with the sentence; a record rule hides entries from `entries.query`, `count`, `groups`, `forRecord`, `membership` and from events (`filterEvent`).
- API keys: `data.read` reads, `data.write` adds, edits and removes, neither makes or changes a list.
- Side channels: a filter or sort on an object field hidden from the member is refused on a list as on the object; an entry whose record leaves the member's record rule after an edit leaves their open list within a second; `entries.forRecord` gives no hint of unreadable lists.
- Browser test: a member at read sees no Add, no drag handles and the LockReasons.

## Live (AC-4824, AC-4839, AC-4840)

- Data layer: an `entries` event naming ids refetches them once per frame; a coarse one marks the list's windows dirty after the random wait; a `definitions` event with a `listId` reads the list's attributes and `data.lists`; a `views` event with a `listId` reads that list's views.
- Playwright flow (two browsers, CI's flows job): make a Pipeline, add, edit a stage, drag on the board, remove and undo, archive and restore; the second browser sees each within a second, in the table, the board, the record page card and the sidebar.
- One copy: a list table, a board and a record page card open on one entry share one store entry (a store test), and an object field edited on the record page shows in the list row at once.

## Scale (AC-4841)

- On the million record seed, a list of 200,000 entries: the first window filtered by an entry status and sorted by an entry date, a cursor window, a position jump, the count, and the board's first columns, each with EXPLAIN (ANALYZE, BUFFERS) and p95 timings recorded here; an entry edit's p95. Targets: 300 ms read, 250 ms edit (spec 0011).
- The scale run's results table goes here when milestone 2 runs it (the million record load run was waived on 12 October; run the engine level bench on the local seed instead and say so).

## Open items to record here

- Each milestone's checklist with what ran and on which branch.
- The EXPLAIN plans for AC-4841.
- Any criterion moved between milestones, with the reason.
