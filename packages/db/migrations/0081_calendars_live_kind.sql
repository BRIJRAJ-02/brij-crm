-- A member's own calendar connections and calendars go live across their tabs (polish lane, 22 Oct 2026):
-- `outbox_kind` gains `calendars`, whose row names the members whose connections or calendars a write changed.
-- Enum values are only ever added, and nothing in this migration uses it, so it runs inside its transaction.
ALTER TYPE "public"."outbox_kind" ADD VALUE 'calendars';
