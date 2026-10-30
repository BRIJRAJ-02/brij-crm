-- Time off (spec 0037, AC-1281 to AC-1288): a member's whole days away, stored on `booking_time_blocks` as kind
-- `away`, so the slot engine (which reads every kind but `hold` as busy) closes every page during it with no new
-- query. An away row is one span (`repeat = 'once'`) from the first day's midnight to the midnight after the last,
-- in the zone its dates were chosen in (`time_zone`, which the shape check now allows on a once row for `away` only),
-- with a reason, an optional note (never audited) and an optional stand in, a member of the same workspace other
-- than them. The 50 upcoming entries limit is counted in core under the member's host lock.
--
-- Checks and a foreign key briefly lock the table. Give up after 5 seconds rather than queue behind traffic.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "booking_time_blocks" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "booking_time_blocks" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "booking_time_blocks" ADD COLUMN "standin_member_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_time_blocks" DROP CONSTRAINT "booking_time_blocks_kind";--> statement-breakpoint
ALTER TABLE "booking_time_blocks" ADD CONSTRAINT "booking_time_blocks_kind" CHECK ("booking_time_blocks"."kind" in ('block', 'hold', 'away'));--> statement-breakpoint
ALTER TABLE "booking_time_blocks" DROP CONSTRAINT "booking_time_blocks_shape";--> statement-breakpoint
ALTER TABLE "booking_time_blocks" ADD CONSTRAINT "booking_time_blocks_shape" CHECK (("booking_time_blocks"."repeat" = 'once' and "booking_time_blocks"."during" is not null and not isempty("booking_time_blocks"."during") and lower_inc("booking_time_blocks"."during") and not upper_inc("booking_time_blocks"."during")
        and "booking_time_blocks"."weekday" is null and "booking_time_blocks"."start_minute" is null and "booking_time_blocks"."end_minute" is null and "booking_time_blocks"."from_date" is null
        and ("booking_time_blocks"."time_zone" is null) = ("booking_time_blocks"."kind" <> 'away'))
      or ("booking_time_blocks"."repeat" = 'weekly' and "booking_time_blocks"."kind" = 'block' and "booking_time_blocks"."during" is null and "booking_time_blocks"."weekday" between 0 and 6
        and "booking_time_blocks"."start_minute" >= 0 and "booking_time_blocks"."end_minute" > "booking_time_blocks"."start_minute" and "booking_time_blocks"."end_minute" <= 1440
        and "booking_time_blocks"."time_zone" is not null and "booking_time_blocks"."from_date" is not null));--> statement-breakpoint
ALTER TABLE "booking_time_blocks" ADD CONSTRAINT "booking_time_blocks_away" CHECK (("booking_time_blocks"."kind" = 'away' and "booking_time_blocks"."repeat" = 'once' and "booking_time_blocks"."label" is null
        and "booking_time_blocks"."reason" in ('vacation', 'sick', 'travel', 'holiday', 'other')
        and ("booking_time_blocks"."note" is null or char_length("booking_time_blocks"."note") between 1 and 200)
        and ("booking_time_blocks"."standin_member_id" is null or "booking_time_blocks"."standin_member_id" <> "booking_time_blocks"."member_id")
        and upper("booking_time_blocks"."during") - lower("booking_time_blocks"."during") <= interval '367 days')
      or ("booking_time_blocks"."kind" <> 'away' and "booking_time_blocks"."reason" is null and "booking_time_blocks"."note" is null and "booking_time_blocks"."standin_member_id" is null));--> statement-breakpoint
ALTER TABLE "booking_time_blocks" ADD CONSTRAINT "booking_time_blocks_standin" FOREIGN KEY ("workspace_id","standin_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;
