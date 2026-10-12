-- The refusal summary's index takes the item's position (spec 0008, milestone 2, the state and performance review):
-- each code's first 20 ids by position are then read in order from the index, rather than every refused item of a
-- million item job sorted to keep 20. Numbered 0031, leaving 0030 to the other lane; its journal `when` is the time
-- it was generated. job_items is empty in production (no kind runs there yet), so the rebuild waits on nothing.
DROP INDEX "job_items_refused";--> statement-breakpoint
CREATE INDEX "job_items_refused" ON "job_items" USING btree ("workspace_id","job_id","code","position") WHERE "job_items"."state" = 'refused';