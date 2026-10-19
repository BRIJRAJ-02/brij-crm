-- A one off block's ends beside its range (spec 0027): under forced row level security only leakproof operators reach
-- an index, and range overlap (`&&`) isn't one, so the slots read compares `starts_at` and `ends_at` instead, on a
-- btree. A database that ran 0042 before its GiST index was dropped from it loses that index here.
drop index if exists booking_time_blocks_once;
--> statement-breakpoint
ALTER TABLE "booking_time_blocks" ADD COLUMN "starts_at" timestamp (6) with time zone GENERATED ALWAYS AS (lower(during)) STORED;--> statement-breakpoint
ALTER TABLE "booking_time_blocks" ADD COLUMN "ends_at" timestamp (6) with time zone GENERATED ALWAYS AS (upper(during)) STORED;--> statement-breakpoint
CREATE INDEX "booking_time_blocks_once" ON "booking_time_blocks" USING btree ("workspace_id","member_id","ends_at") WHERE "booking_time_blocks"."repeat" = 'once';