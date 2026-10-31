-- Activity and collaboration (the CRM flow pass, 31 October 2026), three changes in one migration:
--
-- 1. A task's description: plain text up to 5,000 characters, '' for none, beside its title.
--
-- 2. A `task_due` notification: the daily cleanup tells each active assignee of an open task once, on the day it is
--    due, naming the task by id. A member still holds one notification per task (`notifications_one_per_task`, kept
--    as it is, so the running code's `on conflict` target stays valid while this deploys): on the due day their
--    assignment notice turns into the due one, back at the top as unread. The new enum value can't be used in the
--    transaction that adds it, so the check compares `kind::text`, as 0130 and 0131 do.
--
-- 3. A note linked to several records (`note_records`), as a task links them: at most 20, in order, the note's own
--    record (`notes.record_id`, which still decides who may see and change it) first at position 0, back-filled for
--    every note here with the note's own moment and maker, so a record's timeline reads the same. A link's foreign
--    key to its record has no `on delete` action, so a record removed for good while a note still links it fails
--    unless the purge registry deleted the links first; a note removed by the cleanup takes its links (cascade).
--    Row level security is forced, with the plain workspace policy, and every index leads with workspace_id.
set local lock_timeout = '5s';
--> statement-breakpoint
-- The notes table first, as 0011 locks before its copy: the link table's key to it and the back-fill below take it,
-- and a save waiting between them could deadlock the migration.
lock table notes in access exclusive mode;
--> statement-breakpoint
alter table tasks add column description text not null default '';
--> statement-breakpoint
alter table tasks add constraint tasks_description check (char_length(description) <= 5000);
--> statement-breakpoint
alter type notification_kind add value if not exists 'task_due';
--> statement-breakpoint
alter table notifications drop constraint notifications_subject;
--> statement-breakpoint
alter table notifications add constraint notifications_subject check (
  (kind::text in ('task_assigned', 'task_due') and task_id is not null and comment_id is null and note_id is null
    and submission_id is null and join_request_id is null)
  or (kind::text in ('mention', 'reply') and comment_id is not null and thread_id is not null
    and record_id is not null and task_id is null and note_id is null and submission_id is null
    and join_request_id is null)
  or (kind::text = 'mention' and note_id is not null and record_id is not null
    and comment_id is null and thread_id is null and task_id is null and submission_id is null
    and join_request_id is null)
  or (kind::text = 'form_submission' and submission_id is not null
    and comment_id is null and thread_id is null and task_id is null and note_id is null
    and join_request_id is null)
  or (kind::text = 'join_request' and join_request_id is not null and record_id is null and thread_id is null
    and comment_id is null and task_id is null and note_id is null and submission_id is null)
);
--> statement-breakpoint
CREATE TABLE "note_records" (
	"workspace_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	CONSTRAINT "note_records_pkey" PRIMARY KEY("workspace_id","note_id","record_id"),
	CONSTRAINT "note_records_position" CHECK ("note_records"."position" >= 0),
	CONSTRAINT "note_records_created_by_actor" CHECK (("note_records"."created_by_type" is null and "note_records"."created_by_id" is null and "note_records"."created_by_member_id" is null)
      or ("note_records"."created_by_type" = 'system' and "note_records"."created_by_id" is null and "note_records"."created_by_member_id" is null)
      or ("note_records"."created_by_type" = 'member' and "note_records"."created_by_id" is not null and "note_records"."created_by_member_id" = "note_records"."created_by_id")
      or ("note_records"."created_by_type"::text not in ('member', 'system', 'calendar') and "note_records"."created_by_id" is not null and "note_records"."created_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "note_records" ADD CONSTRAINT "note_records_note" FOREIGN KEY ("workspace_id","note_id") REFERENCES "public"."notes"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "note_records" ADD CONSTRAINT "note_records_record" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "note_records" ADD CONSTRAINT "note_records_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- A record's Notes tab and timeline, the purge registry's delete and the foreign key's check.
CREATE INDEX "note_records_by_record" ON "note_records" USING btree ("workspace_id","record_id","created_at" DESC NULLS LAST,"note_id");
--> statement-breakpoint
-- Every note's own record as its first link, at the moment it was made and by whoever made it, for every workspace
-- at once, as 0011 filled the sort keys: under the lock taken first, FORCE off for the copy and back on, in one block.
do $$
begin
  alter table notes no force row level security;
  insert into note_records (workspace_id, note_id, record_id, position, created_at, created_by_type, created_by_id,
    created_by_member_id)
  select n.workspace_id, n.id, n.record_id, 0, n.created_at, n.created_by_type, n.created_by_id, n.created_by_member_id
  from notes n
  on conflict do nothing;
  alter table notes force row level security;
end
$$;
--> statement-breakpoint
alter table note_records enable row level security;
--> statement-breakpoint
alter table note_records force row level security;
--> statement-breakpoint
create policy note_records_tenant on note_records
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
