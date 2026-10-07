-- Every member holds a role (spec 0009, AC-132): owner, admin or member. The column arrives with a default, so
-- code that ignores it keeps working; 0022 makes each workspace's earliest active member its owner. A default on
-- a new column is stored in the catalog (no table rewrite), so the lock is brief; it gives up after 5 seconds
-- rather than queue behind traffic, like 0019.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "role" "member_role" DEFAULT 'member' NOT NULL;
