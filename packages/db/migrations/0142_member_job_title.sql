-- The Team day (spec 0030, as spec 0037 amends it, job J12).
--
-- A member's job title (Amends 0031, AC-1441; the Team day orders its columns by it, AC-1438): a label of 1 to 60
-- characters shown under the name, set by the member in Account › Profile. Never read by any access check. Nullable,
-- with no default: adding it rewrites nothing and holds the lock only for the catalog change.
--
-- bookings_needs_host: the bookings flagged "Needs a host" (spec 0029, AC-749) by start, for the Team day's lane
-- (AC-1435). A host who left the workspace is no column, so the lane finds those bookings by the flag; few bookings
-- ever carry it, so the partial index stays tiny. Built plainly (not concurrently: migrations run in a transaction),
-- which on a table this size is a moment.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_job_title" CHECK (char_length("members"."job_title") between 1 and 60);--> statement-breakpoint
CREATE INDEX "bookings_needs_host" ON "bookings" USING btree ("workspace_id","starts_at") WHERE "bookings"."needs_host_at" is not null;
