CREATE TABLE "record_files" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"pathname" text NOT NULL,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_files_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "record_files_size" CHECK ("record_files"."size" >= 0 and "record_files"."size" <= 10485760)
);
--> statement-breakpoint
CREATE INDEX "record_files_by_age" ON "record_files" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "record_files_by_record" ON "record_files" USING btree ("workspace_id","record_id","attribute_id");
--> statement-breakpoint
-- Hand written from here: the standard tenant policy. An unset workspace matches nothing, even for the owner.
--
-- A file a record's `file` cell holds (27 Oct 2026). The bytes live in the blob store (private); this row binds the
-- stored file to its workspace, its record and the attribute whose cell holds it, which is what the CRM's download
-- checks. A form upload filed onto a cell is copied here, so the form's own copy keeps its own lifecycle.
-- `record_id` and `attribute_id` carry no foreign key on purpose, as `form_uploads` carries none: erasing a record
-- or deleting an attribute must leave the row so the daily cleanup (maintenance.daily, phase `record_files`) can
-- remove the stored file too; a cascade would strand it. The row goes lazily, once no live value and no history row
-- on that cell names its id.
alter table record_files enable row level security;
--> statement-breakpoint
alter table record_files force row level security;
--> statement-breakpoint
create policy record_files_tenant on record_files
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
