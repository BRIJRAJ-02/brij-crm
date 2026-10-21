-- Removal effects (spec 0031, slice 5, AC-814, AC-815): members say when they left and who removed them (an active
-- member never carries a leaving time; rows removed before this take their last update's); a booking page paused
-- because nobody is left to host it says so (`paused_reason = 'host_removed'`, spec 0025 owns the table); a meeting
-- synced from a removed member's calendar stays and says its organiser left (`organizer_removed`, spec 0024 owns the
-- table). Nullable columns or constant defaults with checks, so no table is rewritten.
--
-- Row security off for the backfill: the owner bypasses it (as on Neon), and a role it would filter fails here
-- rather than backfilling nothing. Give up after 5 seconds rather than queue behind traffic, like 0041.
set local lock_timeout = '5s';
--> statement-breakpoint
set local row_security = off;
--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "paused_reason" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "organizer_removed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "left_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "removed_by_type" "actor_type";--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "removed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "removed_by_member_id" uuid;--> statement-breakpoint
update members set left_at = updated_at where status = 'removed' and left_at is null;
--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_removed_by" FOREIGN KEY ("workspace_id","removed_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_paused_reason" CHECK ("booking_pages"."paused_reason" is null or "booking_pages"."paused_reason" = 'host_removed');--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_removed_by_actor" CHECK (("members"."removed_by_type" is null and "members"."removed_by_id" is null and "members"."removed_by_member_id" is null)
      or ("members"."removed_by_type" = 'system' and "members"."removed_by_id" is null and "members"."removed_by_member_id" is null)
      or ("members"."removed_by_type" = 'member' and "members"."removed_by_id" is not null and "members"."removed_by_member_id" = "members"."removed_by_id")
      or ("members"."removed_by_type"::text not in ('member', 'system', 'calendar') and "members"."removed_by_id" is not null and "members"."removed_by_member_id" is null));--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_left" CHECK ("members"."status" = 'removed' or "members"."left_at" is null);