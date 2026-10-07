# 0014. Stored keys for sorting by a relation

## Summary

Sorting People by Company today looks up each person's company name while the query runs, which is fine for a few thousand people and too slow for 600,000. This child spec stores the company name as a sort key on each person, in the same narrow `sort_keys` table every other sortable value already uses, so the sort and the scrollbar jump become index reads. The hard part is keeping the key exact when the company is renamed, deleted or restored, or when links change from either side at the same time; one lock rule makes that safe, and a background job handles companies with more than 10,000 people.

## Scope

- Covered: every side that holds one record (`isMulti` false on a record reference attribute: Person · Company, Company · Parent company, Deal · Associated company, and any one to one or many to one side an admin creates).
- Not covered: sides that hold many. Their sort stays the engine's lateral join on the first linked record (best effort, spec 0004).

## The key

- One `sort_keys` row per (record, one side attribute) while the record has a current link on that side to a live record: `owner_id` and `record_id` = the record, `attribute_id` = the side, `text_key` = the linked record's primary attribute key, the same expression every text key uses (`lower(left(text, 256))` collated `und-x-icu`). `live` follows the owning record, as for every key.
- No row when the side is empty, when the linked record is in the trash, or when its name is empty. Empties sort last, as everywhere.
- `sort_key_sources` (the view that defines every key) gains this kind, so the save, the backfill and the tests compute it with one expression. `hasSortKey` admits a record reference attribute that holds one.
- `canJump` (spec 0006) admits one sort on such a side, so the view scrolls in position mode.

## Who writes it

| Event | Dependents | Writer |
|---|---|---|
| a link on a one side starts or ends, from either side (delta or whole value) | the record on the one side | the link write, in its transaction |
| a move | the moved record | the link write |
| the linked record's primary attribute changes | every record whose one side links to it | the rename, in its transaction, when 10,000 or fewer; otherwise a job |
| the linked record is deleted or restored | the same | the delete or restore, likewise |
| the purge or erasure of the linked record | the same (their keys were already removed at delete) | nothing more |
| the owning record is deleted, restored, purged or erased | its own keys | the existing `setRecordKeysLive` and `deleteSortKeys` |

Dependents are counted across every relationship whose one side points at that record, with `limit 10,001`.

## The lock rule

Every key derived from record B is computed after, and written while, holding a lock on B's row:
- B's own writes (a rename, a delete, a restore) already hold `FOR UPDATE` on B.
- A link write that starts or ends a link to B on a one side, written from the other side of B (the person's side), takes `FOR KEY SHARE` on B after its own record lock, far records in id order, before it computes the key.
- A link write from B's side already holds B.
- Each job batch takes `FOR UPDATE` on B, then recomputes its 500 dependents from the current links and name, in one statement after the lock.

Why it holds: every writer of a key derived from B is ordered by B's row, so whichever commits last computed its key after the earlier one committed (read committed takes a fresh snapshot per statement). Key share locks don't conflict with each other, so many people linking to one hub never wait on each other, only on B's own writes and on refresh batches (milliseconds each). No cycle exists: a link write locks its own record, then far records in id order, and no writer locks a far record first and then a near one. `runWrite` still retries a deadlock up to 3 times.

This reverses spec 0004 AC-7 ("two links from opposite ends never lock each other") for sides that hold one, once this key lands: a link written from the person's side now waits on the company's own writes and refresh batches. The index spec's Follow-up asks `/sync` to record it in 0004, and spec 0011's `hub` scenario measures the cost (the hub edited while 100 users link to it).

## The refresh job

- Kind `records.refresh_sort_keys` on #8's runner (spec 0008), input `{ targetRecordId }`, coalesced per target: a second rename while one is queued or running restarts it from the start, since each batch recomputes from the truth.
- Walks the target's current links on every one side that points at it, keyset by (relationship, position, id) through `record_links_to` and `record_links_from`, in batches of 500, each its own transaction under the lock rule.
- Until it finishes, a sort by that relation shows the old order for the affected records; values in cells are right at once (they read the links, not the key).
- Target: the 150,000 person hub within 60 seconds on the local scale seed.
- Until #8 exists, task 17 waits and a sort by a one side uses the lateral join, so no rename ever leaves a stale key.

## Migration

- Replace `sort_key_sources` with the new kind.
- Backfill keys for every existing one side, set based (production data is small; the scale seed runs the same statement).
- No new index: `sort_keys_text` (`workspace_id`, `attribute_id`, `text_key`, `owner_id`, where live) serves it.

## Tests

- The randomized test from spec 0004 (AC-20) extended: link writes from both sides, moves, renames, deletes, restores, purges, and concurrent pairs of them, ending with `sort_keys` equal to what `sort_key_sources` says, verifies **AC-303**.
- A rename of a target with 10,001 dependents queues one job and leaves the old keys; the job ends with every key right, verifies **AC-303**.
- The jump to row 600,000 sorted by Company and the first page, on the scale seed, against the reference evaluator, verifies **AC-302**.

## Rationale (short)

The query budget can't be met by a join that runs per row under row level security (spec 0004's stored keys child found the same for text). Storing the key reuses that table, its indexes and its jump. The runner up was a key on the target only (sort by joining to the company's own name key): it needs no refresh at all, but a sort through a join can't jump to a position or seek a cursor by one index, which is the whole point. Locking the target for every dependent write was chosen over a periodic reconcile because a sort that is silently wrong is worse than a short wait.
