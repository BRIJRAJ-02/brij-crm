-- A far end numbers each new link after its last one, so a record linked from
-- more than 32,767 others ran out of smallint positions. Both positions widen
-- to integer in one statement, so record_links (and its indexes) is rewritten
-- once, under an ACCESS EXCLUSIVE lock for the length of the rewrite. It gives up
-- after 5 seconds rather than queue behind traffic (and stall everything queued
-- behind it), like 0009 and 0011.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "record_links" ALTER COLUMN "position" SET DATA TYPE integer, ALTER COLUMN "to_position" SET DATA TYPE integer;
