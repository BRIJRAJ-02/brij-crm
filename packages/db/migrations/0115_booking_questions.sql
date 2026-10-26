-- Questions on a booking page, filed into the CRM (spec 0057, 26 October 2026). A page already had a `questions`
-- column, kept empty since milestone 1 for exactly this: it now holds spec 0023's question list, at most 20, which
-- the contracts' `BookingQuestions` checks on every write. The check here only holds its shape, a list of at most
-- 20, so a write that skipped the service can't store a page the public read would choke on.
--
-- `file_to_crm` is the page's "Add to the CRM" switch (AC-5708): on by default, which is what every page did before
-- (the visitor's person and company found or made), so no page changes behaviour and there is nothing to backfill.
--
-- A booking's answers go in its existing `answers` jsonb, under `questions`, beside the phone, note and guests it
-- already keeps there: no column changes on `bookings`.
--
-- Numbered 0114 rather than 0112 (taken twice on unmerged lanes); the landing renumbers it after main's last.
ALTER TABLE "booking_pages" ADD COLUMN "file_to_crm" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_questions" CHECK (jsonb_typeof("booking_pages"."questions") = 'array' and jsonb_array_length("booking_pages"."questions") <= 20);
