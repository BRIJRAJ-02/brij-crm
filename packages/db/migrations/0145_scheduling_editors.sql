-- Page and rotation editors (spec 0037, lane L2, AC-1331): `scheduling_editors`, one row per member a booking page or
-- a rotation names as an editor. An editor changes everything on it except its editors, its deletion and, for a page,
-- its owner; adding a host still needs Manage over that person (AC-1340).
--
-- `resource_type` is `booking_page` or `rotation`, and `resource_id` has no foreign key since it names either table:
-- core deletes a resource's editors in the transaction that deletes it, and reads editors of live resources only.
-- `team_id` gets no foreign key here: there is no `teams` table yet, so spec 0031 slice 8's migration adds it, and
-- core refuses a team editor until then. At most 20 per resource, checked in core (409 `EDITOR_LIMIT`).
--
-- A new, empty table: no lock on anything that holds rows. The standard tenant policy, forced (AC-1446 for the
-- timeout; the guard tests for the policy).
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "scheduling_editors" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"member_id" uuid,
	"team_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "scheduling_editors_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "scheduling_editors_resource_type" CHECK ("scheduling_editors"."resource_type" in ('booking_page', 'rotation')),
	CONSTRAINT "scheduling_editors_one_editor" CHECK (num_nonnulls("scheduling_editors"."member_id", "scheduling_editors"."team_id") = 1),
	CONSTRAINT "scheduling_editors_created_by_actor" CHECK (("scheduling_editors"."created_by_type" is null and "scheduling_editors"."created_by_id" is null and "scheduling_editors"."created_by_member_id" is null)
      or ("scheduling_editors"."created_by_type" = 'system' and "scheduling_editors"."created_by_id" is null and "scheduling_editors"."created_by_member_id" is null)
      or ("scheduling_editors"."created_by_type" = 'member' and "scheduling_editors"."created_by_id" is not null and "scheduling_editors"."created_by_member_id" = "scheduling_editors"."created_by_id")
      or ("scheduling_editors"."created_by_type"::text not in ('member', 'system', 'calendar') and "scheduling_editors"."created_by_id" is not null and "scheduling_editors"."created_by_member_id" is null)),
	CONSTRAINT "scheduling_editors_updated_by_actor" CHECK (("scheduling_editors"."updated_by_type" is null and "scheduling_editors"."updated_by_id" is null and "scheduling_editors"."updated_by_member_id" is null)
      or ("scheduling_editors"."updated_by_type" = 'system' and "scheduling_editors"."updated_by_id" is null and "scheduling_editors"."updated_by_member_id" is null)
      or ("scheduling_editors"."updated_by_type" = 'member' and "scheduling_editors"."updated_by_id" is not null and "scheduling_editors"."updated_by_member_id" = "scheduling_editors"."updated_by_id")
      or ("scheduling_editors"."updated_by_type"::text not in ('member', 'system', 'calendar') and "scheduling_editors"."updated_by_id" is not null and "scheduling_editors"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "scheduling_editors" ADD CONSTRAINT "scheduling_editors_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_editors" ADD CONSTRAINT "scheduling_editors_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_editors" ADD CONSTRAINT "scheduling_editors_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduling_editors_one" ON "scheduling_editors" USING btree ("workspace_id","resource_type","resource_id",coalesce("member_id", "team_id"));--> statement-breakpoint
CREATE INDEX "scheduling_editors_by_member" ON "scheduling_editors" USING btree ("workspace_id","member_id") WHERE "scheduling_editors"."member_id" is not null;--> statement-breakpoint
CREATE INDEX "scheduling_editors_by_team" ON "scheduling_editors" USING btree ("workspace_id","team_id") WHERE "scheduling_editors"."team_id" is not null;--> statement-breakpoint
-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table scheduling_editors enable row level security;
--> statement-breakpoint
alter table scheduling_editors force row level security;
--> statement-breakpoint
create policy scheduling_editors_tenant on scheduling_editors
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
