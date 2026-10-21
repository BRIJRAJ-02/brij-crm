-- Bulk changes as jobs (spec 0022, milestone 3): the job whose batch stored an outbox row, set by the outbox hook from
-- `Change.jobId` and never published (a `records` event carries only `fromJob`). drizzle-kit's, with this header and
-- the lock timeout hand written. Nullable with no default: a catalog change, so the outbox's lock is held only for
-- that; give up after 5 seconds rather than queue behind the relay, like 0020 and 0036. The grants need nothing new.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "job_id" uuid;
