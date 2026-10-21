-- Import and export (spec 0040): `imports` and their staged rows in `import_rows`, each with the standard
-- tenant policy, and `exports` (spec 0023's table) opened to a second source, `records`: an object's records as
-- a view showed them, with the object and the view. drizzle-kit's tables, keys and indexes, the rest hand written.
CREATE TYPE "public"."import_row_outcome" AS ENUM('pending', 'created', 'updated', 'skipped', 'refused', 'undone');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('staging', 'started', 'undone');--> statement-breakpoint
CREATE TABLE "import_rows" (
	"workspace_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"values" jsonb NOT NULL,
	"match_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"outcome" "import_row_outcome" DEFAULT 'pending' NOT NULL,
	"record_id" uuid,
	"error_code" text,
	"error_message" text,
	"before" jsonb,
	"written" jsonb,
	CONSTRAINT "import_rows_pkey" PRIMARY KEY("workspace_id","import_id","row_number"),
	CONSTRAINT "import_rows_number" CHECK ("import_rows"."row_number" >= 2)
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"row_count" integer NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"settings" jsonb NOT NULL,
	"status" "import_status" DEFAULT 'staging' NOT NULL,
	"job_id" uuid,
	"undo_job_id" uuid,
	"undo_until" timestamp (6) with time zone,
	"created_by_member_id" uuid NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "imports_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "imports_counts" CHECK ("imports"."row_count" >= 0 and "imports"."error_rows" >= 0 and "imports"."error_rows" <= "imports"."row_count"),
	CONSTRAINT "imports_file_name" CHECK (char_length("imports"."file_name") between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "exports" DROP CONSTRAINT "exports_source";--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "object_id" uuid;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "view_id" uuid;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import" FOREIGN KEY ("workspace_id","import_id") REFERENCES "public"."imports"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_object" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_id" ON "import_rows" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "import_rows_outcome" ON "import_rows" USING btree ("workspace_id","import_id","outcome","row_number");--> statement-breakpoint
CREATE INDEX "imports_status" ON "imports" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "imports_by_object" ON "imports" USING btree ("workspace_id","object_id");--> statement-breakpoint
CREATE INDEX "imports_by_member" ON "imports" USING btree ("workspace_id","created_by_member_id");--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_object" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exports_by_object" ON "exports" USING btree ("workspace_id","object_id");--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_records_source" CHECK (("exports"."source" = 'records') = ("exports"."object_id" is not null));--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_source" CHECK ("exports"."source" in ('form_submissions', 'records'));
--> statement-breakpoint
-- Hand written from here.
-- The standard policy on each new table: an unset workspace matches nothing, even for the owner.
alter table imports enable row level security;
--> statement-breakpoint
alter table imports force row level security;
--> statement-breakpoint
create policy imports_tenant on imports
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table import_rows enable row level security;
--> statement-breakpoint
alter table import_rows force row level security;
--> statement-breakpoint
create policy import_rows_tenant on import_rows
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
