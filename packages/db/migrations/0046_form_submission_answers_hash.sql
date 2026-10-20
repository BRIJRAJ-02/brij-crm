-- The spam checker's repeats (spec 0023 follow-up): a keyed hash of each submission's answers, and an index that
-- counts the same answers on one form in the last day without reading the answers themselves.
ALTER TABLE "form_submissions" ADD COLUMN "answers_hash" text;--> statement-breakpoint
CREATE INDEX "form_submissions_repeats" ON "form_submissions" USING btree ("workspace_id","form_id","answers_hash","received_at") WHERE "form_submissions"."answers_hash" is not null;
