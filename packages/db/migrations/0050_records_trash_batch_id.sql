-- Restore jobs (spec 0022, milestone 3): a job's snapshot pages through one delete batch in id order, so the batch
-- index gains `id` and each page reads in order instead of sorting the whole batch (state review, 20 Oct 2026).
-- drizzle-kit's index, with this header, the lock timeout and the order hand written. The index is partial (trashed
-- rows that carry a batch, about 1% of records), built in a plain statement since the migrator runs in a transaction.
-- The new one is built first under another name, which blocks writes to records but never reads while it builds;
-- only the drop and the rename at the end take the lock that blocks reads, for an instant before the commit. Give up
-- after 5 seconds rather than queue behind traffic, like 0036.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE INDEX "records_trash_batch_next" ON "records" USING btree ("workspace_id","deleted_batch_id","id") WHERE "records"."deleted_batch_id" is not null;--> statement-breakpoint
DROP INDEX "records_trash_batch";--> statement-breakpoint
ALTER INDEX "records_trash_batch_next" RENAME TO "records_trash_batch";
