-- Teams in scheduling reach (spec 0037, lane L3a, AC-1443): `schedule_delegations.target_team_id` (0125) gets its
-- foreign key to `teams` now that teams exist (0139), `on delete cascade`, so a deleted team's delegations go with it
-- (AC-1269). It is added `not valid` and validated at once: in the migration's one transaction the lock the add
-- takes is held through the validation, which is fine on this small table (no row can break it: core refused every
-- team target until this lane). A table that grew large would move the validation to a later migration.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "schedule_delegations" ADD CONSTRAINT "schedule_delegations_target_team" FOREIGN KEY ("workspace_id","target_team_id") REFERENCES "public"."teams"("workspace_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "schedule_delegations" VALIDATE CONSTRAINT "schedule_delegations_target_team";
