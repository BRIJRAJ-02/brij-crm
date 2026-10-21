-- Export files (spec 0023's submissions export, in spec 0037's shape): `exports` and their CSV text in
-- `export_chunks`, with the standard tenant policy on each, and a keyset index on a form's submissions by id for
-- Sync old records' snapshot; drizzle-kit's tables, keys and indexes, the rest hand written.
CREATE TABLE "export_chunks" (
	"workspace_id" uuid NOT NULL,
	"export_id" uuid NOT NULL,
	"part" integer NOT NULL,
	"body" text NOT NULL,
	CONSTRAINT "export_chunks_pkey" PRIMARY KEY("workspace_id","export_id","part"),
	CONSTRAINT "export_chunks_part" CHECK ("export_chunks"."part" >= 0)
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"source" text NOT NULL,
	"form_id" uuid,
	"selection" jsonb NOT NULL,
	"file_name" text NOT NULL,
	"job_id" uuid NOT NULL,
	"row_count" integer,
	"byte_count" integer,
	"created_by_member_id" uuid NOT NULL,
	"policy_key" text NOT NULL,
	"expires_at" timestamp (6) with time zone NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exports_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "exports_source" CHECK ("exports"."source" in ('form_submissions')),
	CONSTRAINT "exports_form_source" CHECK (("exports"."source" = 'form_submissions') = ("exports"."form_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "export_chunks" ADD CONSTRAINT "export_chunks_export" FOREIGN KEY ("workspace_id","export_id") REFERENCES "public"."exports"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_form" FOREIGN KEY ("workspace_id","form_id") REFERENCES "public"."forms"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_member" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exports_by_expiry" ON "exports" USING btree ("workspace_id","expires_at");--> statement-breakpoint
CREATE INDEX "exports_by_member" ON "exports" USING btree ("workspace_id","created_by_member_id","expires_at");--> statement-breakpoint
CREATE INDEX "exports_by_form" ON "exports" USING btree ("workspace_id","form_id");--> statement-breakpoint
CREATE INDEX "form_submissions_by_form_id" ON "form_submissions" USING btree ("workspace_id","form_id","id");
--> statement-breakpoint
-- Hand written from here.
-- The standard policy on each new table: an unset workspace matches nothing, even for the owner.
alter table exports enable row level security;
--> statement-breakpoint
alter table exports force row level security;
--> statement-breakpoint
create policy exports_tenant on exports
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table export_chunks enable row level security;
--> statement-breakpoint
alter table export_chunks force row level security;
--> statement-breakpoint
create policy export_chunks_tenant on export_chunks
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
