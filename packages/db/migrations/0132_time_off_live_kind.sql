-- Time off goes live across tabs (spec 0037 follow ups, 30 Oct 2026): `outbox_kind` gains `time_off`, one row per
-- write that added, changed or removed someone's time off, naming nothing, so the Team week, the time off lists and
-- Bookings' Host away flags read again. Enum values are only ever added, and nothing in this migration uses it, so it
-- runs inside its transaction.
ALTER TYPE "public"."outbox_kind" ADD VALUE 'time_off';
