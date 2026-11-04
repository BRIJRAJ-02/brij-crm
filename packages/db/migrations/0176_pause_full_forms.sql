-- Forms already full pause now (forms fixes 3, 6 November 2026). Since forms fixes 2 the send that takes a form's
-- last place pauses it, and nothing else counts answers; a form that was at or over its number of answers before
-- that shipped stayed open until its next send. Each live form whose live version closes after N answers and holds at
-- least N that aren't spam or deleted is paused, as Pause does. Each count reads at most N rows, through
-- `form_submissions_live`. Idempotent: a paused form is never touched again, and a rerun finds the same forms.
-- Row security off: the owner bypasses it, and a role it would filter fails here rather than pausing nothing.
set local lock_timeout = '5s';
--> statement-breakpoint
set local row_security = off;
--> statement-breakpoint
UPDATE "forms" "f"
SET "status" = 'paused', "updated_at" = now()
FROM "form_versions" "v"
WHERE "v"."workspace_id" = "f"."workspace_id"
	AND "v"."id" = "f"."live_version_id"
	AND "f"."status" = 'live'
	AND jsonb_typeof("v"."document" -> 'closing' -> 'after') = 'number'
	AND ("v"."document" -> 'closing' ->> 'after')::numeric >= 1
	AND (
		SELECT count(*) FROM (
			SELECT 1 FROM "form_submissions" "s"
			WHERE "s"."workspace_id" = "f"."workspace_id"
				AND "s"."form_id" = "f"."id"
				AND "s"."state" <> 'spam'
				AND "s"."deleted_at" IS NULL
			LIMIT ("v"."document" -> 'closing' ->> 'after')::numeric::bigint
		) "kept"
	) >= ("v"."document" -> 'closing' ->> 'after')::numeric::bigint;
