-- Record files (#32, the crm-files lane, 31 Oct 2026): a record's Files tab. A `record_files` row with no
-- `attribute_id` is an attachment on the record itself rather than a `file` cell's file, so cells and the Files tab
-- share one table, one download route, one per record cap and one cleanup. `created_by` names the member who added
-- it (null for the cell files made before this, and for a form's filed copy); `deleted_at` is a Files tab delete,
-- kept 30 days for Undo and then removed with its bytes by the daily cleanup's `record_files` phase. `outbox_kind`
-- gains `files`, one row per object whose records' attachments a write changed, with the record ids, so another
-- tab's Files tab follows. Enum values are only ever added, and nothing in this migration uses it, so it runs inside
-- its transaction.
ALTER TABLE "record_files" ALTER COLUMN "attribute_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "record_files" ADD COLUMN "created_by" uuid;
--> statement-breakpoint
ALTER TABLE "record_files" ADD COLUMN "deleted_at" timestamp (6) with time zone;
--> statement-breakpoint
-- The Files tab's list: a record's attachments, newest first.
CREATE INDEX "record_files_attachments" ON "record_files" USING btree ("workspace_id","record_id","created_at")
  WHERE "attribute_id" IS NULL;
--> statement-breakpoint
ALTER TYPE "public"."outbox_kind" ADD VALUE 'files';
