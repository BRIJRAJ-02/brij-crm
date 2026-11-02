-- Managed booking pages (spec 0037, lane L10, AC-1333 to AC-1336): one template holding a page's settings, the
-- members it makes a page for, and which parts those members may not change.
--
-- NUMBER IS A PLACEHOLDER (`0xxx_`): four branches picked a number by reading main on 2 November and three collided,
-- so this lane leaves it to the coordinator, who renumbers the file and restamps the journal's `when` when the
-- integration car is assembled — the only moment the right number is knowable.
--
-- One new, empty table and three nullable columns with no default on `booking_pages` (a catalog change, no rewrite).
-- Every check and foreign key they add holds on columns that are null in every existing row, so validating them
-- reads `booking_pages` once without holding writes for long; it is a small table (pages, not records).
--
-- `booking_pages_template` is hand written below rather than generated: drizzle can't say `set null (template_id)`,
-- and a plain `on delete set null` over the composite key would null `workspace_id` too, which the tenancy policy
-- would then refuse. Deleting a template is a soft delete in core anyway (it keeps every member page and clears
-- their `template_id` in the same transaction, AC-1335); this foreign key is the backstop for a hard purge.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "managed_page_members" (
	"workspace_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "managed_page_members_pkey" PRIMARY KEY("workspace_id","template_id","member_id"),
	CONSTRAINT "managed_page_members_created_by_actor" CHECK (("managed_page_members"."created_by_type" is null and "managed_page_members"."created_by_id" is null and "managed_page_members"."created_by_member_id" is null)
      or ("managed_page_members"."created_by_type" = 'system' and "managed_page_members"."created_by_id" is null and "managed_page_members"."created_by_member_id" is null)
      or ("managed_page_members"."created_by_type" = 'member' and "managed_page_members"."created_by_id" is not null and "managed_page_members"."created_by_member_id" = "managed_page_members"."created_by_id")
      or ("managed_page_members"."created_by_type"::text not in ('member', 'system', 'calendar') and "managed_page_members"."created_by_id" is not null and "managed_page_members"."created_by_member_id" is null)),
	CONSTRAINT "managed_page_members_updated_by_actor" CHECK (("managed_page_members"."updated_by_type" is null and "managed_page_members"."updated_by_id" is null and "managed_page_members"."updated_by_member_id" is null)
      or ("managed_page_members"."updated_by_type" = 'system' and "managed_page_members"."updated_by_id" is null and "managed_page_members"."updated_by_member_id" is null)
      or ("managed_page_members"."updated_by_type" = 'member' and "managed_page_members"."updated_by_id" is not null and "managed_page_members"."updated_by_member_id" = "managed_page_members"."updated_by_id")
      or ("managed_page_members"."updated_by_type"::text not in ('member', 'system', 'calendar') and "managed_page_members"."updated_by_id" is not null and "managed_page_members"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "managed_page_members" ADD CONSTRAINT "managed_page_members_template" FOREIGN KEY ("workspace_id","template_id") REFERENCES "public"."booking_pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_page_members" ADD CONSTRAINT "managed_page_members_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_page_members" ADD CONSTRAINT "managed_page_members_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_page_members" ADD CONSTRAINT "managed_page_members_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "managed_page_members_by_member" ON "managed_page_members" USING btree ("workspace_id","member_id");--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "locked" text[];--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "follow_team_id" uuid;--> statement-breakpoint
-- `on delete restrict`: a team a managed page follows can't vanish under the pages it makes (as a rotation's does).
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_follow_team" FOREIGN KEY ("workspace_id","follow_team_id") REFERENCES "public"."teams"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- `managed` is the template's kind: it holds the settings and is never bookable (its public link answers
-- "no longer available", `liveOf` in core), so it is never a member page itself.
ALTER TABLE "booking_pages" DROP CONSTRAINT "booking_pages_kind";--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_kind" CHECK ("booking_pages"."kind" in ('personal', 'collective', 'round_robin', 'managed'));--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_managed" CHECK (("booking_pages"."kind" = 'managed' and "booking_pages"."template_id" is null)
        or ("booking_pages"."kind" <> 'managed' and "booking_pages"."locked" is null and "booking_pages"."follow_team_id" is null));--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_locked_parts" CHECK ("booking_pages"."locked" is null
        or "booking_pages"."locked" <@ '{details,durations,location,questions,on_booking,limits,hours}'::text[]);--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_managed_scope" CHECK ("booking_pages"."kind" <> 'managed' or "booking_pages"."scope" = 'member');--> statement-breakpoint
CREATE INDEX "booking_pages_by_template" ON "booking_pages" USING btree ("workspace_id","template_id") WHERE "booking_pages"."template_id" is not null and "booking_pages"."deleted_at" is null;--> statement-breakpoint
-- Hand written from here.
-- The template a member page came from, in the same workspace. Only this column is nulled when the template row is
-- purged: a plain `on delete set null` over the composite key would null `workspace_id` too.
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_template" FOREIGN KEY ("workspace_id","template_id") REFERENCES "public"."booking_pages"("workspace_id","id") ON DELETE SET NULL ("template_id") ON UPDATE no action;
--> statement-breakpoint
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table managed_page_members enable row level security;
--> statement-breakpoint
alter table managed_page_members force row level security;
--> statement-breakpoint
create policy managed_page_members_tenant on managed_page_members
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
