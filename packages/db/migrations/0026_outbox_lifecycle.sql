-- The records a write created, deleted and restored, named on its records event (spec 0007, milestone 2; owner
-- decision pending, 12 Oct 2026), so a browser settles counts and windows on them instead of guessing a create from
-- the id. drizzle-kit's, with this header and the lock timeout hand written. Numbered 0026, leaving 0025 to the design
-- lane; its journal `when` is a day past generation, so it sorts after a 0025 generated meanwhile.
--
-- Catalog changes only: a column with a constant default rewrites nothing. Each waits for the outbox's lock, which
-- every write takes: give up after 5 seconds rather than queue behind traffic, like 0020, 0023 and 0024. The grants
-- need nothing new: crm_app's insert and select and crm_relay's select and delete are on the whole table, and crm_app
-- still can't update anything but published_at.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "created_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "deleted_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "restored_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;
