-- Booking flow rules (spec 0062, L1, 2 November 2026).
--
-- NUMBERING: generated as 0157 because main ends at 0156. Three other unlanded branches also hold 0157, and the
-- agreed landing order (wip/crm-ui-car, car/visual, the 0037 car3 stack) puts this one last, so renumber it and
-- restamp its journal `when` immediately before it lands. Renumbering earlier only trades one red journal check
-- for another, since the check wants the entries contiguous after main's last at the moment of landing.
--
-- What changes, all on `public.booking_pages`, all additive with defaults that are exactly today's behaviour, so
-- nothing is backfilled and a page nobody edits behaves as it did (AC-6220):
-- * `after_booking` ('confirmation' or 'redirect') and `redirect_url`: what the page does once a booking commits.
--   The two are paired by a check, because a redirect page with no address would strand every visitor.
-- * `send_booking_details`: whether that redirect carries name, email, start, tz and page as query values. Off by
--   default: it puts the visitor's name and address into the host's own server logs.
-- * `cancel_cutoff_minutes` and `move_cutoff_minutes`: how long before the start a guest may no longer change the
--   booking, 0 to 20160 (14 days). 0, the default, is what every page did before. The host's own cancel and move
--   ignore them, so these never block the people who own the page.
--
-- Postgres 17 compatible: no 18 only built ins.
set local lock_timeout = '5s';
--> statement-breakpoint
alter table "public"."booking_pages"
  add column "after_booking" text not null default 'confirmation',
  add column "redirect_url" text,
  add column "send_booking_details" boolean not null default false,
  add column "cancel_cutoff_minutes" integer not null default 0,
  add column "move_cutoff_minutes" integer not null default 0;
--> statement-breakpoint
alter table "public"."booking_pages"
  add constraint "booking_pages_after" check ("after_booking" in ('confirmation', 'redirect'));
--> statement-breakpoint
alter table "public"."booking_pages"
  add constraint "booking_pages_redirect" check (
    ("after_booking" = 'redirect') = ("redirect_url" is not null)
    and ("redirect_url" is null or char_length("redirect_url") <= 2048)
  );
--> statement-breakpoint
alter table "public"."booking_pages"
  add constraint "booking_pages_cutoffs" check (
    "cancel_cutoff_minutes" between 0 and 20160 and "move_cutoff_minutes" between 0 and 20160
  );
