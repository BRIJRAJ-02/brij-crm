# 0048. Lists and pipelines

**Date**: 2026-10-23
**Status**: Proposed
**Scope**: #51 Lists and pipelines, Slice 17 ([Data engine](../../scope/engine.md))
**Numbering**: 0048 reserved for this spec by the planning chat (crm-1a) on 23 October 2026. This spec owns AC-4801 to AC-4899.
**Decided by**: the owner delegates product and UX calls (21 October 2026). Every call below is made, with a runner up, so the build can start; the owner can overrule any of them.

## Owner decisions (made, overrule any)

1. **Who makes lists.** *Chosen*: a new permission, `lists.manage`, held by owners, admins and members. A member makes lists and changes the lists they made; owners and admins (`schema.manage`) change any list. Lists are working sets a salesperson or recruiter makes for themselves, as in Attio and Folk, so asking an admin for each one would kill the feature. *Runner up*: owners and admins only (`schema.manage`, what `defineList` checks today).
2. **Who sees a list.** *Chosen*: a list follows its object (spec 0032, decision 7, already accepted). Whoever can read Deals can read every list over Deals; whoever can edit Deals can add, edit and remove entries. Record rules still apply entry by entry. *Runner up*: per list sharing as Attio offers (workspace access plus named people), which needs list level rules in the access door.
3. **Each record once.** *Chosen*: a new list lets each record in once ("Each record once" on), the case for every pipeline; it can be turned off in the list's settings for lists that log repeat visits. *Runner up*: duplicates allowed by default (the database default today).
4. **Starting points.** *Chosen*: two, in the New list dialog: **Blank** (a table) and **Pipeline** (adds a Stage status field and an Owner member field, and opens on a board grouped by Stage). *Runner up*: a template gallery by use case (Sales, Hiring, Fundraising), as Attio has.
5. **Where membership shows on a record.** *Chosen*: a **Lists** section in the record page's Details sidebar, one card per entry with the list's fields editable in place, as Attio does. *Runner up*: a Lists tab in the main column.
6. **No entry page.** *Chosen*: a list row opens its record (panel or page), whose Lists section holds the entry. *Runner up*: a page per entry.
7. **List fields.** *Chosen*: every attribute type except relationships and record references (the engine already refuses those on lists). *Runner up*: one way record references on entries ("Main contact" on a Companies list), later.
8. **Archive, not delete.** *Chosen*: a list is archived (with a confirm Modal) and restored from Settings › Lists; nothing is purged in this spec, and an archived list still counts toward the 500. *Runner up*: delete with a 30 day trash.
9. **Removing entries.** *Chosen*: removing one entry is one click with Undo (an Undo delete stays one click); removing 2 or more asks first in a Modal, as deleting records does (spec 0022). *Runner up*: no confirm at any size, Undo only.
10. **What a board groups by.** *Chosen*: any status or single select field of the list or of its object, list fields listed first. *Runner up*: list fields only.
11. **Importing into a list.** *Chosen*: each row finds its record by the import's match rule or makes one, then adds an entry; in an "Each record once" list a row for a record already in it updates that entry's values. CSV and Excel (`.xlsx`) both work. *Runner up*: skip rows whose record is already in the list.
12. **Removed entries and the Trash.** *Chosen*: removed entries come back through Undo, and with their record when a deleted record is restored; the Trash page keeps listing records only. *Runner up*: entries in the Trash too.
13. **Entry counts.** *Chosen*: Settings › Lists shows a list's entry count to owners and admins only; everyone else sees the count of what they can see, on the list page. `lists.entry_count` counts entries whose records a member may not see. *Runner up*: no stored count shown anywhere.
14. **Addresses.** *Chosen*: `/w/$slug/lists/$list` by the list's API name, and `/w/$slug/lists/$list/views/$viewId`, like objects. *Runner up*: by list id.

## Summary

A list is a working set of records of one object, such as a Sales pipeline over Deals or a Hiring list over People. Each record in a list is an **entry**, and entries carry fields of their own (a stage, a priority, an owner on this list) that live beside the record's own fields, never on the record. One record can sit in many lists. A list has the same table and board views as an object (specs 0020 and 0021), records are added from the list, the record page, the bulk bar, ⌘K and an import, and a record's page shows every list it is in.

The database tables and most of the engine already exist (spec 0004). This spec adds the missing pieces: a permission, the API, the client data layer's entry store, the screens, and one small migration (a list's icon, hue and a unique name).

Reasoning, options and the Mobbin references: see [rationale.md](rationale.md). How each criterion is checked: [verify.md](verify.md).

## Dependencies

| Feature | What this spec needs | When it is missing |
|---|---|---|
| Spec 0004 data model | `lists`, `list_entries`, entry values and history, `queryPage` over `{ listId }`, `addEntry`, `removeEntry`, `restoreEntry`, `getRecordEntries`, limits | landed |
| Spec 0009 and 0032 access | `checkList`, `visibleEntries`, the access table and its walk test, `filterEvent` for `entries` rows | landed |
| Spec 0007 realtime | the `entries` kind and `listId` on `definitions` and `views` rows | landed (no client handler yet) |
| Spec 0006 client data | windows, the record store's layering and revision rules, undo, the replaced notice | landed |
| Spec 0012 objects and attributes | the attribute dialog and Attributes tab, icon and hue pickers, `toApiSlug` | landed |
| Spec 0020 table and views, 0021 board | `views.list_id` (in the schema), the ViewBar, DataGrid, BoardView, `records.groups` | landed (object only contracts) |
| Spec 0017 record page | the Details sidebar, the record panel, the header actions | landed |
| Spec 0022 bulk actions | BulkActionBar, the Edit dialog, the bulk job (`startBulk`) | landed |
| Spec 0034 sidebar | the `list` nav kind, the Lists section slot, `readNav` | landed (Lists answers nothing) |
| Spec 0039 command menu, 0040 import | the menu's pages and actions; the import flow and its job | landed; Excel import arrives with lane `wip/import-plus` |
| Library | Modal, Popover, Combobox, Select, TextField, Switch, Tabs, DataGrid, BoardView, BulkActionBar, AttributeList, Badge, EmptyState, Toast, Meter, LockReason, Card | all exist |

## Requirements

**User stories**:
- As a member, I want to make a Sales pipeline over Deals with its own Stage and Owner, so my team can run deals through stages without changing the Deals object.
- As a recruiter, I want the same person in my Hiring list and in an Events list, each with its own status.
- As a member, I want to add records to a list from wherever I am: the list, the record, a filtered table, ⌘K or a spreadsheet.
- As a member, I want to see on a record's page every list it is in, and edit its stage there.
- As an admin, I want a list to respect who may see its object and its records, with nothing leaking.

**Acceptance criteria**:

*Making lists and the sidebar*
- **AC-4801**: A member with `lists.manage` makes a list from the "+" on the sidebar's Lists label, from ⌘K "Create list", or from Settings › Lists: a Modal asks for the Object (a Select of the live objects the member can write, in sidebar order), the Name, and Start with (Blank or Pipeline, a SegmentedControl, Blank first). Create (Mod+Enter) makes the list and its views, opens the list, and the list appears in the Lists section of every member who may read its object within 1 second at p95.
- **AC-4802**: Blank makes one table view, "All entries", the list's default. Pipeline also makes a status field "Stage" with the options Lead, Qualified, Proposal, Won and Lost (hues by spec 0012's next hue rule, no target times, so no stuck badge until an admin sets one; not required; default Lead, so a new entry lands in the first column) and a member field "Owner" (not required, no default), then a board view "Pipeline" grouped by Stage (the default, its cards showing Owner and Added) and the table view "All entries". Every new list gets the read only fields "Added" (when the entry was made) and "Added by".
- **AC-4803**: A list name follows spec 0012's name rules and is unique in the workspace ignoring case, archived lists included; a clash is refused with `CONFIG_INVALID` "A list named <Name> already exists." The API name comes from `toApiSlug(name)`, with `_2`, `_3` added on a clash with another list's (the `lists_api_slug` index decides a race, and the insert retries with the next suffix), and never changes after.
- **AC-4804**: The sidebar's Lists section (spec 0034, AC-927) shows every live list the member may read, each with its icon in its hue and its name, in the member's own order, then the others oldest first (so a new list appears at the end, as a new object does, spec 0034 AC-926). The item menu offers Open, Settings (to the list's managers) and Hide from sidebar; Customise sidebar lists them. The section stays left out while the member can read no list.
- **AC-4805**: The 501st list is refused with `LIMIT_REACHED` ("This workspace has 500 lists, archived ones included, the most it can have."), and the New list Modal shows that sentence with Create off when the workspace is full.

*The list page*
- **AC-4806**: `/w/$slug/lists/$list` opens the member's last opened view of the list, else its default view. The header shows the list's icon and name, a Badge with the object's plural name (a link to the object), the ViewBar (spec 0020: the view switcher, Table and Board, Filter, Sort, View settings) and a primary "Add <singular>" button. An unknown list, or one whose object the member can't read, shows the not found page with the same words as an unknown address.
- **AC-4807**: The table's first column is the record (its object's tile and primary attribute), pinned; then the view's columns. A column is any visible list field or any visible field of the object; the column picker shows the list's fields first, then "<Object> fields". A new list's table shows the record, the list's fields in order, and Added.
- **AC-4808**: A list view sorts by Added, newest first, until it has sorts of its own. Filters and sorts take list fields and the object's fields alike (relationship paths too, as on the object), and every spec 0020 view behaviour holds on a list: shared and private views, drafts, Save, Save as new view, lock, default, rename, duplicate and delete.
- **AC-4809**: Rows are windows (spec 0006): a list of 200,000 entries scrolls with flat memory, and its count shows as an object table's does: exact when unfiltered and no record rule limits the member (read from `lists.entry_count`), otherwise counted through the rule and the filter, stopping at 10,000 ("10,000+").
- **AC-4810**: Editing a list field cell shows at once, saves the entry, rolls back with the refusal's sentence when refused, is undone by Cmd+Z, and follows the last save wins rule with the replaced notice and "Use mine" (spec 0006). Editing an object field cell in a list row writes the record, and the change shows wherever that record shows.
- **AC-4811**: The "+" at the end of the header row, for the list's managers, opens spec 0012's attribute dialog for the list, offering every type but relationships; the new field shows as a column at once and on every open copy of the list within 1 second.
- **AC-4812**: A click on a row's record, or Enter on a focused row, opens the record panel (`?record=<id>`), whose Lists section shows this entry first.

*Adding and removing*
- **AC-4813**: "Add <singular>" opens a Modal: a record Combobox (the object's records the member can read, by spec 0039's search, 8 results, then "Create <singular> "<typed>"") and below it the list's writable fields, required ones marked. "Add to list" (Mod+Enter) closes it; the row shows at the top at once as the member's own pinned row (spec 0006, AC-56), with a Toast "Added <Name> to <List>".
- **AC-4814**: In an "Each record once" list the Combobox shows records already in the list as disabled, with "Already in this list". If another member added it meanwhile, the add is refused with `ENTRY_EXISTS` ("That record is already in this list."), the pinned row leaves, and the Toast says so.
- **AC-4815**: On a list board, the "+" on a column opens the same Modal with that column's option already set.
- **AC-4816**: The server refuses a record of another object (`CONFIG_INVALID`, "That record can't go in this list; it holds another object's records."), a deleted record (`RECORD_DELETED`), a missing required list field (`VALUE_REQUIRED`), and the 1,000,001st entry (`LIMIT_REACHED`). A retried add with the same client minted entry id answers the live entry already made for that list and record and adds nothing; an id already used by any other entry, or by a removed one, is refused with `CONFIG_INVALID` ("That entry id is already used.").
- **AC-4817**: Remove from list (a row's menu, the record page card's menu) takes one entry out at once, with a Toast "Removed <Name> from <List>" and "Undo". Ticking 2 to 500 rows on the list page and choosing "Remove from list" asks first in a Modal ("Remove 48 entries from Sales pipeline? Undo brings them back with their values.", danger tone); more than 500, or all matching, starts a job with "Counting…", then the same confirm with the exact number, as spec 0022's delete does.
- **AC-4818**: Undo (the Toast's or Cmd+Z) brings back exactly the removed entries with their values and history. An entry that can't come back (its record was added again meanwhile to an "Each record once" list, or the list is full) stays removed, and the Toast says how many and why. Remove and restore answer per entry; a blocked entry never fails the whole call.
- **AC-4819**: Deleting a record takes its entries out of every list at once; restoring it brings them back (spec 0004, AC-8), live on every open list.

*Boards*
- **AC-4820**: A list view can be a board, grouped by any status or single select field of the list or of its object (the Group by Select lists the list's fields, then "<Object> fields"). Every board criterion of spec 0021 (AC-492 to AC-509) holds on a list: columns and counts, 25 cards a column, dragging by pointer, keyboard and screen reader, a refused move put back, others' moves live, Cmd+Z, and the "Stuck <N>d" badge, which reads the entry's time in its stage for a list field and the record's for an object field.
- **AC-4821**: A list with no status or single select field, on either side, shows on its board the EmptyState "<List> has no status or select field to group by." with "Add field" for the list's managers.

*Lists around the record*
- **AC-4822**: The record page's Details sidebar ends with a **Lists** section: one Card per live entry of the record in a list the member may read, ordered by list name then Added (lists the member can't read are left out with no gap or count). A card shows the list's icon and name (a link to the list), "Added <relative time>", then the list's fields through the field set, each editable in place (the first 4, then "Show all values"). With no entry it says "Not in any list" with "Add to list". The section is left out when no readable list exists over the object.
- **AC-4823**: "Add to list" (the section's button, a record header action, and ⌘K's "Add to list…" on a record page) opens a Popover with a Combobox of the live lists over the record's object the member can write; an "Each record once" list that already holds the record shows disabled with "Already in". Choosing one adds the entry at once (its card appears) unless the list has required fields, which a small Modal asks for first.
- **AC-4824**: An entry card's menu offers Open list and Remove from list (AC-4817's Undo). Another member's add, edit or removal changes the cards within 1 second at p95.

*Bulk, ⌘K*
- **AC-4825**: An object table's BulkActionBar gains "Add to list": a Popover Combobox of the writable lists over that object. 1 to 500 ticked records are added in one request, with a Toast "Added 48 to Sales pipeline" (and "12 were already in it" for an "Each record once" list) and Undo, which removes exactly the entries just made with no confirm (undoing your own add is not an ending action). More than 500, or all matching, runs a job (spec 0022's "Counting…", confirm with the exact number, progress, result Toast): the selection is snapshotted when counted, the starter or an owner or admin can cancel it, it has no Undo, and it stops at the 1,000,000 entry cap and reports how many it added.
- **AC-4826**: The list page's BulkActionBar offers Edit (spec 0022's dialog; a list field writes the entries, an object field the records) and Remove from list (AC-4817). It offers no record delete.
- **AC-4827**: ⌘K lists every live list the member may read as a destination (its icon, its name, meta "List · <plural>"), found by name; offers "Create list" to members with `lists.manage`; and on a record page offers "Add to list…".

*Settings, archive, import*
- **AC-4828**: Settings › Workspace › **Lists** (after Objects, icon `list`) lists every live list the member may read: icon and name, object, created by, and for owners and admins the entry count; then an "Archived" Disclosure. "New list" opens AC-4801's Modal.
- **AC-4829**: A list's settings (`/w/$slug/settings/lists/$list/$tab`) have two tabs. **General**: name, icon and hue, the "Each record once" Switch, and Archive list. **Fields**: spec 0012's Attributes tab with the list as parent (add, edit, reorder, archive, restore, with the 250 field Meter). The list's managers change them; everyone else sees them read only, with the LockReason "Only <creator>, owners and admins can change this list."
- **AC-4830**: Turning "Each record once" on while a record has two live entries in the list is refused with `CONFIG_INVALID`: "<N> records are in this list more than once. Remove the extra entries first."
- **AC-4831**: Archive list asks first in a Modal ("Archive Sales pipeline? It leaves everyone's sidebar. Its entries are kept, and it can be restored from Settings › Lists."). The list then leaves every sidebar, ⌘K, Add to list picker and record page within 1 second; its address shows "Sales pipeline is archived" with Restore for its managers. Restore brings it all back. An archived list refuses entry writes with `NOT_FOUND` ("That list is archived. Restore it first.").
- **AC-4832**: A list whose object is archived is treated as archived (absent from the sidebar, ⌘K, pickers and record pages; its address says the object is archived) and returns with the object.
- **AC-4833**: The list page's menu offers Import. Spec 0040's flow then targets the list: a `.csv` or `.xlsx` file; the match step offers the list's writable fields and the object's; each row finds its record by the object's import match rule or creates one, then adds an entry with the row's list values; in an "Each record once" list a row whose record is already in it updates that entry, and a second row for the same record in one file updates the entry the first row made. Each mapped column names its target (a list field or an object field) in the match step, and dates read in the importing member's time zone (spec 0040). Rows after the list is archived mid import are skipped with "The list was archived." The summary counts entries added, entries updated, records created and rows skipped with their reasons; undoing the import removes the entries it added and the records it created.

*Access, live and scale*
- **AC-4834**: `lists.manage` joins the permission catalog for owners, admins and members ("Your role can't make lists."). Making a list needs it and write on the object. Changing or archiving a list, and adding, changing or archiving its fields, needs `schema.manage`, or `lists.manage` as the list's creator; anyone else gets 403 `FORBIDDEN` "Only <creator>, owners and admins can change this list." When the creator is no longer a member (or the system made the list), only `schema.manage` manages it, and the sentence reads "Only owners and admins can change this list." A required list field added to a list that has entries behaves as on an object (spec 0013): existing entries keep no value until edited.
- **AC-4835**: A list's level is its object's level (owner decision 2). At `none` the list is absent everywhere: sidebar, ⌘K, Settings, record pages, pickers, events and the API, which answers `NOT_FOUND` with the same words as an unknown list. At `read` the entries show and nothing changes: no Add, edit, drag, or remove, each with a LockReason. At `write` it is fully usable. Field rules apply to the object's fields in list columns, cards and filters as on the object.
- **AC-4836**: An entry whose record the member may not see (spec 0032's record rules) is absent from the list's rows, counts, groups, the record page, events, ⌘K and import matches. No sentence names it.
- **AC-4837**: Every new procedure passes the member door with an access table entry, and the walk test covers it (spec 0009, AC-139). An API key with `data.read` reads lists and entries; with `data.write` it adds, changes and removes entries; it never makes or changes lists or their fields, and `views.*` with a list parent keeps the key rules it has with an object parent.
- **AC-4838**: A list, entry or view id from another workspace answers `NOT_FOUND`; the guard tests cover `lists` and `list_entries` (row level security forced, a cross workspace read empty).
- **AC-4839**: Adds, removals, restores, entry edits, list field changes and list renames or archives show on every open list table, board, record page card and sidebar within 1 second at p95 (spec 0007), patched in place: `entries` events by entry id (coarse past 1,000 in one list), `definitions` and `views` events naming the list. A `records` event naming a record also rereads that record's held entries, so an entry whose record newly passes or fails a member's record rule appears or leaves.
- **AC-4840**: The data layer holds each entry once, by id. A table, a board and a record page card showing one entry show one copy, and an object field in a list row reads the one record copy, so an edit anywhere shows everywhere at once.
- **AC-4841**: On the scale seed (a million records), a list of 200,000 entries filtered by an entry status and sorted by an entry date, and its board's first columns, answer within spec 0011's read budget (300 ms at p95); an entry edit within the edit budget (250 ms). The numbers go in `verify.md`.
- **AC-4842**: Every list screen has its states: loading (after the loading delay), error with "Try again", empty ("No <plural> in this list yet." with "Add <singular>" and "Import"), filtered empty with "Clear filters", not found, and archived. Every control works by keyboard and is named for a screen reader.

## Decision

**Chosen option**: Option 1: Attio style lists, entries with fields of their own, on the existing engine and the existing table and board screens.

A list is a parent of views and attributes exactly as an object is, so the view, field, board, bulk and import machinery is widened from "an object" to "an object or a list" rather than copied.

**Implementation skills**: `crm-data-model-access` (`.claude/skills/crm-data-model-access/`) · `crm-frontend-state` (`.claude/skills/crm-frontend-state/`) · `crm-api-backend` (`.claude/skills/crm-api-backend/`) · `crm-design-system` (`.claude/skills/crm-design-system/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `tanstack-virtual` (`.claude/skills/tanstack-virtual/`)

## Feature design

### Data model

One migration (take the next free number at build time; the coordinator renumbers at landing).

| Table | Change | Notes |
|---|---|---|
| `lists` | add `icon` text not null default `'list'`, `hue` text not null default `'gray'` | the same icon names and hue tokens objects use (spec 0012); a check that `hue` is a known hue, as on `objects` |
| `lists` | unique index `lists_name` on (`workspace_id`, `lower(name)`) | archived lists included, so a restore never collides; before the index, the migration renames any duplicate (only seed scripts make lists today) by adding " 2", " 3", and says so in its notice, so a deploy never stops on it |
| `list_entries` | index `list_entries_created` on (`workspace_id`, `list_id`, `created_at`, `id`) where `deleted_at is null` | the default sort (Added, newest first) and its cursor, as `records_created` serves an object; add `list_entries_created_by` the same way if the scale run shows a sort by Added by needs it |
| `attributes` | for each existing list, insert the system fields "Added" (`system_column = 'created_at'`) and "Added by" (`'created_by'`) with `list_id` set | `insertList` seeds them for new lists; if the `attributes_system_column` check or `compile.ts` covers objects only, widen both to entries (`list_entries.created_at`, `created_by_*`) |

Nothing else changes in the schema: `list_entries` (apart from the one index), entry values, sort keys, `views.list_id`, `outbox.list_id` and the `list_entries_record` index (record page reads) exist. `lists.allows_duplicates` keeps its database default; the API's create sends `false` unless asked (owner decision 3). Job kinds are text, so the two bulk jobs need no migration. `lists.entry_count` is moved by `takeEntrySlots` already.

Entities and keys (all composite with `workspace_id`, row level security forced):

| Entity | Key | Points at | Cardinality |
|---|---|---|---|
| list | `id` | object (`object_id`) | many lists per object |
| list attribute | `attributes.id` with `list_id` | list | up to 250 per list |
| entry | `list_entries.id` | list, record | many entries per list (1,000,000 cap); many per record across lists; one per record per list when `allows_duplicates` is false (checked under the list lock) |
| entry value | `values` with `entry_id` | entry, list attribute | as record values |
| view | `views.id` with `list_id` | list | as object views |

### Engine (`packages/core/src/engine/lists.ts` and neighbours)

- `insertList` gains `icon`, `hue`, `template: 'blank' | 'pipeline'`, the name clash refusal (AC-4803), the system fields, and the template's fields and views (written through the views service in the same `runWrite`). `defineList` checks `lists.manage` plus `write` on the object instead of `schema.manage`.
- New: `updateList` (name, icon, hue, `allowsDuplicates` with the AC-4830 check, run under the list row lock), `archiveList`, `restoreList`, `listLists(scope, { includeArchived })` (readable lists, the entry count only for an open access), each recording a `definitions` change with `listId`.
- `canManageList(scope, list)`: `schema.manage`, or `lists.manage` and `list.createdBy` is this member. Attribute writes with a `listId` parent use it instead of `schema.manage`.
- `checkList` also needs `write` on the object for a write (owner decision 2), and an archived object counts as an archived list (AC-4832).
- `addEntry` takes an optional client minted `id` (UUID v7): a replay with an id that exists for this list and record answers that entry (AC-4816).
- New batch services, each at most 500 ids per call and one `runWrite`: `addEntries(listId, recordIds)` (skips records already in an "Each record once" list and reports them), `removeEntries(entryIds)`, `restoreEntries(entryIds)`.
- `queryEntries`, `countEntries`, `entryGroups`: thin wrappers over `queryPage`, `countMatches` and `query/groups.ts` with `{ listId }` (`GroupsQuery` gains the list source).
- `entryMembership(listId, recordIds)` (at most 50): which of these records have a live entry, for the Add Modal's "Already in this list".
- Two job kinds on spec 0022's bulk machinery: `entries.addMatching` (an object view's "all matching" snapshot into a list) and `entries.removeMatching` (a list view's), slices of 500.
- Spec 0040's import gains a list target (`target: { listId }`), writing through `addEntries` and `setValues` with `entryId`.

### API surface

All on the `member` base (the door), `workspace` scoped, errors as `{ code, message }`.

| Procedure | Kind | Key inputs | Key outputs | Access | Key errors |
|---|---|---|---|---|---|
| `lists.list` | read | `includeArchived?` | `ListView[]` (id, objectId, apiSlug, name, icon, hue, allowsDuplicates, archivedAt, createdBy, `canManage`, `canWrite`, `entryCount?`) | object read per list | |
| `lists.create` | write | `id` (UUID v7, client minted), objectId, name, icon?, hue?, template, allowsDuplicates? | `ListView`, `defaultViewId` | `lists.manage` + object write | `CONFIG_INVALID`, `LIMIT_REACHED`, `NOT_FOUND` |
| `lists.update` | write | listId, name?, icon?, hue?, allowsDuplicates? | `ListView` | manager | `FORBIDDEN`, `CONFIG_INVALID` |
| `lists.archive`, `lists.restore` | write | listId | `ListView` | manager | `FORBIDDEN`, `NOT_FOUND` |
| `entries.query` | read | listId, filter?, sorts?, cursor? or position?, limit (1 to 200), attributeIds, clock | `{ entries: EntryView[], records: RecordView[], nextCursor? }` | list read | `FILTER_INVALID`, `NOT_FOUND`, `QUERY_CANCELLED` |
| `entries.count` | read | listId, filter?, clock | `{ count, atLeast }` | list read | |
| `entries.groups` | read | listId, groupBy (a list or object attribute), groupIds?, filter?, sorts?, clock | as `records.groups` | list read | |
| `entries.get` | read | ids (at most 500) | `EntryView[]` | list read | |
| `entries.forRecord` | read | recordId | `EntryView[]` with `listId` (at most 100, by list name then Added; unreadable lists silently left out) | record read, each list read | `NOT_FOUND` |
| `entries.membership` | read | listId, recordIds (at most 50) | record ids with a live entry | list read | |
| `entries.add` | write | `id` (UUID v7), listId, recordId, values?, timeZone, mutationId | `WrittenEntry` (id, versions) | list write | `ENTRY_EXISTS`, `CONFIG_INVALID`, `RECORD_DELETED`, `VALUE_REQUIRED`, `LIMIT_REACHED` |
| `entries.addMany` | write | listId, recordIds (1 to 500), mutationId | `{ added: { recordId, entryId }[], alreadyIn: recordId[], refused: { recordId, code, message }[] }` | list write | `LIMIT_REACHED` |
| `entries.setValues` | write | entryId, values (attribute → { value, baseVersionId? }), mutationId | as `records.setValues` | list write | as `records.setValues` |
| `entries.remove`, `entries.restore` | write | entryIds (1 to 500), mutationId | per id result (`ENTRY_EXISTS` or `LIMIT_REACHED` per entry on restore, never for the whole call) | list write | `NOT_FOUND` (an unreadable list) |
| `views.*` | widened | `{ objectId } \| { listId }` where they take `objectId` | unchanged | parent read or write | |
| `attributes.*`, `options.*` | widened | `{ objectId } \| { listId }` | unchanged | `schema.manage`, or manager for a list | |
| `bulk.startBulk` | widened | op `addToList` (listId) over an object selection, op `removeFromList` over a list selection | `JobView` | list write | |
| `imports.create` | widened | `target: { objectId } \| { listId }` | `ImportView` | list write | |

### Client (`packages/data`)

- `data.lists`: one cached list per workspace (like `objects.all`), read again on a `definitions` event naming a list, or naming none.
- An **entry store**: a second instance of the record store module keyed by entry id (the same base plus optimistic layers, revision rule, own versions and undo), holding `EntryView`s. Record bodies that `entries.query` returns go into the record store, never into the entry store (AC-4840).
- `data.entries.view(workspace, listId, { filter, sorts }, attributeIds)`: windows of entry ids by position or cursor (spec 0006's `windows.ts`, unchanged), a RowSource that joins each entry to its record copy. Pins for the member's own adds.
- `data.entries.forRecord(workspace, recordId)` for the record page section, served from held entries where it can.
- Writes `add`, `addMany`, `setValues`, `remove`, `restore`, each optimistic with rollback, the refusal sentence, and an undo step ("Undid Stage on Acme renewal", "Undid Remove from Sales pipeline").
- Live: register the `entries` handler (named ids refetched in one `entries.get` per frame; coarse marks the list's windows dirty after spec 0007's random wait), `definitions` with a `listId` (the list's attributes and `data.lists`), and `views` with a `listId`. Drop the "no screen holds lists yet" skips (`index.ts`).
- Board: `data.entries.groups` as the object board's `records.groups` reader, one window per column.

### Screens (`apps/web/src/features/lists/`, new, plus small changes)

- Routes: `w.$slug.lists.$list.tsx`, `w.$slug.lists.$list_.views.$viewId.tsx`, `w.$slug.lists.$list_.import.tsx`, `w.$slug.settings.lists.index.tsx`, `w.$slug.settings.lists.$list.$tab.tsx`. Each lazily loaded, out of the first load.
- `ListScreen` reuses the object table's connected grid and the BoardView wiring with a list parent; no new library component. `NewListModal`, `AddEntryModal`, `AddToListPicker` (one Popover Combobox used by the record page, the bulk bar and ⌘K).
- Sidebar: `SidebarSections.tsx` answers the Lists section from `readNav`'s lists, with "+" on the label for members with `lists.manage`.
- Record page: `RecordListsSection` at the end of the Details sidebar; "Add to list" in the header actions.
- Settings: a `lists` entry after `objects` in `settings/nav.ts`; General and Fields tabs (Fields is the object Attributes tab given a list parent).
- Design pass before building (lane brief): the `impeccable`, `interaction-design`, `emil-design-eng`, `interface-affordances`, `ux-heuristics` and `design-engineering` skills, then the reviewers.

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| New list | object choices | `data.objects` filtered by the member's write level (`access.mine`) |
| New list | icon, hue | the Modal's pickers; default icon `list`, hue by spec 0012's next hue rule over the workspace's lists |
| New list | API name | `toApiSlug(name)` with a numeric suffix on clash, on the server |
| New list | Stage options, Owner field | this spec (AC-4802); hues by the next hue rule |
| New list | default view, its kind and grouping | the template: Blank's "All entries" table; Pipeline's "Pipeline" board grouped by the new Stage id |
| Sidebar | list order | `member_nav_prefs.items` (spec 0034), then `lists.id` (UUID v7, so oldest first) |
| List page | last opened view | `member_view_state` (spec 0020), else `defaultViewId` |
| List page | the record column | the object's primary attribute (spec 0012) from the record store |
| List page | Added, Added by | `list_entries.created_at`, `created_by_*` through the system fields |
| List page | count | `entries.count`: `lists.entry_count` when unfiltered and no record rule limits the member; else counted through the rule and filter, capped at 10,000 |
| Settings › Lists | entry count | `lists.entry_count`, sent only to owners and admins (no rule limits them, spec 0032 decision 2) |
| Settings › Lists | created by | `lists.created_by_member_id` through the members list |
| Add Modal | "Already in this list" | `entries.membership(listId, the 8 result ids)` |
| Add Modal | date defaults | the member's time zone (`me.preferences.timeZone`, sent as `timeZone`) |
| Add, every write | entry id | client minted UUID v7 (`data.mintId`) |
| Record page | cards and order | `entries.forRecord`, ordered by list name then `created_at` |
| Record page | "Already in" in the picker | the held `entries.forRecord` answer |
| Board | stuck badge | `getStageSince` on the entry (list field) or the record (object field), with the option's target time (spec 0021) |
| Bulk add | "already in it" count | `entries.addMany`'s `alreadyIn` |
| Remove confirm | the number | the ticked count, or the job's count (spec 0022) |
| Archived page | who may restore | `ListView.canManage` |
| LockReason | the creator's name | `lists.created_by_member_id` through the members list; when that member is gone or the system made the list, the owners and admins sentence (AC-4834) |
| Pipeline | Stage default, Owner default, card fields | this spec (AC-4802): Lead; none; Owner and Added |
| Bulk add job | snapshot, cancel, cap | spec 0022's job rules; stops at 1,000,000 and reports (AC-4825) |
| Import into list | match rule | the object's import match rule (spec 0040) |

### Key invariants

- An entry's record belongs to the list's object; an entry value's attribute belongs to the entry's list (engine and composite keys).
- In a list with `allows_duplicates` false there is at most one live entry per record, checked under the list row lock on add, restore and when turning the setting on.
- `lists.entry_count` equals the live entries and never exceeds 1,000,000; the list row lock serialises it.
- Entry writes lock list, then record, then entry, in that order (the existing lock order).
- A list's level never exceeds its object's level; a hidden object means hidden lists, entries, views and events.
- No read returns, counts or names an entry whose record the reader may not see.
- Screens never fetch: every list read and write goes through `packages/data`.
- Every aggregate over entries (counts, group counts, membership) applies record rules; `lists.entry_count` is shown only where no rule applies.
- Filters and sorts never take a field the member can't see, on either side of the join (the side channel spec 0009 closes for objects).
- A view grouped by a field that is archived or hidden falls back as spec 0020 and 0021 say for objects.

### Security model

- Tenancy: every table is a tenant table with forced row level security; every procedure runs inside `withWorkspace()` through the door.
- Roles: `lists.manage` (owner, admin, member) to make lists; managing a list is `schema.manage` or being its creator with `lists.manage`; entries follow the object's level (spec 0032, decision 7); record and field rules apply.
- API keys: `data.read` and `data.write` act on entries; list definitions stay with people (no key holds `lists.manage`; add it to `KEY_FORBIDDEN_PERMISSIONS`).
- Audit: list create, rename, archive and restore are written to the audit log as `list.created`, `list.updated`, `list.archived`, `list.restored`, each with a History sentence (spec 0046, AC-4605 enforces it).
- No personal data beyond what records already hold; nothing new is regulated.

### Critical test scenarios

- Happy path: a member makes a Pipeline over Deals, adds three deals, drags one to Won on the board, sees it on the deal's page, and a second browser sees each step within a second, verifies **AC-4801**, **AC-4802**, **AC-4813**, **AC-4820**, **AC-4822**, **AC-4839**.
- Concurrency: two members add the same deal to an "Each record once" list at once; one wins, the other gets `ENTRY_EXISTS` and the pinned row leaves, verifies **AC-4814**.
- Undo: remove 48 entries, Undo; one whose record was added again meanwhile stays out and the Toast says so, verifies **AC-4817**, **AC-4818**.
- Access: a member at `none` on Deals gets `NOT_FOUND` for the list, sees no sidebar item, no ⌘K row, no record page section, and no event; at `read`, no Add and no drag; a record rule hides an entry from rows, counts and groups, verifies **AC-4835**, **AC-4836**.
- Managers: a member edits their own list's fields; another member gets `FORBIDDEN` with the creator's name; an admin changes any list, verifies **AC-4834**.
- Scale: the 200,000 entry list on the million record seed within budget, verifies **AC-4841**.
- Isolation: a list id from another workspace answers `NOT_FOUND`, verifies **AC-4838**.

## Build plan

Tracer Bullet: milestone 1 is one thin list, live, end to end in production; each later milestone thickens one strand. Every milestone runs the reviewers its area needs (security-access-reviewer and state-performance-reviewer for server and data, design-system-guardian and ux-interaction-reviewer for screens) and lands green on CI.

**Milestone 1: one list, end to end** (a Blank list over any object, its table, adding, editing, removing, live)
1. Migration: `lists.icon`, `lists.hue`, `lists_name`, the Added and Added by fields for existing lists; guard tests, satisfies **AC-4803**, **AC-4838**.
2. Contracts: `lists.ts` (`ListView`, `CreateListInput`, `UpdateListInput`), `entries.ts` (`EntryView`, `QueryEntriesInput`, `WrittenEntry`, batch results); `lists.manage` in `PERMISSIONS`, `ROLE_PERMISSIONS` and `KEY_FORBIDDEN_PERMISSIONS`; `views` and `attributes` inputs widened to a parent union, satisfies **AC-4834**, **AC-4837**.
3. Core: `insertList` with icon, hue, the Blank template, the system fields and its default view; `defineList` on `lists.manage`; `canManageList`; `checkList`'s object write rule; `listLists`; `addEntry` with a client id; `removeEntries`, `restoreEntries`; `queryEntries`, `countEntries`, `entryMembership`; access table entries; the audit actions and their History sentences, satisfies **AC-4801**, **AC-4802** (Blank), **AC-4803**, **AC-4805**, **AC-4816**, **AC-4818**, **AC-4819** (entries of deleted records left out of every read), **AC-4834** to **AC-4838**.
4. API: the `lists` and `entries` routers; `views`, `attributes` and `options` routers on the parent union; another workspace's list, entry and view ids answer `NOT_FOUND`, satisfies **AC-4811**, **AC-4837**, **AC-4838**.
5. Data layer: `data.lists`, the entry store, `data.entries.view`, the writes with undo, the `entries`, `definitions` and `views` live handlers for lists, satisfies **AC-4809**, **AC-4810**, **AC-4839**, **AC-4840**.
6. Screens: the sidebar Lists section with "+", its item menu and Customise sidebar rows, `NewListModal` (Blank only in this milestone; the Start with control lands with milestone 2, which completes AC-4801), the list route and table, the "+" field column, `AddEntryModal`, row Remove with Undo, every state, satisfies **AC-4801**, **AC-4804**, **AC-4806** to **AC-4807**, **AC-4811** to **AC-4814**, **AC-4817** (one entry), **AC-4819**, **AC-4842**.

**Milestone 2: views and boards**
7. Core and API: `entryGroups` and `entries.groups`; the Pipeline template (Stage, Owner, the board and table views) and the Start with control; list views through every `views.*` procedure; the stuck badge on entry history, satisfies **AC-4801**, **AC-4802**, **AC-4820**.
8. Screens: the list ViewBar with the switcher, filters and sorts over list and object fields, Save and the view menu; the board on a list with Group by over both sides, column "+", the empty state, satisfies **AC-4808**, **AC-4815**, **AC-4820**, **AC-4821**.
9. Scale: the 200,000 entry list on the million record seed; EXPLAIN plans and timings into `verify.md`, satisfies **AC-4841**.

**Milestone 3: lists around the record**
10. Core and API: `addEntries` and `entries.addMany`, `entries.forRecord`, the `entries.addMatching` and `entries.removeMatching` jobs, `bulk.startBulk` widened, satisfies **AC-4817**, **AC-4825**.
11. Screens: the record page Lists section with cards and in place edits, the header and section "Add to list" (`AddToListPicker`), the required fields Modal; the object bulk bar's Add to list; the list bulk bar's Edit and Remove from list with confirm and jobs; ⌘K's lists, "Create list" and "Add to list…", satisfies **AC-4812**, **AC-4817**, **AC-4822** to **AC-4827**.

**Milestone 4: settings, archive and import**
12. Core and API: `updateList` (with the AC-4830 check), `archiveList`, `restoreList`, archived objects counted as archived lists; the import's list target with `.csv` and `.xlsx`, satisfies **AC-4829** to **AC-4833**.
13. Screens: Settings › Lists with the Archived Disclosure, the list's General and Fields tabs, the archive confirm Modal and the archived page, Import on the list menu into spec 0040's flow; `/check verify` over every criterion, satisfies **AC-4828** to **AC-4833**, **AC-4842**.

## Consequences

**Positive**:
- Pipelines arrive without new tables: the engine, values, history, sort keys, views and events already handle entries.
- One view model and one board serve objects and lists, so later view features (reports, the API's saved filters) get lists for free.
- Members can make their own working sets, which is what makes lists useful day to day.

**Negative / tradeoffs**:
- Widening `views`, `attributes`, `options`, `bulk` and `imports` from an object id to a parent union touches many call sites and their tests.
- A list follows its object, so a private pipeline over a shared object is not possible until list level rules arrive.
- A list row shows two kinds of data (entry and record), so the client joins two stores per row, and a filter over both sides joins `list_entries` to `records` in SQL; the scale run must prove it.
- Removed entries have no Trash page; after the Undo Toast is gone, only a record delete and restore brings them back.
- Members making lists means lists can multiply; the 500 cap and archive are the only brakes.

**Neutral**:
- `lists.allows_duplicates` stays `true` by default in the database and the engine, while the API sends `false`; existing seed lists keep duplicates.
- The permission catalog's pinned test changes (a reviewed change).

## Follow-up

- [ ] Per list access (owner decision 2's runner up): list level rules in spec 0032's Access tab.
- [ ] Removed entries in the Trash page (owner decision 12's runner up).
- [ ] The record Activity tab showing "Added to <List>", "Removed from <List>" and entry stage changes.
- [ ] Export a list view as CSV (spec 0040's export with a list source).
- [ ] One way record reference fields on lists (owner decision 7's runner up).
- [ ] Workspace wide list order set by admins, if members ask for a shared order.
- [ ] Automations (#25) triggered by an entry entering a stage, and reports (#52) over lists.
- [ ] Spec 0049 (Duplicates and merge): merging two records that both sit in an "Each record once" list keeps one entry (the surviving record's, else the merged one's, moved over) and removes the other; entries in lists that allow duplicates all move to the survivor.

## Rationale

See [rationale.md](rationale.md).
