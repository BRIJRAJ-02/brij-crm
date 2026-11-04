-- Bookings go live across tabs (B-17, bookings QA, 4 Nov 2026): `outbox_kind` gains `bookings`, one row per write that
-- made, moved, cancelled or answered a booking, naming nothing, so an owner's open Bookings screen reads again without
-- leaving the page. Enum values are only ever added, and nothing in this migration uses it, so it runs inside its
-- transaction.
ALTER TYPE "public"."outbox_kind" ADD VALUE 'bookings';
