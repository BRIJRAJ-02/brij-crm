-- A person's name is required (owner decision, 8 Oct 2026): workspaces made before the template said so get it
-- too, so clearing a name is refused everywhere. Hand written: data only, no schema change.
--
-- One update of the People objects' primary attributes, run as the owner (BYPASSRLS), across every workspace.
-- Records that already have no name keep it (a required attribute is checked on writes, never on rows at rest);
-- the table shows them as "Unnamed person". It waits for the attributes' lock, which only schema changes take:
-- give up after 5 seconds rather than queue, like 0020 and 0023.
set local lock_timeout = '5s';
--> statement-breakpoint
UPDATE "attributes" AS "a"
SET "is_required" = true
FROM "objects" AS "o"
WHERE "o"."workspace_id" = "a"."workspace_id"
  AND "o"."primary_attribute_id" = "a"."id"
  AND "o"."standard_key" = 'people'
  AND "a"."is_required" = false;
