CREATE TABLE "form_uploads" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"pathname" text NOT NULL,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"content_type" text NOT NULL,
	"submission_id" uuid,
	"ip_hash" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_uploads_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "form_uploads_size" CHECK ("form_uploads"."size" >= 0 and "form_uploads"."size" <= 10485760)
);
--> statement-breakpoint
CREATE INDEX "form_uploads_by_form" ON "form_uploads" USING btree ("workspace_id","form_id","created_at");--> statement-breakpoint
CREATE INDEX "form_uploads_by_submission" ON "form_uploads" USING btree ("workspace_id","submission_id");
--> statement-breakpoint
-- Hand written from here: the standard tenant policy. An unset workspace matches nothing, even for the owner.
--
-- Files visitors upload to public forms (#32). The file lives in the blob store (private); this row binds it to
-- its workspace and form, and to its submission once one takes it, which is what the CRM's download checks.
-- `form_id` and `submission_id` carry no foreign key on purpose: deleting a submission or a form must leave the row
-- so the daily cleanup (maintenance.daily, phase `uploads`) can remove the stored file too; a cascade would strand it.
alter table form_uploads enable row level security;
--> statement-breakpoint
alter table form_uploads force row level security;
--> statement-breakpoint
create policy form_uploads_tenant on form_uploads
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
