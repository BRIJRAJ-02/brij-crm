-- A booking page made from New booking page starts as a draft (the bookings area, 4 November 2026): paused, with
-- `paused_reason = 'draft'`, so guests can't book it until its first Publish sets it live, which clears the reason
-- as any status a person sets does. Nothing else reads the reason as a pause the host chose.
ALTER TABLE "booking_pages" DROP CONSTRAINT "booking_pages_paused_reason";--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_paused_reason" CHECK ("booking_pages"."paused_reason" is null or "booking_pages"."paused_reason" in ('host_removed', 'draft'));
