-- The trash (spec 0022, milestone 1): each delete's batch on the record, so undoing a delete restores exactly that
-- batch, and two partial indexes that hold only trashed rows (about 1% of records): one object's trash, and one
-- delete's batch. The workspace's trash newest first reads `records_trashed_at` from 0034, the daily purge's index
-- over the same columns. drizzle-kit's, with this header and the lock timeout hand written.
--
-- Drizzle's migrator runs a migration inside a transaction, where `create index concurrently` can't run, so each
-- index is built in its own plain statement. The new column takes the records table's lock (nullable, no default:
-- a catalog change), and the lock stays until the indexes and the check are built, each one scan of records. Give
-- up after 5 seconds rather than queue behind traffic, like 0020, 0023, 0026, 0029 and 0033. The grants need nothing
-- new: crm_app's update on records covers a new column.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "deleted_batch_id" uuid;--> statement-breakpoint
CREATE INDEX "records_trash_object" ON "records" USING btree ("workspace_id","object_id","deleted_at","id") WHERE "records"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "records_trash_batch" ON "records" USING btree ("workspace_id","deleted_batch_id") WHERE "records"."deleted_batch_id" is not null;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_deleted_batch" CHECK ("records"."deleted_at" is not null or "records"."deleted_batch_id" is null);