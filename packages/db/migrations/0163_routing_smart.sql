-- Smart ranking, fit and lead owners that follow their meeting (spec 0037, lane L8).
--
-- `routing_decisions` (AC-1362, AC-1372, AC-1373): four nullable columns with no default, so no table rewrite and no
-- scan under the lock (AC-1446). `assigned_member_id` and `assigned_at` are the lead owner claim a form's row
-- carries: whoever moves `assigned_at` from null wins, so the booking and the unbooked job can never both assign.
-- `facts` holds the option ids, numbers and yes or no the ranking and fit read (never free text); `snapshot` every
-- candidate's numbers at the booking, which every explanation is built from.
--
-- `routing_settings` (AC-1361, AC-1363): the smart mode, the fairness allowance and the fit links. Null is "never
-- set", which the code reads as its own default; an unknown mode reads as off (AC-1223). `routing_settings` holds one
-- small row a workspace, so its check is validated at once.
--
-- The foreign key and the claim's check go on NOT VALID (AC-1446) and are validated by a later migration outside the
-- deploy, as `0040_forms.sql` does.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "routing_decisions" ADD COLUMN "assigned_member_id" uuid;--> statement-breakpoint
ALTER TABLE "routing_decisions" ADD COLUMN "assigned_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "routing_decisions" ADD COLUMN "facts" jsonb;--> statement-breakpoint
ALTER TABLE "routing_decisions" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "routing_decisions" ADD CONSTRAINT "routing_decisions_assigned_member" FOREIGN KEY ("workspace_id","assigned_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "routing_decisions" ADD CONSTRAINT "routing_decisions_claim" CHECK (("routing_decisions"."assigned_member_id" is null and "routing_decisions"."assigned_at" is null) or ("routing_decisions"."surface_kind" = 'form' and "routing_decisions"."assigned_at" is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "routing_settings" ADD COLUMN "smart_mode" text;--> statement-breakpoint
ALTER TABLE "routing_settings" ADD COLUMN "tilt_percent" smallint;--> statement-breakpoint
ALTER TABLE "routing_settings" ADD COLUMN "fit" jsonb;--> statement-breakpoint
ALTER TABLE "routing_settings" ADD CONSTRAINT "routing_settings_tilt" CHECK ("routing_settings"."tilt_percent" is null or "routing_settings"."tilt_percent" between 0 and 50);
