-- A form's new submission in its members' inboxes (spec 0023, AC-568, AC-1047, with spec 0038): one notification per
-- member told, naming the submission by id (never its answers), so it shows in the inbox beside mentions and tasks,
-- read through the access door when it is read (hidden means absent), and goes in the daily digest for a member who
-- chose one instead of an email each. It goes with its submission. The new kind is compared as text in the check:
-- a value added to an enum can't be used in the transaction that adds it.
alter type notification_kind add value if not exists 'form_submission';
--> statement-breakpoint
alter table notifications add column submission_id uuid;
--> statement-breakpoint
alter table notifications add constraint notifications_submission
  foreign key (workspace_id, submission_id) references form_submissions (workspace_id, id) on delete cascade;
--> statement-breakpoint
alter table notifications drop constraint notifications_subject;
--> statement-breakpoint
alter table notifications add constraint notifications_subject check (
  (kind::text = 'task_assigned' and task_id is not null and comment_id is null and note_id is null
    and submission_id is null)
  or (kind::text in ('mention', 'reply') and comment_id is not null and thread_id is not null
    and record_id is not null and task_id is null and note_id is null and submission_id is null)
  or (kind::text = 'mention' and note_id is not null and record_id is not null
    and comment_id is null and thread_id is null and task_id is null and submission_id is null)
  or (kind::text = 'form_submission' and submission_id is not null
    and comment_id is null and thread_id is null and task_id is null and note_id is null)
);
--> statement-breakpoint
create unique index notifications_one_per_submission on notifications (workspace_id, member_id, submission_id)
  where submission_id is not null;
--> statement-breakpoint
-- A submission's delete takes its notifications with it: found by this, not by a scan.
create index notifications_by_submission on notifications (workspace_id, submission_id) where submission_id is not null;
