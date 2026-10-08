-- A record revision and the replaced versions an event names (spec 0006, milestone 1, AC-44 and AC-46). drizzle-kit's,
-- with this header and the lock timeout hand written.
--
-- Both are catalog changes only: a column with a constant default rewrites nothing, and a nullable column needs no
-- default. Each waits for its table's lock, which every write takes: give up after 5 seconds rather than queue behind
-- traffic, like 0020 and 0023. The grants need nothing new: crm_app's update on records and its insert and select on
-- the outbox cover new columns, and crm_app still can't update anything on the outbox but published_at.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "replaced" jsonb;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "revision" bigint DEFAULT 0 NOT NULL;
