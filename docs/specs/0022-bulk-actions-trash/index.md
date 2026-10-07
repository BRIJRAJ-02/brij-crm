# 0022. Bulk actions and trash

**Date**: 2026-10-08
**Status**: Proposed

## Summary

You can select many records in a table, or every record matching the view, and change a field on all of them or delete them. Up to 500 picked records change in one request with the usual instant feedback and undo; anything bigger runs as a background job (spec 0008) that first counts exactly what it will touch, asks you to confirm that number, then works in batches of 500 with progress and a Cancel button. Deleted records go to a workspace Trash for 30 days, where anyone can restore them with their links, notes and history, and owners and admins can delete them forever; after 30 days the existing daily cleanup removes them for good, without waking the database any more often than it already does.

## Structure

- [0022-bulk-jobs.md](0022-bulk-jobs.md): the selection, the inline and job paths, the four job kinds and their steps, the snapshot of "all matching", undo, and how open screens follow a running job without flooding the server.
- [0022-trash-and-purge.md](0022-trash-and-purge.md): the Trash screen, restore and its conflicts, delete forever and empty trash, the purge registry for notes, tasks, comments and files, and how the purge fits the database's sleep.

Reasoning and options: see [rationale.md](rationale.md).

## Dependencies

| Feature | What this spec needs | Thin slice built here when it is missing |
|---|---|---|
| #8 background jobs (spec 0008) | the runner, `startJob` with snapshot and confirm (its milestone 2), cancel, progress events, the `maintenance.daily` kind with its purge phase (its milestone 3), the Background jobs page and finish toasts | none: a hard dependency. Milestone 3 starts after spec 0008 milestone 2, milestone 4 after spec 0008 milestone 3. Milestones 1 and 2 (inline only) ship without it, and selections over 500 say "Changes to more than 500 records arrive soon." until milestone 3 |
| #6 client data (spec 0006) | `records.setValuesBatch`, the undo stack (with create, delete and restore entries registered here, its Follow-up), coarse coalescing, windows | none: a hard prerequisite |
| #20 saved views (spec 0020) | the view screen, the effective filter of the view (for "all matching") | if #20 hasn't landed, the bar works on spec 0006's People table and "all matching" uses its unsaved sort with no filter |
| #9 access (spec 0009) | `records.purge`, field and object levels, `enterAsActor` (a member's job re-entered at every slice, through spec 0008), hidden records absent from snapshots and the trash, the read only message "You can view <plural name> but not change them." | none: milestone 4 comes after spec 0008 milestone 3, which comes after spec 0009 milestone 1 in the build order |
| #7 realtime (spec 0007) | `coarse` events, capped `Change` (AC-83), `outboxHook` | milestone 3 adds `Change.jobId`, an `outbox.job_id` column (never published, like `actor_member_id`) and `fromJob: true` on the `records` event (a flag, not the id, so a job's id never reaches a member who may not read the job, spec 0009's `jobs` rule) |
| #19 notes and tasks | the purge dependents for notes and task links | none: the registry is built here; #19 registers `notes` and `task_records` (its foreign keys to `records` restrict, so a missed delete fails loudly), and whichever lands second wires them |
| #29 comments, #32 files | their purge dependents | the registry is ready; they register later |
| #12 load harness (spec 0011) | the `crm` seed, `steady` | AC-543 runs on the local capped stack; `pnpm db:seed:scale` stands in if needed |

## Requirements

**User stories**:
- As a member, I want to tick a handful of records, or every record my filter shows, and change one field on all of them at once.
- As a member, I want to delete many records at once and undo it if I got it wrong.
- As a member, I want a big change to run in the background with progress and a Cancel button, and to know exactly how many records it will touch before it starts.
- As a member, I want deleted records to wait in a trash for 30 days, and to restore them with everything that hung off them.
- As an owner or admin, I want to delete records forever or empty the trash when I'm sure.
- As the owner of this product, I want deleted data removed for good after 30 days without the cleanup keeping the free database awake.

**Acceptance criteria** (this spec owns AC-522 to AC-551):

*Selecting*
- **AC-522**: Ticking rows in a table (the checkbox column, Space, Shift ranges, Mod+A) shows the BulkActionBar with the count and the actions Edit and Delete. Esc, Clear, and any change to the view's filter or sorts or a switch of view clear the selection. That includes a filter or sort saved by another member (spec 0020 AC-468): the tab moves to the new query and its toast then reads "<Name> changed the filters on this view, so your selection was cleared." Rows deleted elsewhere drop out of the selection and the count.
- **AC-523**: While some rows are ticked and more match, the bar offers "Select all <N> matching" (N is the view's count, "10,000+" when capped). After it, unticking rows keeps "all matching except" those; the 1,001st untick is refused with the toast "You can leave out at most 1,000 records from all matching. Clear and select them one by one instead." and the row stays ticked. A one by one selection holds at most 10,000 records; a Shift range past that is refused with "Select at most 10,000 records one by one, or select all matching."

*Deleting*
- **AC-524**: Deleting one record (the bar with one ticked) moves it to the trash at once, with no confirm: its row leaves every view, and a toast says "Deleted <Name>" with "Undo".
- **AC-525**: Deleting 2 to 500 ticked records asks to confirm ("Delete 48 people? They stay in the trash for 30 days.", danger tone), then sends one `records.deleteMany`; the rows leave at once, the count drops, and a toast says "Deleted 48 people" with "Undo". A refusal for some records (a record deleted elsewhere meanwhile, `RECORD_DELETED`, or one hidden from the member since it was ticked, `NOT_FOUND`) puts those rows back with their message and one toast.
- **AC-526**: Undo of a delete (the toast's "Undo", or Cmd+Z) restores exactly that batch with its links, list entries, notes, task links and full value history. Records that can't come back (a unique value now used by another record, or no record slot left) stay in the trash, and the toast says "Restored 46 people. 2 are still in the trash because a unique value is now used by another record."
- **AC-527**: A delete or restore shows in every other open view of the workspace within 1 second at p95: rows leave or return and counts change; a record panel open on a deleted record shows that it was deleted.
- **AC-528**: Deleting more than 500 records, or all matching, starts a job: the bar shows "Counting…", then a confirm with the exact number ("Delete 12,345 people? They stay in the trash for 30 days."). Confirm runs it with a progress bar ("Deleting 4,500 of 12,345") and Cancel; Cancel stops it before its next batch and the records already deleted stay in the trash. The set is fixed when the count (the snapshot) finishes, and the confirm shows exactly that set; `asOf` only keeps out records created after "Select all" was pressed, which are never touched. A count of zero ends the job at once, and the bar says "Nothing left to change." The job keeps running if the member leaves the page; when it ends, a toast says "Deleted 12,345 people" with "Undo" (restoring that job's batch) and a link to Background jobs. An unconfirmed count is cancelled after 1 hour (spec 0008 AC-109).

*Editing*
- **AC-529**: "Edit" opens a dialog: the field (only attributes the member can write, excluding the primary attribute, system, computed, archived, file, interaction and relationship attributes), the operation (Set or Clear for a single value; Add, Remove, Replace or Clear for a multi value; checked or unchecked for a checkbox), the value through the type's own editor, and "Apply to <N> <plural>". Clear isn't offered on a required attribute. Set on a unique attribute is refused for more than one record, with "<Title> is unique, so several records can't share one value."
- **AC-530**: Editing up to 500 ticked records sends one `records.updateMany`; loaded rows show the new value at once; refused records roll back with their cell message and one toast ("Updated 46 people. 2 were refused." with "Retry"). Cmd+Z undoes the whole edit as spec 0006 undoes a paste, keeping cells someone changed since.
- **AC-531**: Editing more than 500, or all matching, runs as a job with the same count, confirm, progress and Cancel as AC-528. Refused records never stop it; a bulk edit sets values without a "your value was replaced" notice to anyone; the result groups refusals by code with up to 20 records each on the Background jobs page, and the finish toast says "Updated 9,998 people. 2 were refused." Job edits have no undo, and the confirm says so: "This can't be undone."
- **AC-532**: While a job changes an object, every open view of that object stays current without a request storm: the job's events refetch a tab's visible rows and count of that object at most once every 5 seconds, plus once 5 to 7 seconds after the last one (a random wait, so tabs don't refetch together); loaded rows outside the visible ones are marked stale and reread from their checkpoint when they scroll into view. A test with a 50,000 record edit job and 10 open tabs counts each tab's requests.

*Trash*
- **AC-533**: Trash (`/w/$slug/trash`, "Trash" at the foot of the sidebar) lists trashed records of every object the member can see, most recently deleted first: Name (with its object's tile), Object, Deleted by, Deleted, and Removed after (the date 30 days on). An object Select narrows it to one object. It loads in windows like a table, with the count ("10,000+" when capped), and updates live within 1 second as records are deleted, restored or purged anywhere.
- **AC-534**: Selecting trash rows offers "Restore" (and "Delete forever" for owners and admins); Restore is enabled when the member may write at least one selected record's object (for all matching, at least one object in the list's scope). Restoring up to 500 is one request; more, or all matching, is a job with the same count and confirm flow. A record that can't be restored stays in the trash with its reason on its Name cell ("Email jane@acme.com is now used by another record"; for an object the member may only read, "You can view <plural name> but not change them."), and a toast sums it up.
- **AC-535**: Owners and admins (`records.purge`) can delete trashed records forever (up to 500 inline, more as a job) and empty the trash (always a job), each after a danger confirm: "Delete 48 records forever? This can't be undone." and "Empty the trash? 1,234 records will be deleted forever. This can't be undone." Members don't see these actions; a call from one answers 403 `FORBIDDEN` "Only workspace owners and admins can delete records forever." and removes nothing.
- **AC-536**: A record in the trash for more than 30 days is removed for good by the daily cleanup (03:00 UTC, spec 0008 AC-112) with its values and history, links, list entries, stored keys, and every dependent registered in `PURGE_DEPENDENTS` (notes and task links from #19, comments from #29, files from #32 once those exist), each deleted explicitly before its records in the same transaction (foreign keys to `records` restrict, so a missed dependent fails the batch loudly). The retention is fixed at 30 days. A test registers a fake dependent and sees it removed in the same transaction as its record, and counted in `RemovedCounts.dependents`.
- **AC-537**: The purge adds no schedule, timer or poll: it is a phase of the existing daily cleanup, a workspace with nothing past 30 days costs one index probe, and with no user activity the database compute wakes at most once a day. Checked in production over two quiet days (the Neon console's compute history), recorded in `verify.md`.

*Rules*
- **AC-538**: Access: editing needs `write` on the object and the field; deleting and restoring need `write` on the object; delete forever and empty trash need `records.purge`. Records the member can't see are never selected, counted, snapshotted, listed in the trash or touched. A job runs as the member who started it, entered again through spec 0009's `enterAsActor` at every slice (spec 0008 AC-113); a removed member's job ends `ACTOR_REMOVED`.
- **AC-539**: Limits: more than 500 ids inline answers 422 `CONFIG_INVALID`; more than 10,000 one by one ids or 1,000 exceptions answers 422 `CONFIG_INVALID`; more than 1,000,000 records answers `JOB_TOO_LARGE`; a 21st unfinished job answers 409 `LIMIT_REACHED` "Your workspace is already running 20 background changes. Wait for one to finish." Each message shows in the bar or dialog that sent it.
- **AC-540**: Retrying any bulk request after a lost response changes nothing twice: `records.deleteMany` and `records.restoreBatch` are keyed by their batch id, `records.updateMany` writes nothing for a value already set (and returns no `before` for it, so a retried edit pushes no undo entry and its toast has no Undo), and a job start with the same id returns the same job.
- **AC-541**: Cmd+Z after creating a record moves it to the trash ("Undid the create of <Name>"), and after a delete restores it, both through the same undo stack as value changes (spec 0006).

*Quality and proof*
- **AC-542**: Every new surface has its states and keyboard use: the bar (some, all matching, counting, running with known progress, finishing), the dialogs (busy, refused, the unique and required rules), and Trash (loading, empty "The trash is empty. Deleted records stay here for 30 days.", error with Retry, a filter by object matching nothing). Focus returns to what opened each dialog; contrast holds in light and dark; `ux-interaction-reviewer`, `design-system-guardian` and `dxe quick` pass.
- **AC-543**: On the local capped stack with the `crm` seed: deleting 500 ticked records answers within 2 seconds at p95 and editing 500 within 2 seconds; a delete job of 100,000 records and an edit job of 100,000 each finish within 10 minutes; while the edit job runs, `steady` at 100 members is measured and its read and edit p95 recorded. Results in `verify.md`.
- **AC-544**: Inline bulk edit and delete, the delete job with undo, the edit job, restore with a conflict, delete forever and the trash purge run in production on brij-crm-phi.vercel.app, with two browser Playwright flows locally and against production. Results in `verify.md`.

## Decision

**Chosen option**: Option 1: two paths behind one bar. Up to 500 picked records go inline through the engine's batch writes in one transaction, with optimistic rows and undo; anything bigger, or "all matching", becomes a job that snapshots the exact ids, waits for a confirm, and works in batches of 500. Deletes carry a batch id so a whole delete can be undone; the trash is the records table itself (`deleted_at`), listed by two new partial indexes, and the purge stays the daily cleanup's phase.

Calls made here (the rationale has the runner up for each):
- **500 is the inline limit** (brief), matching `setValuesBatch` and the grid's paste limit (spec 0006 AC-50).
- **"All matching" is snapshotted and confirmed** (brief): the member confirms the exact count, and records created after the selection are never touched.
- **Undo**: inline edits and every delete (inline or job) are undoable; job edits are not, in v1 (brief).
- **Retention is fixed at 30 days** (brief and spec 0004's `RESTORE_WINDOW`).
- **Delete forever and empty trash are owners and admins only** (`records.purge`, spec 0009).
- **Relationship attributes are left out of bulk edit in v1**: their many sides need spec 0014's link deltas in batches and have no versions to undo by. Owner decision 3.
- **No confirm for deleting a single record**, since undo is one click away; a confirm for two or more.
- **Job events refresh open views at most every 5 seconds** instead of every second, so a long job can't multiply the read load.
- **A query change clears the selection, even one saved by someone else**, and the toast says so (owner decision 5).
- **Purge dependents are deleted explicitly through one registry**, never by a cascade: foreign keys to `records` restrict, so a feature that forgets to register fails the purge loudly instead of leaving rows behind or deleting them silently.

**Implementation skills**: `drizzle` (`.claude/skills/drizzle/`) · `neon-postgres` (`neondatabase/agent-skills`, `.claude/skills/neon-postgres/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `db-core` and `react-db` (`tanstack/db`, `.claude/skills/db-core/`, `.claude/skills/react-db/`) · `react-aria` (`.claude/skills/react-aria/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`) · `system-design` (`anthropics/knowledge-work-plugins`, `.claude/skills/system-design/`) · house skills `crm-api-backend`, `crm-data-model-access`, `crm-frontend-state`, `crm-design-system`

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Data model sketch (one migration, milestone 1)

| Table | Change | Rules |
|---|---|---|
| `records` | new `deleted_batch_id` uuid null | Set with `deleted_at` by every delete (the client's batch id inline, the job id in a job); cleared by restore. Check: `deleted_batch_id` is null when `deleted_at` is null. |
| `records` indexes | new `records_trash_time` (`workspace_id`, `deleted_at`, `id`) where `deleted_at is not null`; `records_trash_object` (`workspace_id`, `object_id`, `deleted_at`, `id`) where `deleted_at is not null`; `records_trash_batch` (`workspace_id`, `deleted_batch_id`) where `deleted_batch_id is not null` | Partial, so they hold only trashed rows (about 1% on the seed). The first serves the workspace trash and the purge's `deleted_at < cutoff order by deleted_at, id`; the second the trash by object; the third restore by batch. `records_trashed` (spec 0004) stays for list counts. Built with `create index concurrently` in their own migration statements. |
| `outbox` | new `job_id` uuid null (milestone 3, its own migration) | Set by `outboxHook` from `Change.jobId` on rows written by a job batch. Never published, like `actor_member_id`: the `records` event gains only `fromJob: true`, so a job's id never reaches a channel whose members may not read the job (spec 0009's `jobs` rule). Kept for the audit log (#36). |
| `jobs` | none | Four new kinds (below), registered in `JOB_KINDS`. |

No trash table: a trashed record is a `records` row with `deleted_at` set, as spec 0004 built it.

### API surface

oRPC on `/api/rpc`, all on `member` with `WorkspaceScoped` input; refusals `{ code, message, data? }`. Shapes in `packages/contracts/src/bulk.ts` and `trash.ts` (new).

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `records.deleteMany` | `objectId`, `recordIds` 1 to 500, `batchId` uuid v7, `mutationId` | `{ results: [{ recordId, state: 'deleted' \| 'already-deleted', refusal? }] }` | object `write`, checked once for the call | 403 `FORBIDDEN` (the object is read only for the member: nothing deleted); 422 `CONFIG_INVALID` (over 500); per record `NOT_FOUND` (unknown, of another object, or hidden by a record rule) |
| `records.updateMany` | `recordIds` 1 to 500, `attributeId`, `op` (`set`, `clear`, `add`, `remove`, `replace`), `value?`, `mutationId` | `{ results: [{ recordId, record?: RecordView, before?: unknown, refusal? }] }` (`before` only for records this call changed) | object and field `write` | 422 `CONFIG_INVALID` (over 500, an op the type doesn't take, Set on unique for more than one record, Clear on required, an excluded attribute); per record refusals as `setValues` |
| `records.restoreBatch` | `batchId`, `jobId` uuid v7 (used only if it becomes a job), `mutationId` | `{ mode: 'inline', results: [{ recordId, record?, refusal? }] }` or `{ mode: 'job', job: JobView }` | object `write` | 404 (no trashed record holds the batch) |
| `records.startBulk` | `id` uuid v7 (the job id), `action` (`edit`, `delete`, `restore`, `purge`), `target` (below), `edit?` `{ attributeId, op, value? }` | `JobView` (status `preparing`) | per action | 409 `LIMIT_REACHED`; 422 `CONFIG_INVALID`, `JOB_TOO_LARGE`, `FILTER_INVALID`; 403 `FORBIDDEN` |
| `trash.query` | `objectId?`, `cursor?`, `limit` ≤ 200 | `{ items: TrashItem[], nextCursor? }` | member | 404; 422 `FILTER_INVALID` (bad cursor) |
| `trash.count` | `objectId?` | `{ count, atLeast }` (capped at 10,000) | member | 503 `QUERY_CANCELLED` |
| `trash.restore` | `recordIds` 1 to 500 (any objects), `mutationId` | `{ results: [{ recordId, record?, refusal? }] }` | object `write`, per record's object | 422 `CONFIG_INVALID`; per record `FORBIDDEN` ("You can view <plural name> but not change them."), `UNIQUE_CONFLICT`, `LIMIT_REACHED`, `NOT_FOUND` (expired, gone or hidden) |
| `trash.deleteForever` | `recordIds` 1 to 500, `mutationId` | `{ results: [{ recordId, state: 'purged' \| 'not-in-trash' }] }` | `records.purge` | 403 `FORBIDDEN`; 422 `CONFIG_INVALID` |
| `jobs.confirm`, `jobs.cancel`, `jobs.get` (spec 0008) | as spec 0008 | | | |

`target` (`BulkTarget`, Zod union):
- `{ kind: 'ids', objectId, recordIds }`: 1 to 10,000 ids.
- `{ kind: 'matching', objectId, filter?, except, asOf, now, timeZone }`: `except` up to 1,000 ids, `asOf` the ISO time "Select all" was pressed.
- `{ kind: 'trash', objectId?, except, asOf }`: every trashed record (of one object or all) deleted at or before `asOf`.
- `{ kind: 'batch', batchId }`: the records of one delete batch still in the trash (restore only).

`TrashItem`: `{ recordId, objectId, display: RecordRefDisplay, deletedAt, deletedBy: { type, memberId? }, batchId, expiresAt }`.

New codes: none. Reused: `CONFIG_INVALID`, `FORBIDDEN`, `NOT_FOUND`, `UNIQUE_CONFLICT`, `LIMIT_REACHED`, `RECORD_DELETED`, `JOB_TOO_LARGE` and the job codes of spec 0008. Per record states `already-deleted` and `not-in-trash` are results, not errors.

### Job kinds (all heavy lane, member actor, cancellable, batch 500, snapshot with confirm)

| Kind | Label (`JOB_KINDS`) | Snapshot | Step per item |
|---|---|---|---|
| `records.bulk_edit` | "Bulk edit" | `matchingIds` for `matching`, the given ids for `ids` | under the record lock: deleted → skipped `RECORD_DELETED`; compute the new value from the op; write through the engine's batch path; refusal → refused with its code |
| `records.bulk_delete` | "Bulk delete" | as above | `deleteRecords` with `batchId` = the job id; already deleted → skipped |
| `records.bulk_restore` | "Restore from trash" | `trashIds` for `trash`, `batchIds` for `batch` | `restoreRecords`; live → skipped; conflicts and limits → refused |
| `records.purge` | "Delete forever" | `trashIds` for `trash`, the given ids for `ids` | `purgeRecords`; not in trash → skipped |

Details in [0022-bulk-jobs.md](0022-bulk-jobs.md).

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| bar | the count | `selectedCount(selection, total)` (the grid's `grid-selection.ts`), `total` from the window's count |
| bar | "Select all <N> matching" | the window's `count` and `atLeast` |
| bar | progress label and value | `JobView.status`, `done`, `total` through `data.jobs` |
| "all matching" | `asOf` | `new Date().toISOString()` when "Select all" is pressed; the server uses `least(asOf, now())` |
| "all matching" | filter, `now`, `timeZone` | the view's effective filter (spec 0020) and spec 0006's clock values at that moment |
| inline delete | `batchId` | uuid v7 minted in the browser, kept in the undo entry and the toast |
| job | `id` | uuid v7 minted in the browser (spec 0008's idempotent start) |
| job delete | the batch id written | the job id |
| confirm | the exact count | `JobView.total` when the job reaches `ready` |
| confirm | the plural name | the object's `pluralName` (or "records" for the workspace trash) |
| inline edit | `before` per record | the engine's current value under the record lock, read before the write |
| inline edit | the new value per record | `applyOp(op, current, value)` in `@crm/contracts` (pure; dedupes Add, keeps existing order then new items) |
| undo of inline edit | cells | `{ recordId, attributeId, before, writtenVersionId }` from each result |
| undo of a delete | what to restore | the entry's `batchId` → `records.restoreBatch` |
| undo of a create | what to delete | the created record id → `records.deleteMany` with a new `batchId` |
| refusal summary | groups | spec 0008's `job_items` grouped by `code`, 20 ids each; names from `records.get` (a record since purged shows "Deleted record") |
| trash list | rows and order | `records` where `deleted_at is not null`, keyset (`deleted_at` desc, `id` desc), through the door |
| trash list | name and tile | the record's `display` (spec 0004 AC-19: the primary attribute's value, which stays current in the trash) and its object's tile; when the primary attribute is hidden from the member, `filterRecordView` leaves the value out and the chip reads "Unnamed <singular>", the same as an empty name, so nothing tells a hidden name from an empty one |
| trash list | a row's refusal message | `cellErrors` on the Name cell (`<recordId>:name`), the DataGrid's existing cell error; no new row variant |
| trash bar | Restore enabled | some: at least one selected record's object is at `write` for the member; all matching: at least one object in the list's scope (the object filter, or every listed object) is at `write` |
| trash list | Deleted by | `deleted_by_*` columns; member names from the definitions store; "Someone removed from this workspace" for an inactive member; "The system" or "An API key" otherwise |
| trash list | Removed after | `deleted_at + RESTORE_WINDOW` (30 days), shown as a date in the browser's time zone |
| live refresh | job event rate | `COARSE_JOB_MS` = 5,000 in `packages/data`, leading and trailing, per object, for `records` events with `fromJob` |
| live refresh | what a job event rereads | the visible blocks of each window on that object and their counts, plus held `records.one` bodies; the other loaded blocks (spec 0006's overscan) are marked stale and reread from their checkpoint when they come into view or at the next settle, whichever is first |
| inline edit undo | whether to push one | only when at least one result carries `before` (a record this call changed); a retry after a lost response changes nothing, so it pushes none |
| job | a snapshot of zero | the kind ends the job `succeeded` with `total` 0 instead of `ready` (no confirm), and the bar shows "Nothing left to change." |
| selection | cleared by someone's save | a refetched view whose `queryVersion` grew (spec 0020) resets the window key and so the selection; the toast's text gains ", so your selection was cleared" when the selection held any row |
| purge | what is old | `deleted_at < now() - RESTORE_WINDOW` (spec 0004) |
| purge | dependents | `PURGE_DEPENDENTS` registry in `packages/core/src/engine/purge-dependents.ts`: each registered feature deletes its rows explicitly, before the records, in the same transaction; their counts go to `RemovedCounts.dependents[name]` |

### Key invariants

- Every delete sets `deleted_batch_id`; every restore clears it. Undo of a delete restores only records still holding that batch id.
- A job touches exactly its snapshot; an item changed since is checked again in its batch (spec 0008 AC-109).
- An inline call is one transaction with a savepoint per record and one outbox row per object (spec 0005's rule that a batch never splits).
- Purge removes the registered dependents, then values, links, entries, stored keys, then records, in one transaction per batch, in foreign key order. No foreign key to `records` cascades; a dependent nobody registered makes the batch fail, never vanish silently.
- No new timer, cron or poll anywhere: the purge rides `maintenance.daily`.
- Hidden records never enter a selection, a snapshot, a count or the trash list.

### Security model

- Every procedure passes the member door; `records.startBulk` checks the action's permission at start, and the runner checks it again at every slice through spec 0009's `enterAsActor` (spec 0008 AC-113), so a member demoted mid job stops.
- The "all matching" snapshot compiles the filter through the engine as the member (spec 0009's compiled predicate), so a job can never reach a record the member couldn't see when it started.
- Purge (delete forever, empty trash) needs `records.purge`; the daily purge runs as the system actor in the worker only.
- Job params hold ids, the filter, the op and the value (a value the member typed; never a secret). Logs never include params or values (spec 0008 AC-120).
- A job written `records` event carries `fromJob: true`, never the job id, so the id stays on channels spec 0009's `jobs` rule allows.
- Refusal messages follow spec 0009 AC-144 (a restore conflict names only attributes the actor can see).
- Erasure (#36) is not purge: it stays `eraseRecord`, which this spec doesn't change.
- `security-access-reviewer` reviews milestones 1, 3 and 4; `state-performance-reviewer` reviews milestones 2 and 3.

### Configuration required

None. No new environment variables; the purge uses spec 0008's worker settings.

### Critical test scenarios

- Inline delete and undo: tick 48 people, delete, undo; links, list entries, notes and history are back; one record whose email was taken meanwhile stays in the trash with the summary toast, verifies **AC-524** to **AC-527**.
- Job delete: all matching (12,345 with a filter), count, confirm, cancel halfway, then delete the rest and undo from the finish toast; a record created after "Select all" is untouched, verifies **AC-528**, **AC-540**.
- Edit: Add a tag to 300 people (multi select), Set Stage on 40 deals, Clear a required attribute (not offered), Set a unique attribute on two records (refused); Cmd+Z after the 300; a job edit on 9,998 records with 2 refused, verifies **AC-529** to **AC-531**.
- Live: a 50,000 record edit job with 10 tabs open; per tab requests counted; views current 5 seconds after it ends, verifies **AC-532**.
- Trash: list and filter by object; restore 3 inline and 1,200 by job (the open views 5 seconds behind at most, with overscan rows reread as they scroll in); a conflict on a row; a member doesn't see Delete forever and gets 403 on the call; an admin empties the trash, verifies **AC-533** to **AC-535**, **AC-538**.
- Purge: records 31 days in the trash with a fake registered dependent removed by the daily cleanup; 29 days kept; nothing else woken (worker logs and the Neon console), verifies **AC-536**, **AC-537**.
- Limits and retries: 501 inline, 10,001 ids, 1,001 exceptions, the 21st job; a retried `deleteMany` with the same batch id; a retried `updateMany` returns no `before` and pushes no undo entry, verifies **AC-523**, **AC-539**, **AC-540**.
- Edge cases: "Select all" on a filter that matches nothing by the time the snapshot runs ends the job `succeeded` with total 0 and "Nothing left to change."; another member saves the view's filter while rows are ticked, and the selection clears with the toast, verifies **AC-522**, **AC-528**.
- Read only trash (rules injected): a member who may only read Deals selects a trashed deal and a trashed person; Restore is enabled; the person comes back and the deal's Name cell shows "You can view deals but not change them."; with the primary attribute hidden, the chip reads "Unnamed deal", verifies **AC-534**, **AC-538**.
- Access (rules injected): a hidden record is never in a snapshot or the trash; a read only field is not offered; a removed member's running job ends `ACTOR_REMOVED`, verifies **AC-538**.

## Build plan

Tracer Bullet: milestone 1 threads a delete from the bar through the engine, the trash and back with undo, in production; milestone 2 adds inline edits; milestone 3 hands big work to jobs; milestone 4 completes the trash and the purge.

**Milestone 1: delete, the trash and undo, inline**
1. Migration: `records.deleted_batch_id` with its check, the three partial indexes; guard tests unchanged (no new table), satisfies **AC-526**, **AC-533**
2. Engine: `deleteRecords(scope, { recordIds, batchId })` (rows locked in id order, one counter row take at the end), `restoreRecords(scope, { recordIds })` with a savepoint per record, `restoreBatch`, `queryTrash` and `countTrash`; tests on real Postgres including links, entries and history round trips, satisfies **AC-524** to **AC-527**, **AC-533**
3. Contracts and API: `records.deleteMany`, `records.restoreBatch` (inline only until milestone 3), `trash.query`, `trash.count`, `trash.restore`; access table entries, satisfies **AC-524** to **AC-526**, **AC-534**, **AC-540**
4. Data layer: selection held by the screen (UI state), cleared on any query change including another member's save, optimistic delete, the undo entries for create, delete and restore (spec 0006's Follow-up), `data.trash` windows by cursor, satisfies **AC-522**, **AC-524** to **AC-526**, **AC-541**
5. Screens: the BulkActionBar on the view screen with Delete and its confirm; the Trash route, sidebar entry, read only DataGrid with synthetic columns, object Select, Restore (enabled when any selected object is writable), refusals on the Name cell through `cellErrors`; every state; reviewers, satisfies **AC-522**, **AC-524**, **AC-525**, **AC-533**, **AC-534**, **AC-542**
6. Deploy; Playwright delete, undo and restore with two browsers in production; `security-access-reviewer`, satisfies **AC-527**, **AC-544**

**Milestone 2: inline bulk edit**
7. Contracts: `BulkOp`, `applyOp` per type, the excluded attribute rule, satisfies **AC-529**
8. Engine and API: `updateMany` on the engine's batch path (current value under the lock, `before` returned for each record the call changed), `records.updateMany`, satisfies **AC-529**, **AC-530**, **AC-540**
9. Data layer and screen: the Edit dialog (field Select, operation SegmentedControl, the type's editor), optimistic apply on loaded rows, rollback, the undo entry; reviewers, satisfies **AC-529**, **AC-530**, **AC-542**
10. Deploy; Playwright; `state-performance-reviewer`, satisfies **AC-530**, **AC-544**

**Milestone 3: big changes as jobs (after spec 0008 milestone 2)**
11. Migration and engine: `outbox.job_id`; `Change.jobId` set by the runner's write context and stored by `outboxHook`; `fromJob: true` on the `records` event in `ChangeEvent`; `matchingIds` (keyset by id over the compiled filter, `created_at ≤ asOf`, minus `except`), `trashIds`, `batchIds`; the four kinds with the shared kind contract test, a snapshot of zero ending `succeeded`, satisfies **AC-528**, **AC-531**, **AC-532**, **AC-538**, **AC-539**
12. API: `records.startBulk`; `records.restoreBatch` turning into a job past 500, satisfies **AC-528**, **AC-531**, **AC-534**, **AC-539**
13. Data layer: "Select all matching" with exceptions, the counting and confirm flow through `data.jobs`, progress in the bar, the finish toasts with Undo for deletes, `fromJob` events coalesced at 5 seconds per object rereading visible blocks and marking the rest stale, satisfies **AC-523**, **AC-528**, **AC-531**, **AC-532**
14. Screens: the bar's all matching, counting and running states; the confirm dialogs; reviewers, satisfies **AC-523**, **AC-528**, **AC-531**, **AC-542**
15. Deploy; the 50,000 record job with 10 tabs; the job sizes and times of AC-543 on the local capped stack, `verify.md`; `security-access-reviewer`, `state-performance-reviewer`, satisfies **AC-532**, **AC-543**

**Milestone 4: delete forever and the purge (after spec 0008 milestone 3)**
16. Engine: `purgeRecords(scope, { recordIds })` (trashed only), `PURGE_DEPENDENTS` called inside `removeRecords` before values (each dependent deleted explicitly and counted in `RemovedCounts.dependents`), the `records.purge` kind, satisfies **AC-535**, **AC-536**
17. The daily cleanup's purge phase checks with one probe on `records_trash_time` before batching, and uses `purgeBatch` over the same dependents; a fake dependent test, satisfies **AC-536**, **AC-537**
18. API and screens: `trash.deleteForever`, "Delete forever" and "Empty trash" for `records.purge` holders with their confirms, satisfies **AC-535**, **AC-542**
19. Deploy; watch two quiet days of the Neon compute in production and record them; the full Playwright suite locally and in production; every reviewer before it lands, satisfies **AC-537**, **AC-544**

## Consequences

**Positive**:
- Bulk changes use the same engine paths, history, events and access checks as single edits; there is no bulk specific write logic beyond computing the op.
- A delete of any size is undoable for 30 days by its batch, and every member can recover their own mistakes from the trash.
- Big jobs are fair, resumable and cancellable for free (spec 0008).
- The purge costs nothing extra on Neon's free plan.
- One registry deletes every dependent explicitly; a feature that forgets to register fails the purge in tests instead of leaving rows behind.

**Negative / tradeoffs**:
- Job edits can't be undone in v1; only the confirm protects them.
- "All matching" is fixed when the snapshot finishes: the snapshot walks the filter by record id, so a record edited to match or stop matching while it runs is caught or missed depending on whether the walk had passed it; after it finishes, a record that starts matching isn't included and one that stops matching is still changed. `asOf` only keeps out records created after "Select all".
- A bulk edit, inline or as a job, replaces values without a "your value was replaced" notice to the members whose values it overwrote.
- While a job runs, other members' views of that object refresh every 5 seconds rather than within 1, and their order and counts lag accordingly; rows just outside the screen are reread only when they scroll in.
- A save of the view's filter by another member clears this member's selection; the toast says so, but the ticks are gone.
- A 500 record delete in one transaction reads every record's far links, so a batch of hub records is slow (bounded by spec 0007 AC-83's cap per object).
- Relationship attributes can't be bulk edited yet.
- Three more partial indexes on `records`, small but written on every delete and restore.
- A retried inline edit after a lost response can't be undone from the toast (the first response, which held the old values, never arrived).

**Neutral**:
- Two migrations (a column and three indexes in milestone 1; `outbox.job_id` in milestone 3). Four job kinds. Six procedures plus `records.startBulk`.
- The `records` event gains an optional `fromJob` flag.
- The refetch load during a job: each tab holding rows of the object rereads its visible blocks and count at most once every 5 seconds; a tab that holds a job of its own (the starter, or an admin) also refetches it on each coarse `jobs` event, at most once a second (spec 0008). #12 measures both.

## Follow-up

- [ ] **Spec 0006**: register create, delete and restore entries in the undo stack (its Follow-up) as built here; add `COARSE_JOB_MS` beside `COARSE_MS`, and the rule that a `fromJob` refetch rereads visible blocks and marks the rest stale (`/sync`).
- [ ] **Spec 0007**: `outbox.job_id` (never published), `Change.jobId`, and `fromJob` on the `records` event (`/sync`).
- [ ] **Spec 0008**: the daily cleanup's purge phase probes `records_trash_time` once before batching, and `purgeBatch` deletes the `PURGE_DEPENDENTS` rows explicitly; a kind may end a confirmed snapshot of zero `succeeded` with `total` 0 instead of `ready` (`/sync`).
- [ ] **Spec 0004**: `removeRecords` calls `PURGE_DEPENDENTS` before values, and `RemovedCounts.dependents` counts them; foreign keys to `records` from feature tables restrict (`/sync`).
- [ ] **Spec 0011 (#12)**: measure the refetch load from coarse job events (5 seconds per object for records, once a second for `jobs`) during a 50,000 record job at 100 online, beside the coarse `views` events of spec 0020.
- [ ] **#19**: register `notes` and `task_records` in `PURGE_DEPENDENTS`, with restrict foreign keys to `records`.
- [ ] **#29, #32**: register comments and files the same way; #32's dependent deletes the file rows and starts a light job to delete the stored objects from R2, since a transaction can't call the network.
- [ ] **#15**: bulk Add and Remove on relationship attributes through `writeLinksDelta` in batches.
- [ ] **#17**: the record page's deleted state and its Restore button.
- [ ] **#21**: selecting cards on a board for bulk actions.
- [ ] **#36**: erasure stays separate from purge but uses the same registry; the audit log records bulk jobs by job id (from `outbox.job_id`) with counts.
- [ ] **#51**: "Add to list" in the bar.

## Owner decisions

**Answered by the owner on 3 October 2026 (the recommended defaults for #11 to #22) and in the cross check of 8 October 2026.**

1. **Should deleting a single record ask to confirm?** Decided: no; the toast's Undo and the trash cover it. Runner up: always confirm.
2. **Should bulk edit jobs be undoable?** Decided: not in v1 (brief); the confirm states it. Runner up: record each job's before values and offer "Undo" for 30 days, which doubles the job's writes.
3. **Should relationship attributes be bulk editable in v1?** Decided: no; add them with spec 0014's link deltas right after. Runner up: Set and Clear only on sides that hold one.
4. **Should the trash keep records for longer than 30 days on paid plans?** Decided: no, fixed at 30 days (brief); plans (#38) can revisit.
5. **A filter or sort saved by someone else while rows are ticked**: decided, the selection is cleared as for any query change, and the "<Name> changed the filters on this view" toast says the selection was cleared.
