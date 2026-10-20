-- The sidebar (spec 0034, milestone 1): one row per member per workspace holding their own sidebar choices (order,
-- hidden items, favourites, folded sections, section order and the rail), and the `nav` outbox kind that tells the
-- member's other tabs. The type value, table, keys and checks are drizzle-kit's; this header, the lock timeout and
-- row level security at the end are hand written.
--
-- `outbox_kind` gains `nav`. Enum values are only ever added, and nothing in this migration uses it.
--
-- The foreign keys briefly lock members against writes. Give up after 5 seconds rather than queue behind traffic,
-- like 0035, 0037 and 0038.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TYPE "public"."outbox_kind" ADD VALUE 'nav';--> statement-breakpoint
CREATE TABLE "member_nav_prefs" (
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sections" jsonb DEFAULT '{"order": [], "folded": []}'::jsonb NOT NULL,
	"rail" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "member_nav_prefs_pkey" PRIMARY KEY("workspace_id","member_id"),
	CONSTRAINT "member_nav_prefs_items" CHECK (jsonb_typeof("member_nav_prefs"."items") = 'array' and jsonb_array_length("member_nav_prefs"."items") <= 400),
	CONSTRAINT "member_nav_prefs_sections" CHECK (jsonb_typeof("member_nav_prefs"."sections") = 'object' and octet_length("member_nav_prefs"."sections"::text) <= 1024),
	CONSTRAINT "member_nav_prefs_version" CHECK ("member_nav_prefs"."version" >= 1),
	CONSTRAINT "member_nav_prefs_created_by_actor" CHECK (("member_nav_prefs"."created_by_type" is null and "member_nav_prefs"."created_by_id" is null and "member_nav_prefs"."created_by_member_id" is null)
      or ("member_nav_prefs"."created_by_type" = 'system' and "member_nav_prefs"."created_by_id" is null and "member_nav_prefs"."created_by_member_id" is null)
      or ("member_nav_prefs"."created_by_type" = 'member' and "member_nav_prefs"."created_by_id" is not null and "member_nav_prefs"."created_by_member_id" = "member_nav_prefs"."created_by_id")
      or ("member_nav_prefs"."created_by_type"::text not in ('member', 'system', 'calendar') and "member_nav_prefs"."created_by_id" is not null and "member_nav_prefs"."created_by_member_id" is null)),
	CONSTRAINT "member_nav_prefs_updated_by_actor" CHECK (("member_nav_prefs"."updated_by_type" is null and "member_nav_prefs"."updated_by_id" is null and "member_nav_prefs"."updated_by_member_id" is null)
      or ("member_nav_prefs"."updated_by_type" = 'system' and "member_nav_prefs"."updated_by_id" is null and "member_nav_prefs"."updated_by_member_id" is null)
      or ("member_nav_prefs"."updated_by_type" = 'member' and "member_nav_prefs"."updated_by_id" is not null and "member_nav_prefs"."updated_by_member_id" = "member_nav_prefs"."updated_by_id")
      or ("member_nav_prefs"."updated_by_type"::text not in ('member', 'system', 'calendar') and "member_nav_prefs"."updated_by_id" is not null and "member_nav_prefs"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "member_nav_prefs" ADD CONSTRAINT "member_nav_prefs_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_nav_prefs" ADD CONSTRAINT "member_nav_prefs_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_nav_prefs" ADD CONSTRAINT "member_nav_prefs_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table member_nav_prefs enable row level security;
--> statement-breakpoint
alter table member_nav_prefs force row level security;
--> statement-breakpoint
create policy member_nav_prefs_tenant on member_nav_prefs
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
