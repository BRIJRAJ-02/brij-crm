# 0022. Bulk changes: selection, inline calls, jobs and undo

## Summary

The bar decides one thing: is this 500 or fewer records I have by id, or more? The small case is one request in one transaction, shown at once and undoable. The big case is a background job that first writes down exactly which records it will touch, shows you that number, and only then starts. Deletes always carry a batch id, which is how any delete, small or huge, is undone.

## The selection (UI state, in the view screen)

- The DataGrid's `GridSelection` (`grid-selection.ts`): `{ kind: 'some', ids }` or `{ kind: 'all-matching', except }`. It lives in the screen's state, keyed by the view's window key; a new key (filter, sorts or view changed) resets it to `noRows()`.
- "Select all matching" sets `{ kind: 'all-matching', except: ∅ }` and records `asOf = new Date().toISOString()` beside it, with the effective filter, `now` and `timeZone` at that moment.
- Limits enforced in the screen before any request: `some` at most `BULK_IDS_MAX` (10,000); `except` at most `BULK_EXCEPT_MAX` (1,000) (both in `@crm/contracts`). The grid's `resolveKeys` resolves a Shift range's ids through the window (spec 0006) before it is accepted.
- Rows a read leaves out (deleted or hidden elsewhere) are removed from a `some` selection when the window drops them.

## Choosing the path

| Selection | Action | Path |
|---|---|---|
| `some`, 1 id | Delete | inline, no confirm |
| `some`, 2 to 500 ids | Delete | confirm, then inline |
| `some`, 1 to 500 ids | Edit | the edit dialog, then inline |
| `some`, 501 to 10,000 ids | Delete or Edit | job with `target: { kind: 'ids' }` |
| `all-matching` | Delete or Edit | job with `target: { kind: 'matching' }` |

Before #8's milestone 2 (and so before this spec's milestone 3), the job rows answer in the bar: "Changes to more than 500 records arrive soon."

## Inline calls

**`records.deleteMany`** → engine `deleteRecords(scope, { recordIds, batchId })` (`packages/core/src/engine/deletion.ts`):
1. One `runWrite`. Lock the rows `where id = any($ids) order by id for no key update` (one order for every caller, so two bulk deletes never deadlock).
2. Records already deleted answer `already-deleted` (with this `batchId`: a retry; with another: deleted by someone else) and are not touched.
3. For each live one, in id order: set `deleted_at = clock_timestamp()`, the actor, `deleted_batch_id = batchId`; collect its live entries and far references (spec 0007 AC-83 caps per object).
4. `holdUniqueKeys` and `setRecordKeysLive(false)` once for all ids; `takeRecordSlots(-n)` last.
5. `context.record({ deletedRecords, hiddenEntries, references })`: one outbox row per object.
- A per record refusal (the door's object `write`, or a record the member can't see: `NOT_FOUND`) leaves that record out and is returned in its result; the rest land.

**`records.restoreBatch`** → count the records with `deleted_batch_id = batchId` (index `records_trash_batch`). Zero: 404 `NOT_FOUND` "Nothing from that delete is still in the trash.". Up to 500: `restoreRecords` inline. More: start `records.bulk_restore` with `target: { kind: 'batch', batchId }` and the given `jobId`, `confirm: false` (an undo doesn't ask twice), and answer `{ mode: 'job' }`.

**`restoreRecords(scope, { recordIds })`**: one `runWrite`, rows locked in id order. First it reads the free record slots (the limit minus `workspace_counters.live_records`, without locking the counter row, which every write takes last). Each record, in id order and while slots remain, runs spec 0004's restore steps in its own savepoint (release unique keys, clear `deleted_*` and `deleted_batch_id`, keys live); a `UNIQUE_CONFLICT` or an expired record rolls back to its savepoint and is returned as a refusal; records past the free slots are refused `LIMIT_REACHED` "Your workspace holds 1,000,000 records, the most it can. Delete some before restoring." `takeRecordSlots(+restored)` runs last; if creates elsewhere took the slots in between, it refuses and the whole call answers that same `LIMIT_REACHED` (nothing restored), which a retry resolves.

**`records.updateMany`** → engine `updateMany(scope, { recordIds, attributeId, op, value })`:
1. Check the attribute (not excluded, field `write`) and the op for its type (table below); a unique attribute with `op: 'set'` and more than one id, or `clear` on a required one, refuses `CONFIG_INVALID` before any write.
2. One `runWrite` through the engine's batch path (`setValuesBatch`): per record, under its lock, read the current value, compute `applyOp(op, current, value)`, and write it (no `baseVersionId`, so no replaced notices for a bulk change). An unchanged value writes nothing and still returns the record.
3. Each result carries the `RecordView` (with versions) and `before` (the value read under the lock).

**Ops by type** (`applyOp` in `@crm/contracts/values`):

| Attribute | Ops | Meaning |
|---|---|---|
| single value types (text, long text, number, currency, date, timestamp, select, status, rating, email, phone, url, domain, location, member) | `set`, `clear` | the value; empty |
| checkbox | `set` with `true` or `false` | checked or unchecked (never empty) |
| multi value types (`isMulti` select, member, email, phone, domain) | `add`, `remove`, `replace`, `clear` | existing items then the new ones not already there; existing minus the given; the given list; empty |
| excluded | none | the primary attribute, system attributes, computed (#16), archived, read only for the member, file, interaction, and record references (v1) |

`clear` isn't offered for a required attribute. The value is checked by the type's schema on the server (`ATTRIBUTE_VALUE_INVALID`), and an archived option is refused `OPTION_ARCHIVED` per record.

## Optimism and undo (`packages/data`)

- Delete: every loaded row of the ids gets a "deleted" layer (removed from every window and subscription at once); results confirm or drop the layer per record; a refused one comes back with its message. The undo entry `{ kind: 'batch', label: 'Deleted 48 people', batchId }` is pushed when the response lands with at least one record deleted.
- Edit: loaded bodies holding the attribute get the op applied as a layer (`applyOp` in the browser, the same function); unknown bodies get nothing until the response. The undo entry is spec 0006's value entry with `cells = results.map(r => ({ recordId, attributeId, before: r.before, writtenVersionId: r.record.versions[attributeId] }))`, leaving out unchanged and refused records.
- Create (spec 0006's Follow-up): after `records.create` confirms, push `{ kind: 'create', label: 'Created <Name>', recordId }`; running it calls `records.deleteMany([recordId], newBatchId)` and then pushes nothing (no redo).
- Running a `batch` entry calls `records.restoreBatch`; records refused come back in a toast (AC-526's text); a job answer shows "Restoring <N> <plural>" through `data.jobs`.
- Toast copy lives in `apps/web/src/features/views/strings.ts`; the layer returns facts only.

## Jobs

**Start**: `records.startBulk` calls spec 0008's `startJob` inside its transaction with `id` (the client's uuid v7), `kind`, `params` (strict Zod per kind: `{ objectId?, target, edit? }`; `matching` targets keep their filter, `now`, `timeZone`, `asOf` and `except`), `snapshot: true`, `confirm: true`, and `subject: { type: 'object', id: objectId }` when there is one object. The member's permission for the action is checked first (object `write` and field `write` for edit, object `write` for delete and restore, `records.purge` for purge).

**Snapshot** (spec 0008's `snapshot(tx, params, after, 5000)`, keyset by record id, 5,000 per transaction):
- `matchingIds`: `queryIds` over the compiled effective filter as the member (the access predicate applies), `created_at ≤ least(asOf, job created_at)`, `id > after`, minus `except`.
- `ids`: the given ids, live (edit, delete) or trashed (restore, purge) ones only.
- `trashIds`: `deleted_at is not null and deleted_at ≤ asOf`, one object or all, minus `except`, through the door's object levels.
- `batchIds`: `deleted_batch_id = batchId and deleted_at is not null`.
- More than 1,000,000 ids ends the job `failed` with `JOB_TOO_LARGE` "This would change more than 1,000,000 records. Narrow the filter." (spec 0008 AC-116).

**Confirm**: the bar's tab polls nothing; it waits for the job's `jobs` events (spec 0008) to show `ready` with `total`, then opens the confirm. "Confirm" calls `jobs.confirm`; "Cancel" calls `jobs.cancel`. If the tab closes, the job stays `ready` and expires after 1 hour (`JOB_EXPIRED`), visible on the Background jobs page.

**Steps** (batch 500; each batch one engine transaction with the runner's checkpoint, spec 0008):
- `records.bulk_edit`: `updateMany` over the batch's ids; per item `done`, `refused` with the refusal code and message, or `skipped` `RECORD_DELETED` for a record trashed since.
- `records.bulk_delete`: `deleteRecords` with `batchId = job.id`; `already-deleted` → `skipped` `RECORD_DELETED`.
- `records.bulk_restore`: `restoreRecords`; a live record → `skipped` `RECORD_LIVE`; conflicts → `refused` `UNIQUE_CONFLICT`; expired → `skipped` `NOT_FOUND`; records past the free slots → `refused` `LIMIT_REACHED` (a whole batch refused by the race described above counts as a batch error, so the runner retries it, spec 0008 AC-104).
- `records.purge`: `purgeRecords`; not in the trash → `skipped` `RECORD_LIVE`.
- Each step calls `context.record({ coarseObjects: [objectId] })`, so its outbox row is coarse, and the runner sets the row's `job_id`.

`RECORD_LIVE` ("That record isn't in the trash.") is a new item code, stored on `job_items` only, never an HTTP answer.

**Progress in the bar**: `data.jobs` (spec 0008) exposes the job by id; the bar's `progress` is `{ label, value: done / total × 100 }` with labels "Counting…" (`preparing`), "Deleting 4,500 of 12,345" / "Updating 4,500 of 12,345" / "Restoring …" / "Deleting forever …" (`running`), and `onCancel` → `jobs.cancel`. The selection clears when the job is confirmed; the bar stays up showing progress until the job ends or the member leaves the view (the finish toast still comes, spec 0008 AC-119).

**Finish toasts** (from `JobView.result` and counts): "Deleted 12,345 people" with "Undo" (→ `records.restoreBatch(jobId)`); "Updated 9,998 people. 2 were refused." with "View details" (→ the job on Background jobs); "Restored …"; "Deleted forever …"; "Cancelled after 4,500 of 12,345."

## Keeping open views current during a job

- A `records` event with `coarse: true` and a `jobId` is coalesced per object at `COARSE_JOB_MS` (5 seconds), leading and trailing, instead of spec 0006's 1 second; the trailing refetch waits a further random 0 to 2 seconds, as spec 0006 AC-61 now does, so a hundred tabs never refetch in the same instant.
- The refetch for such an event rereads only the visible blocks of each window on that object (not the 5 blocks of overscan either side) and their counts, plus held `records.one` bodies of that object.
- Coarse events without a `jobId` keep spec 0006's rule.
- The trailing refetch 5 seconds after the last job event brings every view to the job's final state.

## Tests

- Engine on real Postgres: `deleteRecords` and `restoreRecords` round trips (links, entries, keys, unique holds, slots, history untouched); concurrent bulk deletes on overlapping ids (no deadlock, each record once); `updateMany` for every op and type with `before`; `applyOp` unit tests; the snapshot functions against the reference evaluator, `asOf` and `except`; each kind under spec 0008's shared kind contract test (a replayed batch changes nothing).
- Data layer with the fake API: path choice, limits, optimistic delete and edit with partial refusal, the undo entries (create, delete, edit, restore), the confirm flow from `jobs` events, coalescing at 5 seconds.
- Playwright: the flows of AC-524 to AC-532.

## Rationale (short)

The 500 line is where one transaction stays short (spec 0006 AC-50 and the grid's paste use it too); above it, a job gives progress, cancel, fairness and resume for free. Snapshotting before confirming is what lets the member agree to an exact number and guarantees that a record created a second later is never caught. A batch id on every delete makes undo one indexed restore, whether the delete was 1 record or 1,000,000.
