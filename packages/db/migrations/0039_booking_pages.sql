-- Booking pages (spec 0025, milestone 1): `booking_pages`, `booking_page_members`, `bookings` and
-- `booking_member_hours` (a member's own weekly hours and days off, which their pages may follow), with the standard
-- tenant policy on each; drizzle-kit's tables, keys and indexes, the rest hand written at the end.
--
-- The actor type gains `booking`: the records a visitor's booking writes name the booking page (AC-634). Postgres
-- refuses a new enum value used in the transaction that added it, and the migrator runs every pending migration in one
-- transaction, so the actor rule on every table now names only the two types it excludes (`not in ('member',
-- 'system')`) rather than listing the others (the same reshaping spec 0023's forms migration makes; whichever lands
-- second finds the rules already in this shape). Nothing here uses 'booking'. The new rule is implied by the old one, so
-- every existing row already meets it; each existing table's rule is replaced `not valid`, enforced on every new row at
-- once without scanning a table under its lock.
--
-- Two bookings of one host never overlap: `bookings_no_overlap` excludes confirmed bookings of the same workspace and
-- host whose `during` (the meeting widened by the page's buffers) overlap. btree_gist gives uuid its `=` in a GiST
-- index. The per host advisory lock in the booking service is the guarantee; this is the last guard if anything writes
-- around it.
--
-- The public endpoints find a page by its public key before they know the workspace: crm_booking_page_by_key(key),
-- owned by crm_booking_lookup (no login, bypasses row level security only to read three columns of booking_pages),
-- answers the workspace and page ids and nothing else, for crm_app only. The guest page finds its booking the same
-- way, by the SHA-256 of its manage token: crm_booking_by_token(hash), owned by the same role, which also reads three
-- columns of bookings, answers the workspace, page and booking ids.
--
-- The rules' swap and the foreign keys briefly lock the tables they touch. Give up after 5 seconds rather than queue
-- behind traffic, like 0020, 0023, 0026, 0029, 0033 and 0037.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TYPE "public"."actor_type" ADD VALUE 'booking';--> statement-breakpoint
CREATE TABLE "booking_member_hours" (
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"availability" jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "booking_member_hours_pkey" PRIMARY KEY("workspace_id","member_id"),
	CONSTRAINT "booking_member_hours_created_by_actor" CHECK (("booking_member_hours"."created_by_type" is null and "booking_member_hours"."created_by_id" is null and "booking_member_hours"."created_by_member_id" is null)
      or ("booking_member_hours"."created_by_type" = 'system' and "booking_member_hours"."created_by_id" is null and "booking_member_hours"."created_by_member_id" is null)
      or ("booking_member_hours"."created_by_type" = 'member' and "booking_member_hours"."created_by_id" is not null and "booking_member_hours"."created_by_member_id" = "booking_member_hours"."created_by_id")
      or ("booking_member_hours"."created_by_type" not in ('member', 'system') and "booking_member_hours"."created_by_id" is not null and "booking_member_hours"."created_by_member_id" is null)),
	CONSTRAINT "booking_member_hours_updated_by_actor" CHECK (("booking_member_hours"."updated_by_type" is null and "booking_member_hours"."updated_by_id" is null and "booking_member_hours"."updated_by_member_id" is null)
      or ("booking_member_hours"."updated_by_type" = 'system' and "booking_member_hours"."updated_by_id" is null and "booking_member_hours"."updated_by_member_id" is null)
      or ("booking_member_hours"."updated_by_type" = 'member' and "booking_member_hours"."updated_by_id" is not null and "booking_member_hours"."updated_by_member_id" = "booking_member_hours"."updated_by_id")
      or ("booking_member_hours"."updated_by_type" not in ('member', 'system') and "booking_member_hours"."updated_by_id" is not null and "booking_member_hours"."updated_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "booking_page_members" (
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "booking_page_members_pkey" PRIMARY KEY("workspace_id","page_id","member_id"),
	CONSTRAINT "booking_page_members_position" CHECK ("booking_page_members"."position" between 0 and 7)
);
--> statement-breakpoint
CREATE TABLE "booking_pages" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"public_key" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'personal' NOT NULL,
	"owner_member_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"durations" smallint[] NOT NULL,
	"location" jsonb NOT NULL,
	"availability" jsonb NOT NULL,
	"buffer_before" smallint DEFAULT 0 NOT NULL,
	"buffer_after" smallint DEFAULT 0 NOT NULL,
	"min_notice_minutes" integer DEFAULT 0 NOT NULL,
	"window_days" smallint DEFAULT 60 NOT NULL,
	"daily_limit" smallint,
	"slot_step" smallint,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deal" jsonb,
	"status" text DEFAULT 'live' NOT NULL,
	"hours_mode" text DEFAULT 'own' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	"deleted_at" timestamp (6) with time zone,
	CONSTRAINT "booking_pages_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "booking_pages_public_key_shape" CHECK ("booking_pages"."public_key" ~ '^[A-Za-z0-9_-]{16}$'),
	CONSTRAINT "booking_pages_slug_shape" CHECK ("booking_pages"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("booking_pages"."slug") <= 60),
	CONSTRAINT "booking_pages_kind" CHECK ("booking_pages"."kind" in ('personal', 'collective', 'round_robin')),
	CONSTRAINT "booking_pages_status" CHECK ("booking_pages"."status" in ('live', 'paused')),
	CONSTRAINT "booking_pages_hours_mode" CHECK ("booking_pages"."hours_mode" in ('mine', 'own')),
	CONSTRAINT "booking_pages_title" CHECK (char_length("booking_pages"."title") between 1 and 120),
	CONSTRAINT "booking_pages_description" CHECK (char_length("booking_pages"."description") <= 2000),
	CONSTRAINT "booking_pages_durations" CHECK (cardinality("booking_pages"."durations") between 1 and 5 and "booking_pages"."durations" <@ '{15,30,45,60,90}'::smallint[]),
	CONSTRAINT "booking_pages_buffers" CHECK ("booking_pages"."buffer_before" between 0 and 60 and "booking_pages"."buffer_after" between 0 and 60),
	CONSTRAINT "booking_pages_notice" CHECK ("booking_pages"."min_notice_minutes" between 0 and 20160),
	CONSTRAINT "booking_pages_window" CHECK ("booking_pages"."window_days" between 1 and 365),
	CONSTRAINT "booking_pages_daily_limit" CHECK ("booking_pages"."daily_limit" is null or "booking_pages"."daily_limit" between 1 and 50),
	CONSTRAINT "booking_pages_slot_step" CHECK ("booking_pages"."slot_step" is null or "booking_pages"."slot_step" in (15, 30, 60)),
	CONSTRAINT "booking_pages_created_by_actor" CHECK (("booking_pages"."created_by_type" is null and "booking_pages"."created_by_id" is null and "booking_pages"."created_by_member_id" is null)
      or ("booking_pages"."created_by_type" = 'system' and "booking_pages"."created_by_id" is null and "booking_pages"."created_by_member_id" is null)
      or ("booking_pages"."created_by_type" = 'member' and "booking_pages"."created_by_id" is not null and "booking_pages"."created_by_member_id" = "booking_pages"."created_by_id")
      or ("booking_pages"."created_by_type" not in ('member', 'system') and "booking_pages"."created_by_id" is not null and "booking_pages"."created_by_member_id" is null)),
	CONSTRAINT "booking_pages_updated_by_actor" CHECK (("booking_pages"."updated_by_type" is null and "booking_pages"."updated_by_id" is null and "booking_pages"."updated_by_member_id" is null)
      or ("booking_pages"."updated_by_type" = 'system' and "booking_pages"."updated_by_id" is null and "booking_pages"."updated_by_member_id" is null)
      or ("booking_pages"."updated_by_type" = 'member' and "booking_pages"."updated_by_id" is not null and "booking_pages"."updated_by_member_id" = "booking_pages"."updated_by_id")
      or ("booking_pages"."updated_by_type" not in ('member', 'system') and "booking_pages"."updated_by_id" is not null and "booking_pages"."updated_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"page_id" uuid NOT NULL,
	"host_member_id" uuid NOT NULL,
	"starts_at" timestamp (6) with time zone NOT NULL,
	"ends_at" timestamp (6) with time zone NOT NULL,
	"during" "tstzrange" NOT NULL,
	"visitor_name" text NOT NULL,
	"visitor_email" text NOT NULL,
	"visitor_time_zone" text NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"cancel_reason" text,
	"reschedules" smallint DEFAULT 0 NOT NULL,
	"manage_token_hash" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"meeting_id" uuid,
	"video_url" text,
	"event_failed_at" timestamp (6) with time zone,
	"person_record_id" uuid,
	"company_record_id" uuid,
	"deal_record_id" uuid,
	"submission_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "bookings_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "bookings_status" CHECK ("bookings"."status" in ('confirmed', 'cancelled')),
	CONSTRAINT "bookings_times" CHECK ("bookings"."ends_at" > "bookings"."starts_at"),
	CONSTRAINT "bookings_during" CHECK (lower("bookings"."during") <= "bookings"."starts_at" and upper("bookings"."during") >= "bookings"."ends_at" and lower_inc("bookings"."during") and not upper_inc("bookings"."during")),
	CONSTRAINT "bookings_cancelled" CHECK ("bookings"."status" = 'cancelled' or "bookings"."cancel_reason" is null),
	CONSTRAINT "bookings_visitor" CHECK (char_length("bookings"."visitor_name") between 1 and 200 and char_length("bookings"."visitor_email") between 3 and 254),
	CONSTRAINT "bookings_reschedules" CHECK ("bookings"."reschedules" between 0 and 5),
	CONSTRAINT "bookings_video_url" CHECK ("bookings"."video_url" is null or char_length("bookings"."video_url") <= 2000),
	CONSTRAINT "bookings_created_by_actor" CHECK (("bookings"."created_by_type" is null and "bookings"."created_by_id" is null and "bookings"."created_by_member_id" is null)
      or ("bookings"."created_by_type" = 'system' and "bookings"."created_by_id" is null and "bookings"."created_by_member_id" is null)
      or ("bookings"."created_by_type" = 'member' and "bookings"."created_by_id" is not null and "bookings"."created_by_member_id" = "bookings"."created_by_id")
      or ("bookings"."created_by_type" not in ('member', 'system') and "bookings"."created_by_id" is not null and "bookings"."created_by_member_id" is null)),
	CONSTRAINT "bookings_updated_by_actor" CHECK (("bookings"."updated_by_type" is null and "bookings"."updated_by_id" is null and "bookings"."updated_by_member_id" is null)
      or ("bookings"."updated_by_type" = 'system' and "bookings"."updated_by_id" is null and "bookings"."updated_by_member_id" is null)
      or ("bookings"."updated_by_type" = 'member' and "bookings"."updated_by_id" is not null and "bookings"."updated_by_member_id" = "bookings"."updated_by_id")
      or ("bookings"."updated_by_type" not in ('member', 'system') and "bookings"."updated_by_id" is not null and "bookings"."updated_by_member_id" is null))
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
ALTER TABLE "booking_member_hours" ADD CONSTRAINT "booking_member_hours_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_member_hours" ADD CONSTRAINT "booking_member_hours_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_member_hours" ADD CONSTRAINT "booking_member_hours_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_page_members" ADD CONSTRAINT "booking_page_members_page" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."booking_pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_page_members" ADD CONSTRAINT "booking_page_members_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_owner" FOREIGN KEY ("workspace_id","owner_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_page" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."booking_pages"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_host" FOREIGN KEY ("workspace_id","host_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_page_members_by_member" ON "booking_page_members" USING btree ("workspace_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_pages_public_key" ON "booking_pages" USING btree ("public_key");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_pages_slug" ON "booking_pages" USING btree ("workspace_id","slug") WHERE "booking_pages"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "booking_pages_by_owner" ON "booking_pages" USING btree ("workspace_id","owner_member_id","created_at") WHERE "booking_pages"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_attempt" ON "bookings" USING btree ("workspace_id","page_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_manage_token" ON "bookings" USING btree ("manage_token_hash");--> statement-breakpoint
CREATE INDEX "bookings_by_page" ON "bookings" USING btree ("workspace_id","page_id","starts_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "bookings_by_host" ON "bookings" USING btree ("workspace_id","host_member_id","starts_at") WHERE "bookings"."status" = 'confirmed';--> statement-breakpoint
CREATE INDEX "bookings_by_person" ON "bookings" USING btree ("workspace_id","person_record_id","created_at") WHERE "bookings"."person_record_id" is not null;--> statement-breakpoint
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
alter table booking_pages enable row level security;
--> statement-breakpoint
alter table booking_pages force row level security;
--> statement-breakpoint
create policy booking_pages_tenant on booking_pages
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table booking_page_members enable row level security;
--> statement-breakpoint
alter table booking_page_members force row level security;
--> statement-breakpoint
create policy booking_page_members_tenant on booking_page_members
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table booking_member_hours enable row level security;
--> statement-breakpoint
alter table booking_member_hours force row level security;
--> statement-breakpoint
create policy booking_member_hours_tenant on booking_member_hours
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table bookings enable row level security;
--> statement-breakpoint
alter table bookings force row level security;
--> statement-breakpoint
create policy bookings_tenant on bookings
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- No double booking, whatever writes the row (AC-632).
create extension if not exists btree_gist;
--> statement-breakpoint
alter table bookings
  add constraint bookings_no_overlap
  exclude using gist (workspace_id with =, host_member_id with =, during with &&)
  where (status = 'confirmed');
--> statement-breakpoint

-- The public lookup's role: no login, no power but reading three columns of booking_pages past row level security.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_booking_lookup') then
    create role crm_booking_lookup nologin nosuperuser bypassrls nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$$;
--> statement-breakpoint
alter role crm_booking_lookup nologin bypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant usage on schema public to crm_booking_lookup;
--> statement-breakpoint
grant select (workspace_id, id, public_key) on booking_pages to crm_booking_lookup;
--> statement-breakpoint
grant select (workspace_id, id, page_id, manage_token_hash) on bookings to crm_booking_lookup;
--> statement-breakpoint

-- The workspace and page a public key names, or no row. Ids only: no title, status or hours, which the caller then
-- reads inside withWorkspace() under row level security. Hardened as crm_workspace_ids in 0034: a standard SQL body
-- bound to its table, a fixed search_path, every name qualified, the parameter by the function's name.
create function crm_booking_page_by_key(key text)
  returns table (workspace_id uuid, page_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.workspace_id, p.id
  from public.booking_pages p
  where p.public_key = crm_booking_page_by_key.key
  limit 1;
end;
--> statement-breakpoint
revoke all on function crm_booking_page_by_key(text) from public;
--> statement-breakpoint
grant execute on function crm_booking_page_by_key(text) to crm_app;
--> statement-breakpoint

-- The workspace, page and booking a manage token's hash names, or no row. Ids only, hardened the same way.
create function crm_booking_by_token(token_hash text)
  returns table (workspace_id uuid, page_id uuid, booking_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select b.workspace_id, b.page_id, b.id
  from public.bookings b
  where b.manage_token_hash = crm_booking_by_token.token_hash
  limit 1;
end;
--> statement-breakpoint
revoke all on function crm_booking_by_token(text) from public;
--> statement-breakpoint
grant execute on function crm_booking_by_token(text) to crm_app;
--> statement-breakpoint
grant crm_booking_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_booking_lookup;
--> statement-breakpoint
alter function crm_booking_page_by_key(text) owner to crm_booking_lookup;
--> statement-breakpoint
alter function crm_booking_by_token(text) owner to crm_booking_lookup;
--> statement-breakpoint
revoke create on schema public from crm_booking_lookup;
--> statement-breakpoint
revoke crm_booking_lookup from current_user;
