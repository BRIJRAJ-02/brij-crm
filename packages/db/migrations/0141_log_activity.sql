-- Log activity (the CRM flow pass, 31 October 2026): a call or a meeting logged on a record is a note with a kind.
--
-- A note gains four columns, so a logged call keeps everything a note has (links to several records, mentions, the
-- access rule of its own record, the outbox row, the 30 day soft delete, the timeline source):
--   kind              'note' (every note until now), 'call' or 'meeting', for life.
--   occurred_at       when it happened: the timeline sorts on it, so a call logged for yesterday sits yesterday.
--                     A plain note keeps it equal to created_at (back-filled here, defaulted after, and the service never
--                     moves it), so nothing about notes moves.
--   duration_minutes  a call's or meeting's length, 1 to 1,440; never on a plain note.
--   outcome           a short fixed set per kind (calls: connected, no_answer, left_message; meetings: held,
--                     cancelled, no_show); never on a plain note. Text with a check, not a Postgres enum.
-- The timeline's own record index leads on the moment that happened (`notes_by_record_occurred`) in place of the
-- moment it was made (`notes_by_record_created`, dropped: no query reads it any more, and the new one serves the
-- purge registry's delete and the record foreign key's check as it did). Row level security stays forced.
set local lock_timeout = '5s';
--> statement-breakpoint
-- The notes table first, as 0136 locks before its copy: the back-fill below takes it, and a save waiting between the
-- column and the back-fill could deadlock the migration.
lock table notes in access exclusive mode;
--> statement-breakpoint
alter table notes add column kind text not null default 'note';
--> statement-breakpoint
alter table notes add column occurred_at timestamp (6) with time zone;
--> statement-breakpoint
alter table notes add column duration_minutes smallint;
--> statement-breakpoint
alter table notes add column outcome text;
--> statement-breakpoint
-- Every note happened when it was made, for every workspace at once: FORCE off for the copy and back on, in one block.
do $$
begin
  alter table notes no force row level security;
  update notes set occurred_at = created_at;
  alter table notes force row level security;
end
$$;
--> statement-breakpoint
alter table notes alter column occurred_at set not null;
--> statement-breakpoint
alter table notes alter column occurred_at set default now();
--> statement-breakpoint
alter table notes add constraint notes_kind check (kind in ('note', 'call', 'meeting'));
--> statement-breakpoint
alter table notes add constraint notes_duration check (
  duration_minutes is null or (kind <> 'note' and duration_minutes between 1 and 1440)
);
--> statement-breakpoint
alter table notes add constraint notes_outcome check (
  outcome is null
  or (kind = 'call' and outcome in ('connected', 'no_answer', 'left_message'))
  or (kind = 'meeting' and outcome in ('held', 'cancelled', 'no_show'))
);
--> statement-breakpoint
-- The moment a note is listed at (the Notes tab and page): a plain note's last edit, a call's or meeting's when it
-- happened. Stored, so the workspace's Notes page and a record's list sort and page on an index.
alter table notes add column listed_at timestamp (6) with time zone
  generated always as (case when kind = 'note' then updated_at else occurred_at end) stored;
--> statement-breakpoint
CREATE INDEX "notes_by_workspace_listed" ON "notes" USING btree ("workspace_id","listed_at" DESC NULLS LAST,"id") WHERE "notes"."deleted_at" is null;
--> statement-breakpoint
CREATE INDEX "notes_by_record_listed" ON "notes" USING btree ("workspace_id","record_id","listed_at" DESC NULLS LAST,"id");
--> statement-breakpoint
CREATE INDEX "notes_by_record_occurred" ON "notes" USING btree ("workspace_id","record_id","occurred_at" DESC NULLS LAST,"id");
--> statement-breakpoint
DROP INDEX "notes_by_record_created";
