-- Objects and attributes (spec 0012, milestone 1): an object's place in the workspace's order (the sidebar's), and
-- object names unique per workspace ignoring case, archived objects included, so two "Projects" never sit in the
-- sidebar and a restore never collides (AC-224, AC-225). `outbox.object_id` is already nullable (0023).
--
-- Run as the owner (BYPASSRLS), across every workspace. Only definition writes take the objects' lock: give up after
-- 5 seconds rather than queue, like 0020, 0023 and 0026.
set local lock_timeout = '5s';
--> statement-breakpoint
-- Stop before changing anything if a workspace holds two objects whose names match ignoring case (none expected:
-- only the template's objects and test objects exist). The message names each workspace, so they can be renamed.
DO $$
DECLARE
  clashes text;
BEGIN
  SELECT string_agg(DISTINCT workspace_id::text, ', ') INTO clashes
  FROM (
    SELECT workspace_id FROM objects GROUP BY workspace_id, lower(singular_name) HAVING count(*) > 1
    UNION ALL
    SELECT workspace_id FROM objects GROUP BY workspace_id, lower(plural_name) HAVING count(*) > 1
  ) AS dupes;
  IF clashes IS NOT NULL THEN
    RAISE EXCEPTION 'Objects share a name ignoring case in workspaces: %. Rename them, then migrate again.', clashes;
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "position" integer;--> statement-breakpoint
-- Each workspace's objects in the order they were made, from 0 (the template's order for the standard ones: the
-- order `listObjects` showed them in until now).
UPDATE "objects" AS "o"
SET "position" = "ordered"."position"
FROM (
  SELECT "workspace_id", "id",
    (row_number() OVER (PARTITION BY "workspace_id" ORDER BY "created_at", "id") - 1)::integer AS "position"
  FROM "objects"
) AS "ordered"
WHERE "ordered"."workspace_id" = "o"."workspace_id" AND "ordered"."id" = "o"."id";--> statement-breakpoint
ALTER TABLE "objects" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "objects_singular_name" ON "objects" USING btree ("workspace_id",lower("singular_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "objects_plural_name" ON "objects" USING btree ("workspace_id",lower("plural_name"));--> statement-breakpoint
CREATE INDEX "objects_by_position" ON "objects" USING btree ("workspace_id","position");
