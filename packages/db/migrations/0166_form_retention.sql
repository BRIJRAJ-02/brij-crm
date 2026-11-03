-- How long a workspace keeps its form submissions (spec 0023, AC-1054): Settings › Workspace › General's Keep
-- submissions. Null keeps them forever, as every workspace did before; 12 or 24 has the daily cleanup's `submissions`
-- phase delete those older, with their raw answers, never the records they made. Spam goes after 30 days whatever the
-- setting, by a rule in the cleanup, not a column. One nullable column with no default, so the change rewrites no row.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "keep_submissions_months" smallint;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_keep_submissions" CHECK ("workspaces"."keep_submissions_months" is null or "workspaces"."keep_submissions_months" in (12, 24));--> statement-breakpoint
-- The cleanup's walks, each a range up to one cutoff: a workspace's submissions by when they arrived (its retention),
-- and its spam alone (spam's 30 days, whatever it keeps), so a workspace that keeps everything never reads the rest.
CREATE INDEX "form_submissions_by_received" ON "form_submissions" USING btree ("workspace_id","received_at","id");--> statement-breakpoint
CREATE INDEX "form_submissions_spam" ON "form_submissions" USING btree ("workspace_id","received_at","id") WHERE "form_submissions"."state" = 'spam';
