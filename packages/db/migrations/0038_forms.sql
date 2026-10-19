-- Forms (spec 0023, milestone 1): forms, their numbered versions, the submissions visitors send and the records each
-- submission touched, with the standard tenant policy on each; drizzle-kit's tables, keys and indexes, the rest hand
-- written.
--
-- The actor type gains `form`: a submission's records and values name the form that wrote them (AC-564). Postgres
-- refuses a new enum value used in the transaction that added it, and the migrator runs every pending migration in
-- one transaction, so the actor rule on every table now names only the two types it excludes (`not in ('member',
-- 'system')`) rather than listing the others: nothing here uses 'form'. The new rule is implied by the old one, so
-- every existing row already meets it; each existing table's rule is replaced `not valid`, enforced on every new row
-- at once without scanning a table under its lock (records and values grow to millions of rows). A later migration
-- may validate them outside a deploy.
--
-- The public endpoints find a form by its public key before they know the workspace: crm_form_by_key(key), owned by
-- crm_form_lookup (no login, bypasses row level security only to read forms' public key, workspace and id), answers
-- the workspace and form ids and nothing else, for crm_app only.
--
-- The rules' swap and the foreign keys briefly lock the tables they touch. Give up after 5 seconds rather than queue
-- behind traffic, like 0020, 0023, 0026, 0029, 0033 and 0037.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TYPE "public"."actor_type" ADD VALUE 'form';--> statement-breakpoint
CREATE TABLE "form_submission_records" (
	"workspace_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"action" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_submission_records_pkey" PRIMARY KEY("workspace_id","submission_id","record_id","role"),
	CONSTRAINT "form_submission_records_action" CHECK ("form_submission_records"."action" in ('created', 'updated', 'matched', 'linked')),
	CONSTRAINT "form_submission_records_role" CHECK ("form_submission_records"."role" in ('main', 'person', 'company', 'deal', 'entry'))
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"form_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"state" text DEFAULT 'received' NOT NULL,
	"answers" jsonb NOT NULL,
	"hidden" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"spam" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"main_record_id" uuid,
	"assignment" jsonb,
	"outcome" jsonb,
	"failure" text,
	"ip_hash" text,
	"received_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp (6) with time zone,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_submissions_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "form_submissions_state" CHECK ("form_submissions"."state" in ('received', 'processing', 'processed', 'spam', 'held', 'needs_review', 'failed')),
	CONSTRAINT "form_submissions_processed" CHECK (("form_submissions"."state" = 'processed') = ("form_submissions"."processed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "form_versions" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"form_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"document" jsonb NOT NULL,
	"published_at" timestamp (6) with time zone,
	"published_by_type" "actor_type",
	"published_by_id" uuid,
	"published_by_member_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "form_versions_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "form_versions_number_positive" CHECK ("form_versions"."number" >= 1),
	CONSTRAINT "form_versions_published" CHECK (("form_versions"."published_at" is null) = ("form_versions"."published_by_type" is null)),
	CONSTRAINT "form_versions_published_by_actor" CHECK (("form_versions"."published_by_type" is null and "form_versions"."published_by_id" is null and "form_versions"."published_by_member_id" is null)
      or ("form_versions"."published_by_type" = 'system' and "form_versions"."published_by_id" is null and "form_versions"."published_by_member_id" is null)
      or ("form_versions"."published_by_type" = 'member' and "form_versions"."published_by_id" is not null and "form_versions"."published_by_member_id" = "form_versions"."published_by_id")
      or ("form_versions"."published_by_type" not in ('member', 'system') and "form_versions"."published_by_id" is not null and "form_versions"."published_by_member_id" is null)),
	CONSTRAINT "form_versions_created_by_actor" CHECK (("form_versions"."created_by_type" is null and "form_versions"."created_by_id" is null and "form_versions"."created_by_member_id" is null)
      or ("form_versions"."created_by_type" = 'system' and "form_versions"."created_by_id" is null and "form_versions"."created_by_member_id" is null)
      or ("form_versions"."created_by_type" = 'member' and "form_versions"."created_by_id" is not null and "form_versions"."created_by_member_id" = "form_versions"."created_by_id")
      or ("form_versions"."created_by_type" not in ('member', 'system') and "form_versions"."created_by_id" is not null and "form_versions"."created_by_member_id" is null)),
	CONSTRAINT "form_versions_updated_by_actor" CHECK (("form_versions"."updated_by_type" is null and "form_versions"."updated_by_id" is null and "form_versions"."updated_by_member_id" is null)
      or ("form_versions"."updated_by_type" = 'system' and "form_versions"."updated_by_id" is null and "form_versions"."updated_by_member_id" is null)
      or ("form_versions"."updated_by_type" = 'member' and "form_versions"."updated_by_id" is not null and "form_versions"."updated_by_member_id" = "form_versions"."updated_by_id")
      or ("form_versions"."updated_by_type" not in ('member', 'system') and "form_versions"."updated_by_id" is not null and "form_versions"."updated_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"kind" text DEFAULT 'built' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"name" text NOT NULL,
	"main_object_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"owner_member_id" uuid,
	"allowed_origins" text[] DEFAULT '{}'::text[] NOT NULL,
	"require_signature" boolean DEFAULT false NOT NULL,
	"signing_secret" text NOT NULL,
	"draft_version_id" uuid,
	"live_version_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"drift" jsonb,
	"archived_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "forms_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "forms_kind" CHECK ("forms"."kind" in ('built', 'capture')),
	CONSTRAINT "forms_status" CHECK ("forms"."status" in ('draft', 'live', 'paused', 'archived')),
	CONSTRAINT "forms_name" CHECK (char_length("forms"."name") between 1 and 200),
	CONSTRAINT "forms_public_key_shape" CHECK ("forms"."public_key" ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$'),
	CONSTRAINT "forms_live_version" CHECK (("forms"."status" = 'draft') = ("forms"."live_version_id" is null) or "forms"."status" = 'archived'),
	CONSTRAINT "forms_archived" CHECK (("forms"."status" = 'archived') = ("forms"."archived_at" is not null)),
	CONSTRAINT "forms_created_by_actor" CHECK (("forms"."created_by_type" is null and "forms"."created_by_id" is null and "forms"."created_by_member_id" is null)
      or ("forms"."created_by_type" = 'system' and "forms"."created_by_id" is null and "forms"."created_by_member_id" is null)
      or ("forms"."created_by_type" = 'member' and "forms"."created_by_id" is not null and "forms"."created_by_member_id" = "forms"."created_by_id")
      or ("forms"."created_by_type" not in ('member', 'system') and "forms"."created_by_id" is not null and "forms"."created_by_member_id" is null)),
	CONSTRAINT "forms_updated_by_actor" CHECK (("forms"."updated_by_type" is null and "forms"."updated_by_id" is null and "forms"."updated_by_member_id" is null)
      or ("forms"."updated_by_type" = 'system' and "forms"."updated_by_id" is null and "forms"."updated_by_member_id" is null)
      or ("forms"."updated_by_type" = 'member' and "forms"."updated_by_id" is not null and "forms"."updated_by_member_id" = "forms"."updated_by_id")
      or ("forms"."updated_by_type" not in ('member', 'system') and "forms"."updated_by_id" is not null and "forms"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "attribute_options" DROP CONSTRAINT "attribute_options_created_by_actor";--> statement-breakpoint
ALTER TABLE "attribute_options" DROP CONSTRAINT "attribute_options_updated_by_actor";--> statement-breakpoint
ALTER TABLE "attributes" DROP CONSTRAINT "attributes_created_by_actor";--> statement-breakpoint
ALTER TABLE "attributes" DROP CONSTRAINT "attributes_updated_by_actor";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_created_by_actor";--> statement-breakpoint
ALTER TABLE "list_entries" DROP CONSTRAINT "list_entries_created_by_actor";--> statement-breakpoint
ALTER TABLE "list_entries" DROP CONSTRAINT "list_entries_updated_by_actor";--> statement-breakpoint
ALTER TABLE "list_entries" DROP CONSTRAINT "list_entries_deleted_by_actor";--> statement-breakpoint
ALTER TABLE "lists" DROP CONSTRAINT "lists_created_by_actor";--> statement-breakpoint
ALTER TABLE "lists" DROP CONSTRAINT "lists_updated_by_actor";--> statement-breakpoint
ALTER TABLE "members" DROP CONSTRAINT "members_created_by_actor";--> statement-breakpoint
ALTER TABLE "members" DROP CONSTRAINT "members_updated_by_actor";--> statement-breakpoint
ALTER TABLE "objects" DROP CONSTRAINT "objects_created_by_actor";--> statement-breakpoint
ALTER TABLE "objects" DROP CONSTRAINT "objects_updated_by_actor";--> statement-breakpoint
ALTER TABLE "record_links" DROP CONSTRAINT "record_links_set_by_actor";--> statement-breakpoint
ALTER TABLE "record_links" DROP CONSTRAINT "record_links_ended_by_actor";--> statement-breakpoint
ALTER TABLE "records" DROP CONSTRAINT "records_created_by_actor";--> statement-breakpoint
ALTER TABLE "records" DROP CONSTRAINT "records_updated_by_actor";--> statement-breakpoint
ALTER TABLE "records" DROP CONSTRAINT "records_deleted_by_actor";--> statement-breakpoint
ALTER TABLE "relationships" DROP CONSTRAINT "relationships_created_by_actor";--> statement-breakpoint
ALTER TABLE "relationships" DROP CONSTRAINT "relationships_updated_by_actor";--> statement-breakpoint
ALTER TABLE "task_records" DROP CONSTRAINT "task_records_created_by_actor";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_created_by_actor";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_updated_by_actor";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_done_by_actor";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_deleted_by_actor";--> statement-breakpoint
ALTER TABLE "validation_rules" DROP CONSTRAINT "validation_rules_created_by_actor";--> statement-breakpoint
ALTER TABLE "validation_rules" DROP CONSTRAINT "validation_rules_updated_by_actor";--> statement-breakpoint
ALTER TABLE "values" DROP CONSTRAINT "values_set_by_actor";--> statement-breakpoint
ALTER TABLE "values" DROP CONSTRAINT "values_actor_actor";--> statement-breakpoint
ALTER TABLE "views" DROP CONSTRAINT "views_created_by_actor";--> statement-breakpoint
ALTER TABLE "views" DROP CONSTRAINT "views_updated_by_actor";--> statement-breakpoint
ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_created_by_actor";--> statement-breakpoint
ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_updated_by_actor";--> statement-breakpoint
ALTER TABLE "form_submission_records" ADD CONSTRAINT "form_submission_records_submission" FOREIGN KEY ("workspace_id","submission_id") REFERENCES "public"."form_submissions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission_records" ADD CONSTRAINT "form_submission_records_record" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form" FOREIGN KEY ("workspace_id","form_id") REFERENCES "public"."forms"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_version" FOREIGN KEY ("workspace_id","version_id") REFERENCES "public"."form_versions"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_form" FOREIGN KEY ("workspace_id","form_id") REFERENCES "public"."forms"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_published_by" FOREIGN KEY ("workspace_id","published_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_owner" FOREIGN KEY ("workspace_id","owner_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_main_object" FOREIGN KEY ("workspace_id","main_object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_submission_records_by_record" ON "form_submission_records" USING btree ("workspace_id","record_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "form_submissions_attempt" ON "form_submissions" USING btree ("workspace_id","form_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "form_submissions_by_form" ON "form_submissions" USING btree ("workspace_id","form_id","received_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "form_submissions_open" ON "form_submissions" USING btree ("workspace_id","state") WHERE "form_submissions"."state" <> 'processed';--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_number" ON "form_versions" USING btree ("workspace_id","form_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_one_draft" ON "form_versions" USING btree ("workspace_id","form_id") WHERE "form_versions"."published_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "forms_public_key" ON "forms" USING btree ("public_key");--> statement-breakpoint
CREATE INDEX "forms_by_workspace" ON "forms" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
ALTER TABLE "attribute_options" ADD CONSTRAINT "attribute_options_created_by_actor" CHECK (("attribute_options"."created_by_type" is null and "attribute_options"."created_by_id" is null and "attribute_options"."created_by_member_id" is null)
      or ("attribute_options"."created_by_type" = 'system' and "attribute_options"."created_by_id" is null and "attribute_options"."created_by_member_id" is null)
      or ("attribute_options"."created_by_type" = 'member' and "attribute_options"."created_by_id" is not null and "attribute_options"."created_by_member_id" = "attribute_options"."created_by_id")
      or ("attribute_options"."created_by_type" not in ('member', 'system') and "attribute_options"."created_by_id" is not null and "attribute_options"."created_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "attribute_options" ADD CONSTRAINT "attribute_options_updated_by_actor" CHECK (("attribute_options"."updated_by_type" is null and "attribute_options"."updated_by_id" is null and "attribute_options"."updated_by_member_id" is null)
      or ("attribute_options"."updated_by_type" = 'system' and "attribute_options"."updated_by_id" is null and "attribute_options"."updated_by_member_id" is null)
      or ("attribute_options"."updated_by_type" = 'member' and "attribute_options"."updated_by_id" is not null and "attribute_options"."updated_by_member_id" = "attribute_options"."updated_by_id")
      or ("attribute_options"."updated_by_type" not in ('member', 'system') and "attribute_options"."updated_by_id" is not null and "attribute_options"."updated_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_created_by_actor" CHECK (("attributes"."created_by_type" is null and "attributes"."created_by_id" is null and "attributes"."created_by_member_id" is null)
      or ("attributes"."created_by_type" = 'system' and "attributes"."created_by_id" is null and "attributes"."created_by_member_id" is null)
      or ("attributes"."created_by_type" = 'member' and "attributes"."created_by_id" is not null and "attributes"."created_by_member_id" = "attributes"."created_by_id")
      or ("attributes"."created_by_type" not in ('member', 'system') and "attributes"."created_by_id" is not null and "attributes"."created_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_updated_by_actor" CHECK (("attributes"."updated_by_type" is null and "attributes"."updated_by_id" is null and "attributes"."updated_by_member_id" is null)
      or ("attributes"."updated_by_type" = 'system' and "attributes"."updated_by_id" is null and "attributes"."updated_by_member_id" is null)
      or ("attributes"."updated_by_type" = 'member' and "attributes"."updated_by_id" is not null and "attributes"."updated_by_member_id" = "attributes"."updated_by_id")
      or ("attributes"."updated_by_type" not in ('member', 'system') and "attributes"."updated_by_id" is not null and "attributes"."updated_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_actor" CHECK (("jobs"."created_by_type" is null and "jobs"."created_by_id" is null and "jobs"."created_by_member_id" is null)
      or ("jobs"."created_by_type" = 'system' and "jobs"."created_by_id" is null and "jobs"."created_by_member_id" is null)
      or ("jobs"."created_by_type" = 'member' and "jobs"."created_by_id" is not null and "jobs"."created_by_member_id" = "jobs"."created_by_id")
      or ("jobs"."created_by_type" not in ('member', 'system') and "jobs"."created_by_id" is not null and "jobs"."created_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "list_entries" ADD CONSTRAINT "list_entries_created_by_actor" CHECK (("list_entries"."created_by_type" is null and "list_entries"."created_by_id" is null and "list_entries"."created_by_member_id" is null)
      or ("list_entries"."created_by_type" = 'system' and "list_entries"."created_by_id" is null and "list_entries"."created_by_member_id" is null)
      or ("list_entries"."created_by_type" = 'member' and "list_entries"."created_by_id" is not null and "list_entries"."created_by_member_id" = "list_entries"."created_by_id")
      or ("list_entries"."created_by_type" not in ('member', 'system') and "list_entries"."created_by_id" is not null and "list_entries"."created_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "list_entries" ADD CONSTRAINT "list_entries_updated_by_actor" CHECK (("list_entries"."updated_by_type" is null and "list_entries"."updated_by_id" is null and "list_entries"."updated_by_member_id" is null)
      or ("list_entries"."updated_by_type" = 'system' and "list_entries"."updated_by_id" is null and "list_entries"."updated_by_member_id" is null)
      or ("list_entries"."updated_by_type" = 'member' and "list_entries"."updated_by_id" is not null and "list_entries"."updated_by_member_id" = "list_entries"."updated_by_id")
      or ("list_entries"."updated_by_type" not in ('member', 'system') and "list_entries"."updated_by_id" is not null and "list_entries"."updated_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "list_entries" ADD CONSTRAINT "list_entries_deleted_by_actor" CHECK (("list_entries"."deleted_by_type" is null and "list_entries"."deleted_by_id" is null and "list_entries"."deleted_by_member_id" is null)
      or ("list_entries"."deleted_by_type" = 'system' and "list_entries"."deleted_by_id" is null and "list_entries"."deleted_by_member_id" is null)
      or ("list_entries"."deleted_by_type" = 'member' and "list_entries"."deleted_by_id" is not null and "list_entries"."deleted_by_member_id" = "list_entries"."deleted_by_id")
      or ("list_entries"."deleted_by_type" not in ('member', 'system') and "list_entries"."deleted_by_id" is not null and "list_entries"."deleted_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_created_by_actor" CHECK (("lists"."created_by_type" is null and "lists"."created_by_id" is null and "lists"."created_by_member_id" is null)
      or ("lists"."created_by_type" = 'system' and "lists"."created_by_id" is null and "lists"."created_by_member_id" is null)
      or ("lists"."created_by_type" = 'member' and "lists"."created_by_id" is not null and "lists"."created_by_member_id" = "lists"."created_by_id")
      or ("lists"."created_by_type" not in ('member', 'system') and "lists"."created_by_id" is not null and "lists"."created_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_updated_by_actor" CHECK (("lists"."updated_by_type" is null and "lists"."updated_by_id" is null and "lists"."updated_by_member_id" is null)
      or ("lists"."updated_by_type" = 'system' and "lists"."updated_by_id" is null and "lists"."updated_by_member_id" is null)
      or ("lists"."updated_by_type" = 'member' and "lists"."updated_by_id" is not null and "lists"."updated_by_member_id" = "lists"."updated_by_id")
      or ("lists"."updated_by_type" not in ('member', 'system') and "lists"."updated_by_id" is not null and "lists"."updated_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_created_by_actor" CHECK (("members"."created_by_type" is null and "members"."created_by_id" is null and "members"."created_by_member_id" is null)
      or ("members"."created_by_type" = 'system' and "members"."created_by_id" is null and "members"."created_by_member_id" is null)
      or ("members"."created_by_type" = 'member' and "members"."created_by_id" is not null and "members"."created_by_member_id" = "members"."created_by_id")
      or ("members"."created_by_type" not in ('member', 'system') and "members"."created_by_id" is not null and "members"."created_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_updated_by_actor" CHECK (("members"."updated_by_type" is null and "members"."updated_by_id" is null and "members"."updated_by_member_id" is null)
      or ("members"."updated_by_type" = 'system' and "members"."updated_by_id" is null and "members"."updated_by_member_id" is null)
      or ("members"."updated_by_type" = 'member' and "members"."updated_by_id" is not null and "members"."updated_by_member_id" = "members"."updated_by_id")
      or ("members"."updated_by_type" not in ('member', 'system') and "members"."updated_by_id" is not null and "members"."updated_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_created_by_actor" CHECK (("objects"."created_by_type" is null and "objects"."created_by_id" is null and "objects"."created_by_member_id" is null)
      or ("objects"."created_by_type" = 'system' and "objects"."created_by_id" is null and "objects"."created_by_member_id" is null)
      or ("objects"."created_by_type" = 'member' and "objects"."created_by_id" is not null and "objects"."created_by_member_id" = "objects"."created_by_id")
      or ("objects"."created_by_type" not in ('member', 'system') and "objects"."created_by_id" is not null and "objects"."created_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_updated_by_actor" CHECK (("objects"."updated_by_type" is null and "objects"."updated_by_id" is null and "objects"."updated_by_member_id" is null)
      or ("objects"."updated_by_type" = 'system' and "objects"."updated_by_id" is null and "objects"."updated_by_member_id" is null)
      or ("objects"."updated_by_type" = 'member' and "objects"."updated_by_id" is not null and "objects"."updated_by_member_id" = "objects"."updated_by_id")
      or ("objects"."updated_by_type" not in ('member', 'system') and "objects"."updated_by_id" is not null and "objects"."updated_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_set_by_actor" CHECK (("record_links"."set_by_type" is null and "record_links"."set_by_id" is null and "record_links"."set_by_member_id" is null)
      or ("record_links"."set_by_type" = 'system' and "record_links"."set_by_id" is null and "record_links"."set_by_member_id" is null)
      or ("record_links"."set_by_type" = 'member' and "record_links"."set_by_id" is not null and "record_links"."set_by_member_id" = "record_links"."set_by_id")
      or ("record_links"."set_by_type" not in ('member', 'system') and "record_links"."set_by_id" is not null and "record_links"."set_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_ended_by_actor" CHECK (("record_links"."ended_by_type" is null and "record_links"."ended_by_id" is null and "record_links"."ended_by_member_id" is null)
      or ("record_links"."ended_by_type" = 'system' and "record_links"."ended_by_id" is null and "record_links"."ended_by_member_id" is null)
      or ("record_links"."ended_by_type" = 'member' and "record_links"."ended_by_id" is not null and "record_links"."ended_by_member_id" = "record_links"."ended_by_id")
      or ("record_links"."ended_by_type" not in ('member', 'system') and "record_links"."ended_by_id" is not null and "record_links"."ended_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_created_by_actor" CHECK (("records"."created_by_type" is null and "records"."created_by_id" is null and "records"."created_by_member_id" is null)
      or ("records"."created_by_type" = 'system' and "records"."created_by_id" is null and "records"."created_by_member_id" is null)
      or ("records"."created_by_type" = 'member' and "records"."created_by_id" is not null and "records"."created_by_member_id" = "records"."created_by_id")
      or ("records"."created_by_type" not in ('member', 'system') and "records"."created_by_id" is not null and "records"."created_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_updated_by_actor" CHECK (("records"."updated_by_type" is null and "records"."updated_by_id" is null and "records"."updated_by_member_id" is null)
      or ("records"."updated_by_type" = 'system' and "records"."updated_by_id" is null and "records"."updated_by_member_id" is null)
      or ("records"."updated_by_type" = 'member' and "records"."updated_by_id" is not null and "records"."updated_by_member_id" = "records"."updated_by_id")
      or ("records"."updated_by_type" not in ('member', 'system') and "records"."updated_by_id" is not null and "records"."updated_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_deleted_by_actor" CHECK (("records"."deleted_by_type" is null and "records"."deleted_by_id" is null and "records"."deleted_by_member_id" is null)
      or ("records"."deleted_by_type" = 'system' and "records"."deleted_by_id" is null and "records"."deleted_by_member_id" is null)
      or ("records"."deleted_by_type" = 'member' and "records"."deleted_by_id" is not null and "records"."deleted_by_member_id" = "records"."deleted_by_id")
      or ("records"."deleted_by_type" not in ('member', 'system') and "records"."deleted_by_id" is not null and "records"."deleted_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_created_by_actor" CHECK (("relationships"."created_by_type" is null and "relationships"."created_by_id" is null and "relationships"."created_by_member_id" is null)
      or ("relationships"."created_by_type" = 'system' and "relationships"."created_by_id" is null and "relationships"."created_by_member_id" is null)
      or ("relationships"."created_by_type" = 'member' and "relationships"."created_by_id" is not null and "relationships"."created_by_member_id" = "relationships"."created_by_id")
      or ("relationships"."created_by_type" not in ('member', 'system') and "relationships"."created_by_id" is not null and "relationships"."created_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_updated_by_actor" CHECK (("relationships"."updated_by_type" is null and "relationships"."updated_by_id" is null and "relationships"."updated_by_member_id" is null)
      or ("relationships"."updated_by_type" = 'system' and "relationships"."updated_by_id" is null and "relationships"."updated_by_member_id" is null)
      or ("relationships"."updated_by_type" = 'member' and "relationships"."updated_by_id" is not null and "relationships"."updated_by_member_id" = "relationships"."updated_by_id")
      or ("relationships"."updated_by_type" not in ('member', 'system') and "relationships"."updated_by_id" is not null and "relationships"."updated_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "task_records" ADD CONSTRAINT "task_records_created_by_actor" CHECK (("task_records"."created_by_type" is null and "task_records"."created_by_id" is null and "task_records"."created_by_member_id" is null)
      or ("task_records"."created_by_type" = 'system' and "task_records"."created_by_id" is null and "task_records"."created_by_member_id" is null)
      or ("task_records"."created_by_type" = 'member' and "task_records"."created_by_id" is not null and "task_records"."created_by_member_id" = "task_records"."created_by_id")
      or ("task_records"."created_by_type" not in ('member', 'system') and "task_records"."created_by_id" is not null and "task_records"."created_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_actor" CHECK (("tasks"."created_by_type" is null and "tasks"."created_by_id" is null and "tasks"."created_by_member_id" is null)
      or ("tasks"."created_by_type" = 'system' and "tasks"."created_by_id" is null and "tasks"."created_by_member_id" is null)
      or ("tasks"."created_by_type" = 'member' and "tasks"."created_by_id" is not null and "tasks"."created_by_member_id" = "tasks"."created_by_id")
      or ("tasks"."created_by_type" not in ('member', 'system') and "tasks"."created_by_id" is not null and "tasks"."created_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_updated_by_actor" CHECK (("tasks"."updated_by_type" is null and "tasks"."updated_by_id" is null and "tasks"."updated_by_member_id" is null)
      or ("tasks"."updated_by_type" = 'system' and "tasks"."updated_by_id" is null and "tasks"."updated_by_member_id" is null)
      or ("tasks"."updated_by_type" = 'member' and "tasks"."updated_by_id" is not null and "tasks"."updated_by_member_id" = "tasks"."updated_by_id")
      or ("tasks"."updated_by_type" not in ('member', 'system') and "tasks"."updated_by_id" is not null and "tasks"."updated_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_done_by_actor" CHECK (("tasks"."done_by_type" is null and "tasks"."done_by_id" is null and "tasks"."done_by_member_id" is null)
      or ("tasks"."done_by_type" = 'system' and "tasks"."done_by_id" is null and "tasks"."done_by_member_id" is null)
      or ("tasks"."done_by_type" = 'member' and "tasks"."done_by_id" is not null and "tasks"."done_by_member_id" = "tasks"."done_by_id")
      or ("tasks"."done_by_type" not in ('member', 'system') and "tasks"."done_by_id" is not null and "tasks"."done_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deleted_by_actor" CHECK (("tasks"."deleted_by_type" is null and "tasks"."deleted_by_id" is null and "tasks"."deleted_by_member_id" is null)
      or ("tasks"."deleted_by_type" = 'system' and "tasks"."deleted_by_id" is null and "tasks"."deleted_by_member_id" is null)
      or ("tasks"."deleted_by_type" = 'member' and "tasks"."deleted_by_id" is not null and "tasks"."deleted_by_member_id" = "tasks"."deleted_by_id")
      or ("tasks"."deleted_by_type" not in ('member', 'system') and "tasks"."deleted_by_id" is not null and "tasks"."deleted_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "validation_rules" ADD CONSTRAINT "validation_rules_created_by_actor" CHECK (("validation_rules"."created_by_type" is null and "validation_rules"."created_by_id" is null and "validation_rules"."created_by_member_id" is null)
      or ("validation_rules"."created_by_type" = 'system' and "validation_rules"."created_by_id" is null and "validation_rules"."created_by_member_id" is null)
      or ("validation_rules"."created_by_type" = 'member' and "validation_rules"."created_by_id" is not null and "validation_rules"."created_by_member_id" = "validation_rules"."created_by_id")
      or ("validation_rules"."created_by_type" not in ('member', 'system') and "validation_rules"."created_by_id" is not null and "validation_rules"."created_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "validation_rules" ADD CONSTRAINT "validation_rules_updated_by_actor" CHECK (("validation_rules"."updated_by_type" is null and "validation_rules"."updated_by_id" is null and "validation_rules"."updated_by_member_id" is null)
      or ("validation_rules"."updated_by_type" = 'system' and "validation_rules"."updated_by_id" is null and "validation_rules"."updated_by_member_id" is null)
      or ("validation_rules"."updated_by_type" = 'member' and "validation_rules"."updated_by_id" is not null and "validation_rules"."updated_by_member_id" = "validation_rules"."updated_by_id")
      or ("validation_rules"."updated_by_type" not in ('member', 'system') and "validation_rules"."updated_by_id" is not null and "validation_rules"."updated_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "values" ADD CONSTRAINT "values_set_by_actor" CHECK (("values"."set_by_type" is null and "values"."set_by_id" is null and "values"."set_by_member_id" is null)
      or ("values"."set_by_type" = 'system' and "values"."set_by_id" is null and "values"."set_by_member_id" is null)
      or ("values"."set_by_type" = 'member' and "values"."set_by_id" is not null and "values"."set_by_member_id" = "values"."set_by_id")
      or ("values"."set_by_type" not in ('member', 'system') and "values"."set_by_id" is not null and "values"."set_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "values" ADD CONSTRAINT "values_actor_actor" CHECK (("values"."actor_type" is null and "values"."actor_id" is null and "values"."actor_member_id" is null)
      or ("values"."actor_type" = 'system' and "values"."actor_id" is null and "values"."actor_member_id" is null)
      or ("values"."actor_type" = 'member' and "values"."actor_id" is not null and "values"."actor_member_id" = "values"."actor_id")
      or ("values"."actor_type" not in ('member', 'system') and "values"."actor_id" is not null and "values"."actor_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_created_by_actor" CHECK (("views"."created_by_type" is null and "views"."created_by_id" is null and "views"."created_by_member_id" is null)
      or ("views"."created_by_type" = 'system' and "views"."created_by_id" is null and "views"."created_by_member_id" is null)
      or ("views"."created_by_type" = 'member' and "views"."created_by_id" is not null and "views"."created_by_member_id" = "views"."created_by_id")
      or ("views"."created_by_type" not in ('member', 'system') and "views"."created_by_id" is not null and "views"."created_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_updated_by_actor" CHECK (("views"."updated_by_type" is null and "views"."updated_by_id" is null and "views"."updated_by_member_id" is null)
      or ("views"."updated_by_type" = 'system' and "views"."updated_by_id" is null and "views"."updated_by_member_id" is null)
      or ("views"."updated_by_type" = 'member' and "views"."updated_by_id" is not null and "views"."updated_by_member_id" = "views"."updated_by_id")
      or ("views"."updated_by_type" not in ('member', 'system') and "views"."updated_by_id" is not null and "views"."updated_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_actor" CHECK (("workspaces"."created_by_type" is null and "workspaces"."created_by_id" is null and "workspaces"."created_by_member_id" is null)
      or ("workspaces"."created_by_type" = 'system' and "workspaces"."created_by_id" is null and "workspaces"."created_by_member_id" is null)
      or ("workspaces"."created_by_type" = 'member' and "workspaces"."created_by_id" is not null and "workspaces"."created_by_member_id" = "workspaces"."created_by_id")
      or ("workspaces"."created_by_type" not in ('member', 'system') and "workspaces"."created_by_id" is not null and "workspaces"."created_by_member_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_updated_by_actor" CHECK (("workspaces"."updated_by_type" is null and "workspaces"."updated_by_id" is null and "workspaces"."updated_by_member_id" is null)
      or ("workspaces"."updated_by_type" = 'system' and "workspaces"."updated_by_id" is null and "workspaces"."updated_by_member_id" is null)
      or ("workspaces"."updated_by_type" = 'member' and "workspaces"."updated_by_id" is not null and "workspaces"."updated_by_member_id" = "workspaces"."updated_by_id")
      or ("workspaces"."updated_by_type" not in ('member', 'system') and "workspaces"."updated_by_id" is not null and "workspaces"."updated_by_member_id" is null)) NOT VALID;
--> statement-breakpoint

-- Hand written from here.
-- The standard policy on each new table: an unset workspace matches nothing, even for the owner.
alter table forms enable row level security;
--> statement-breakpoint
alter table forms force row level security;
--> statement-breakpoint
create policy forms_tenant on forms
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table form_versions enable row level security;
--> statement-breakpoint
alter table form_versions force row level security;
--> statement-breakpoint
create policy form_versions_tenant on form_versions
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table form_submissions enable row level security;
--> statement-breakpoint
alter table form_submissions force row level security;
--> statement-breakpoint
create policy form_submissions_tenant on form_submissions
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table form_submission_records enable row level security;
--> statement-breakpoint
alter table form_submission_records force row level security;
--> statement-breakpoint
create policy form_submission_records_tenant on form_submission_records
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- The public lookup's role: no login, no power but reading three columns of forms past row level security.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_form_lookup') then
    create role crm_form_lookup nologin nosuperuser bypassrls nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$$;
--> statement-breakpoint
alter role crm_form_lookup nologin bypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant usage on schema public to crm_form_lookup;
--> statement-breakpoint
grant select (workspace_id, id, public_key) on forms to crm_form_lookup;
--> statement-breakpoint

-- The workspace and form a public key names, or no row. Ids only: no name, status or document, which the caller
-- then reads inside withWorkspace() under row level security. Hardened as crm_workspace_ids in 0034: a standard SQL
-- body bound to its table, a fixed search_path, every name qualified, the parameter by the function's name.
create function crm_form_by_key(key text)
  returns table (workspace_id uuid, form_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select f.workspace_id, f.id
  from public.forms f
  where f.public_key = crm_form_by_key.key
  limit 1;
end;
--> statement-breakpoint
revoke all on function crm_form_by_key(text) from public;
--> statement-breakpoint
grant execute on function crm_form_by_key(text) to crm_app;
--> statement-breakpoint
grant crm_form_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_form_lookup;
--> statement-breakpoint
alter function crm_form_by_key(text) owner to crm_form_lookup;
--> statement-breakpoint
revoke create on schema public from crm_form_lookup;
--> statement-breakpoint
revoke crm_form_lookup from current_user;
--> statement-breakpoint

-- Refuse to finish unless the lookup is as narrow as it reads: owned by crm_form_lookup, executable by it and
-- crm_app alone (crm_worker reaches it through crm_app), out of the identity login's reach, and crm_form_lookup a
-- plain role in no role, holding nothing but the three columns.
do $$
declare
  lookup constant regprocedure := 'public.crm_form_by_key(text)'::regprocedure;
begin
  if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = lookup) <> 'crm_form_lookup'
    or exists (
      select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid = lookup and a.privilege_type = 'EXECUTE'
        and a.grantee not in ('crm_form_lookup'::regrole, 'crm_app'::regrole)
    )
    or has_function_privilege('crm_identity', lookup, 'EXECUTE') then
    raise exception 'crm_form_by_key must be owned by crm_form_lookup and executable by crm_app alone';
  end if;
  if exists (
    select 1 from pg_auth_members m where m.member = 'crm_form_lookup'::regrole
  ) or pg_has_role('crm_app', 'crm_form_lookup', 'MEMBER')
    or pg_has_role('crm_identity', 'crm_form_lookup', 'MEMBER')
    or exists (
      select 1 from pg_roles
      where rolname = 'crm_form_lookup' and (rolsuper or rolreplication or rolcreatedb or rolcreaterole or rolcanlogin
        or not rolbypassrls)
    ) then
    raise exception 'crm_form_lookup must be a plain role in no role';
  end if;
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(privilege)
    where c.relkind in ('r', 'p', 'v', 'm', 'f')
      and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_toast%'
      and has_table_privilege('crm_form_lookup', c.oid, p.privilege)
  ) or exists (
    select 1
    from pg_attribute att
    cross join lateral aclexplode(att.attacl) a
    where a.grantee = 'crm_form_lookup'::regrole
      and not (att.attrelid = 'public.forms'::regclass and att.attname in ('workspace_id', 'id', 'public_key')
        and a.privilege_type = 'SELECT')
  ) then
    raise exception 'crm_form_lookup may only read forms.workspace_id, id and public_key';
  end if;
end
$$;
