-- A form's status goes live across tabs (forms fixes 3, 6 November 2026): `outbox_kind` gains `forms`, one row per
-- write that paused, resumed, archived or restored a form, or paused it by filling it (a send, Publish or a Settings
-- change), naming nothing, so an open editor and the Forms list read again. Enum values are only ever added, and
-- nothing in this migration uses it, so it runs inside its transaction.
ALTER TYPE "public"."outbox_kind" ADD VALUE 'forms';
