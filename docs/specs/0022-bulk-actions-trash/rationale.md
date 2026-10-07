# 0022. Bulk actions and trash: decision record

## Context

The scope's "done when" for #22: a member selects many records, or everything matching a filter, to edit a field or delete; large bulk changes run in the background with progress; deleted records go to a trash and can be restored with their links, notes and history for 30 days, then are removed for good.

Much of the machinery exists. The engine (spec 0004) already deletes softly (`deleted_at`), restores within 30 days with links and entries, refuses a restore whose unique values were taken, and purges in batches in foreign key order. `setValuesBatch` writes up to 500 records in one transaction with a savepoint each (spec 0006 AC-50). The job runner (spec 0008) gives snapshots with an exact count and a confirm, batches with progress, cancel, resume, fairness, and a daily cleanup whose first phase is already the purge. The grid has a selection model with "all matching except" (spec 0003), and the library has a BulkActionBar.

What is undecided: where the line between a request and a job sits; what "all matching" means while records keep changing; how a delete of a million records is undone; what the trash is (a table or a flag) and who may empty it; how open screens follow a long job without each of 100 members refetching every second; and how a daily purge stays compatible with a free database that must sleep.

Forces: the scale budget (100 online, a million records, read 300 ms, edit 250 ms); every write through one engine path with history and an outbox row; hidden means absent (spec 0009); Neon's free plan, where anything on a timer keeps the compute awake (owner decision of 3 October 2026); the brief's numbers (500 inline, 1,000 exceptions, batches of 500, 30 days, admins purge).

## Options considered

### Option 1: inline up to 500 by id, jobs for the rest with a confirmed snapshot; batch ids on deletes; trash as the records table (chosen)

**Pros**: the common case (a few dozen ticked rows) is instant and undoable; big cases get spec 0008's progress, cancel and fairness; the member confirms an exact count; one indexed restore undoes any delete; no copy of trashed data.
**Cons**: two paths to keep consistent (shared engine functions limit this); job edits can't be undone in v1; the snapshot is fixed at count time.

### Option 2: everything as a job, even one record

**Pros**: one path; every change shows on the Background jobs page.
**Cons**: deleting one record waits for the worker (seconds after an idle spell, since the worker sleeps on the free plan); no optimistic feedback; the jobs page fills with noise; the 20 job limit is hit by ordinary use.

### Option 3: "all matching" without a snapshot (the job walks the filter as it goes)

**Pros**: no snapshot phase; starts at once.
**Cons**: the member can't confirm an exact number; records created or changed during the job join or leave it, so a delete can catch records nobody saw; a keyset walk over a filter that the job's own edits change (editing the field the filter uses) can skip or repeat records.

### Option 4: a separate trash table (move rows out on delete)

**Pros**: live tables hold live rows only; the trash is trivially listable.
**Cons**: a delete copies the record, its values and history and its links; a restore copies them back, under the unique and limit checks again; every foreign key from notes, tasks and files must follow the move. Spec 0004 already built soft delete with every read ignoring trashed rows.

## Rationale

Option 1 follows the forces directly. The 500 line is where one transaction stays short and is already the grid's paste limit, so members meet one number. Above it, Option 2's cost (no instant feedback, a sleeping worker in the path) is acceptable because the change is big and the member is shown progress; below it, it is not. Option 3 fails the brief's confirm with an exact count and makes "all matching" mean different things at the start and the end of a job; the snapshot (spec 0008 AC-109) fixes the set before the member agrees to it. Option 4 throws away spec 0004's soft delete and doubles the work of every delete and restore.

The batch id on every delete is the small addition that makes undo uniform: the same `restoreBatch` serves a single row's toast, a 48 record delete and a million record job, through one partial index. Edit jobs don't get undo in v1 because it would mean storing a before value for every changed cell (doubling the job's writes) for a case the confirm already guards; inline edits keep spec 0006's undo because their before values come back in the response at no cost.

Following a job at 5 second intervals instead of 1 is a deliberate trade: a 1,000,000 record job lasts many minutes, and 100 members each rereading their windows every second would multiply the steady read load the budget assumes. Five seconds keeps views visibly moving and the load near steady state.

The purge adds nothing that runs on a clock. Spec 0008 already wakes the worker once a day for its cleanup; making the purge its phase, with a one row probe when there is nothing to do, keeps the free plan's daily cost to that single wake.

Calls and their runners up:
- **No confirm for a single delete** (runner up: always confirm). The toast's Undo and the trash make a mistake one click to fix; a confirm on every single delete trains people to click through confirms.
- **Delete forever and empty trash for owners and admins** (brief; runner up: anyone may purge their own deletes). Irreversible actions stay with the people accountable for the workspace's data.
- **Relationship attributes out of bulk edit in v1** (runner up: Set and Clear on single sides now). Many sides need spec 0014's link deltas and have no versions to undo by; doing them right is a follow up, not a corner cut here.
- **Dependents deleted explicitly through one registry, with restricting foreign keys** (runner up: `on delete cascade` from each feature's table). A cascade deletes silently and can't be counted from the statement; the registry keeps one place that names every dependent, counts it, and lets a forgotten one fail loudly, the engine's convention for sort keys too.
- **Job written events carry `fromJob: true`, not the job id** (runner up: the job id on every `records` event). The client only needs to know a job wrote it to slow its refetch; the id would reach channels whose members may not read the job, against spec 0009's `jobs` rule. The id stays in `outbox.job_id` for the audit log.
- **Rows just off screen are marked stale during a job** (runner up: reread every loaded block, spec 0006's rule). Rereading 11 blocks per tab every 5 seconds for minutes is most of a job's read load; rereading a block only when it comes into view keeps what the member sees current at a fraction of it.
- **A selection clears when someone else saves the view's filter** (runner up: keep the ticks while the rows still show). Ticks over a query that changed underneath are easy to act on by mistake; clearing and saying so is the safer default.
- **Synthetic columns in the read only DataGrid for the trash** (runner up: the small `Table` molecule). The trash can hold a million rows (1% of a workspace is already 10,000 on the seed), so it needs the windowed grid, and synthetic field attributes keep every value in its one field design.

## References

**Project sources**:
- Spec 0004 (soft delete, restore, `RESTORE_WINDOW`, purge order), `packages/core/src/engine/deletion.ts`, `packages/db/src/schema/records.ts` (`records_trashed`).
- Spec 0006 (`setValuesBatch`, the undo stack and its Follow-up, coarse coalescing, windows).
- Spec 0007 (coarse events, the capped `Change`, AC-83).
- Spec 0008 (the runner, snapshot and confirm, `maintenance.daily`, worker sleep, the 20 job limit).
- Spec 0009 (`records.purge`, `enterAsActor`, refusal wording).
- Spec 0003's BulkActionBar and DataGrid (`grid-selection.ts`).
- `.claude/skills/crm-api-backend` ("anything slow runs as a background job"), `crm-data-model-access` ("deletes are soft, with a restore window").

**Practices and standards**:
- Soft delete with a restore window and explicit, counted hard deletes.
- Snapshot then confirm for destructive bulk operations.
- Coalescing change notifications under load.
- Scale to zero: no periodic work while idle.
