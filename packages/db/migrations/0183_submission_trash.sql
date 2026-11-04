-- Deleting a submission is soft (forms fixes 2, 6 November 2026; house rule: deletes are soft, with a restore
-- window): `deleted_at` marks it, every read leaves it out, Undo clears it, and the daily cleanup removes it for good
-- after 30 days (`form_submissions_deleted` is that walk, oldest first). `form_submissions_live` answers a form's
-- counts by state with the deleted left out, from the index alone.
ALTER TABLE "form_submissions" ADD COLUMN "deleted_at" timestamp (6) with time zone;--> statement-breakpoint
CREATE INDEX "form_submissions_deleted" ON "form_submissions" USING btree ("workspace_id","deleted_at","id") WHERE "form_submissions"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "form_submissions_live" ON "form_submissions" USING btree ("workspace_id","form_id","state","received_at") WHERE "form_submissions"."deleted_at" is null;
