-- Workspaces made in UTC take the zone they work in (meetings QA, 4 November 2026).
--
-- Until first run sent the maker's browser zone, every workspace was made in UTC. A member who has set no zone of
-- their own reads in the workspace's, so a team in Kolkata saw its hosts' hours drawn as 9 to 5 GMT on the Team
-- calendar (every booking flagged "Outside hours") and had daily limits counted in UTC days, while its booking pages
-- offered times in their own zone. Each workspace still on 'UTC' takes the zone most of its live booking pages use
-- (ties to the zone name, so a rerun picks the same), else its owner's default schedule's, else the owner's own
-- preference; with none of those, or only UTC ones, it stays as it is. Only zone names Postgres knows are taken.
-- Idempotent: a workspace that moved off UTC is never touched again, and one left on UTC gets the same answer.
set local lock_timeout = '5s';
--> statement-breakpoint
WITH "page_zones" AS (
	SELECT "workspace_id", "availability"->>'timeZone' AS "zone", count(*) AS "pages"
	FROM "booking_pages"
	WHERE "deleted_at" IS NULL
	GROUP BY 1, 2
), "page_pick" AS (
	SELECT DISTINCT ON ("workspace_id") "workspace_id", "zone"
	FROM "page_zones"
	WHERE "zone" IS NOT NULL AND "zone" NOT IN ('UTC', 'Etc/UTC')
		AND EXISTS (SELECT 1 FROM pg_timezone_names "n" WHERE "n"."name" = "page_zones"."zone")
	ORDER BY "workspace_id", "pages" DESC, "zone"
), "owner_pick" AS (
	SELECT DISTINCT ON ("m"."workspace_id") "m"."workspace_id",
		coalesce("s"."availability"->>'timeZone', "m"."time_zone") AS "zone"
	FROM "members" "m"
	LEFT JOIN "availability_schedules" "s"
		ON "s"."workspace_id" = "m"."workspace_id" AND "s"."member_id" = "m"."id" AND "s"."is_default"
	WHERE "m"."role" = 'owner' AND "m"."status" = 'active'
	ORDER BY "m"."workspace_id", "m"."created_at", "m"."id"
), "chosen" AS (
	SELECT "w"."id", coalesce("p"."zone", "o"."zone") AS "zone"
	FROM "workspaces" "w"
	LEFT JOIN "page_pick" "p" ON "p"."workspace_id" = "w"."id"
	LEFT JOIN "owner_pick" "o" ON "o"."workspace_id" = "w"."id"
		AND "o"."zone" NOT IN ('UTC', 'Etc/UTC')
		AND EXISTS (SELECT 1 FROM pg_timezone_names "n" WHERE "n"."name" = "o"."zone")
	WHERE "w"."time_zone" = 'UTC'
)
UPDATE "workspaces" "w"
SET "time_zone" = "chosen"."zone"
FROM "chosen"
WHERE "w"."id" = "chosen"."id" AND "chosen"."zone" IS NOT NULL AND "w"."time_zone" = 'UTC';
