-- One routing decision per form submission, and one per team page booking (spec 0043, AC-1607, AC-1611). A
-- submission is routed once, in its own transaction, and a retry answers the decision already stored; these unique
-- indexes make the database hold to that too, so a retried or doubled submit can never decide twice, nor count twice
-- in a rule's report. The submission's index replaces the plain one a hand off's booking finds its decision by.
--
-- Hand written first: rows already doubled (none are expected, since a submit's idempotency key stops a second
-- submission) keep the first decision, preferring one a booking followed, so the unique indexes can be built.
-- Migrations run as the owner, past row level security, so this reaches every workspace; each match stays inside
-- one workspace by its own `workspace_id` comparison.
delete from routing_decisions d
using routing_decisions keep
where d.submission_id is not null
  and keep.workspace_id = d.workspace_id
  and keep.submission_id = d.submission_id
  and ((keep.booking_id is null)::int, keep.decided_at, keep.id) < ((d.booking_id is null)::int, d.decided_at, d.id);
--> statement-breakpoint
delete from routing_decisions d
using routing_decisions keep
where d.surface_kind = 'booking_page'
  and keep.surface_kind = 'booking_page'
  and keep.workspace_id = d.workspace_id
  and keep.booking_id = d.booking_id
  and (keep.decided_at, keep.id) < (d.decided_at, d.id);
--> statement-breakpoint
-- drizzle-kit's from here.
DROP INDEX "routing_decisions_by_submission";--> statement-breakpoint
CREATE UNIQUE INDEX "routing_decisions_one_per_submission" ON "routing_decisions" USING btree ("workspace_id","submission_id") WHERE "routing_decisions"."submission_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "routing_decisions_one_per_booking" ON "routing_decisions" USING btree ("workspace_id","booking_id") WHERE "routing_decisions"."surface_kind" = 'booking_page';
