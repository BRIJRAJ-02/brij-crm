-- Two lookups calendar sync makes (spec 0024, milestones 2 and 3): the booking a meeting is for, when the host deletes
-- its event (the sync cancels it, and lets go of a meeting that is gone), and every meeting listing an address no one
-- in the CRM holds, for Add as person. Both partial, so they stay small. drizzle-kit's; the header and the lock
-- timeout are hand written. Building them briefly blocks writes to the two tables: give up after 5 seconds rather
-- than queue behind traffic, like 0039 and 0044.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE INDEX "bookings_by_meeting" ON "bookings" USING btree ("workspace_id","meeting_id") WHERE "bookings"."meeting_id" is not null;--> statement-breakpoint
CREATE INDEX "meeting_attendees_unknown" ON "meeting_attendees" USING btree ("workspace_id","email") WHERE "meeting_attendees"."match" = 'unknown';
