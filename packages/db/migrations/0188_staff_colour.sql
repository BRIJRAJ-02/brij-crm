-- A staff member's colour (spec 0066 B1; 4 November 2026): one of the nine hues the tags and dots use, so the shifts
-- grid and (B3) the calendar tell each person's blocks apart, as Fresha's team colours do. Null until chosen; the
-- screens then derive one from the id. Numbered 0188.
--
-- Expand only: a nullable column with a closed list check. No grant changes: `staff` already reaches crm_app.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "color" text;
--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_color" CHECK ("staff"."color" is null or "staff"."color" in ('gray', 'red', 'orange', 'yellow', 'lime', 'green', 'sky', 'blue', 'purple'));
