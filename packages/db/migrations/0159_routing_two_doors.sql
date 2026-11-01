-- Routing's two doors (spec 0037, lane L6): what happened beyond a rule, Only through a form, and the Decisions log.
--
-- `routing_decisions.steps` (AC-1358): the free time check at submit, in order (`RoutingStep`: a page with no free
-- time in 14 days, After someone sends it used instead, "someone will contact you", or not checked). Nullable with no
-- default, so adding it rewrites nothing (AC-1446).
--
-- `booking_pages.form_only` (AC-1388): a team page that books only with a form's hand off. Off by default, so no page
-- changes behaviour by itself; `booking_pages` is small, so the default costs nothing.
--
-- `routing_decisions_by_time`: Routing › Decisions (AC-1383), every surface's decisions newest first, keyset paged on
-- (decided_at, id). The report keeps `routing_decisions_by_surface`.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "routing_decisions" ADD COLUMN "steps" jsonb;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "form_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "routing_decisions_by_time" ON "routing_decisions" USING btree ("workspace_id","decided_at" DESC NULLS LAST,"id" DESC NULLS LAST);
