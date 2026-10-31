-- Teams in scheduling reach (spec 0037, lane L3a, AC-1443): `schedule_delegations.target_team_id` (0125) gets its
-- foreign key to `teams` now that teams exist (0139), `on delete cascade`, so a deleted team's delegations go with it
-- (AC-1269). It is added `not valid` (no scan under the lock), then validated in its own statement, which takes only a
-- share update exclusive lock. No row can break it: core refused every team target until this lane.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "schedule_delegations" ADD CONSTRAINT "schedule_delegations_target_team" FOREIGN KEY ("workspace_id","target_team_id") REFERENCES "public"."teams"("workspace_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "schedule_delegations" VALIDATE CONSTRAINT "schedule_delegations_target_team";
