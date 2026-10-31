-- Record merge (spec 0049, AC-4914): `merged_into_record_id` names the record a merged one went into. A merge sets it
-- together with `deleted_at`, never to the record itself (`records_merged`), so a merged record is a trashed one that
-- no list, search or trash restore shows, and the normal 30 day purge removes it. Its address redirects to the end of
-- the chain. Removing the kept record for good clears the column only (`set null` names just it, so the row keeps its
-- workspace id). `records_trash_listed` keeps the trash's count an index only scan with merged records left out. The
-- partial index `records_merged_into` holds the few merged rows: a timeline's merge entries and a redirect's chain read it.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "merged_into_record_id" uuid;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_merged_into" FOREIGN KEY ("workspace_id","merged_into_record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE SET NULL ("merged_into_record_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_merged" CHECK ("records"."merged_into_record_id" is null or ("records"."deleted_at" is not null and "records"."merged_into_record_id" <> "records"."id"));--> statement-breakpoint
CREATE INDEX "records_merged_into" ON "records" USING btree ("workspace_id","merged_into_record_id") WHERE "records"."merged_into_record_id" is not null;--> statement-breakpoint
CREATE INDEX "records_trash_listed" ON "records" USING btree ("workspace_id","id") WHERE "records"."deleted_at" is not null and "records"."merged_into_record_id" is null;
