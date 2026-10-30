-- Meeting limits (spec 0037, job J7, AC-1297 to AC-1299): `member_booking_limits`, one row per member, at most
-- `per_day` meetings a day (1 to 50) and `per_week` a week (1 to 200) across every page they host, counted in their
-- default schedule's zone with weeks from Monday. Either may be absent; a row with neither is deleted rather than
-- kept (`member_booking_limits_some`). The slot engine reads it for every member a page books (one query, through
-- the primary key), and the booking's recheck counts again under the host lock.
--
-- A new, empty table: no lock on anything that holds rows. The standard tenant policy, forced (the guard tests).
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "member_booking_limits" (
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"per_day" smallint,
	"per_week" smallint,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "member_booking_limits_pkey" PRIMARY KEY("workspace_id","member_id"),
	CONSTRAINT "member_booking_limits_per_day" CHECK ("member_booking_limits"."per_day" is null or "member_booking_limits"."per_day" between 1 and 50),
	CONSTRAINT "member_booking_limits_per_week" CHECK ("member_booking_limits"."per_week" is null or "member_booking_limits"."per_week" between 1 and 200),
	CONSTRAINT "member_booking_limits_some" CHECK (num_nonnulls("member_booking_limits"."per_day", "member_booking_limits"."per_week") > 0),
	CONSTRAINT "member_booking_limits_created_by_actor" CHECK (("member_booking_limits"."created_by_type" is null and "member_booking_limits"."created_by_id" is null and "member_booking_limits"."created_by_member_id" is null)
      or ("member_booking_limits"."created_by_type" = 'system' and "member_booking_limits"."created_by_id" is null and "member_booking_limits"."created_by_member_id" is null)
      or ("member_booking_limits"."created_by_type" = 'member' and "member_booking_limits"."created_by_id" is not null and "member_booking_limits"."created_by_member_id" = "member_booking_limits"."created_by_id")
      or ("member_booking_limits"."created_by_type"::text not in ('member', 'system', 'calendar') and "member_booking_limits"."created_by_id" is not null and "member_booking_limits"."created_by_member_id" is null)),
	CONSTRAINT "member_booking_limits_updated_by_actor" CHECK (("member_booking_limits"."updated_by_type" is null and "member_booking_limits"."updated_by_id" is null and "member_booking_limits"."updated_by_member_id" is null)
      or ("member_booking_limits"."updated_by_type" = 'system' and "member_booking_limits"."updated_by_id" is null and "member_booking_limits"."updated_by_member_id" is null)
      or ("member_booking_limits"."updated_by_type" = 'member' and "member_booking_limits"."updated_by_id" is not null and "member_booking_limits"."updated_by_member_id" = "member_booking_limits"."updated_by_id")
      or ("member_booking_limits"."updated_by_type"::text not in ('member', 'system', 'calendar') and "member_booking_limits"."updated_by_id" is not null and "member_booking_limits"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "member_booking_limits" ADD CONSTRAINT "member_booking_limits_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_booking_limits" ADD CONSTRAINT "member_booking_limits_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_booking_limits" ADD CONSTRAINT "member_booking_limits_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table member_booking_limits enable row level security;
--> statement-breakpoint
alter table member_booking_limits force row level security;
--> statement-breakpoint
create policy member_booking_limits_tenant on member_booking_limits
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
