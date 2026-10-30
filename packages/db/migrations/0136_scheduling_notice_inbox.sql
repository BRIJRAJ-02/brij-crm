-- Someone changed a member's scheduling, in the member's inbox too (spec 0037, AC-1264, with spec 0038): one
-- `scheduling_changed` notification per scheduling notice email queued, naming only the person who made the changes
-- (`actor_member_id`). It names no other row: what changed is in the email and on Availability, which the member
-- always may open. It goes in the daily digest for a member who chose one; otherwise it is marked emailed when made,
-- since its own email already went.
--
-- Builds on 0131's check. The new enum value can't be used in the transaction that adds it, so the check compares
-- `kind::text`. Row level security on `notifications` is unchanged: forced, with its plain workspace policy.
alter type notification_kind add value if not exists 'scheduling_changed';
--> statement-breakpoint
alter table notifications drop constraint notifications_subject;
--> statement-breakpoint
alter table notifications add constraint notifications_subject check (
  (kind::text = 'task_assigned' and task_id is not null and comment_id is null and note_id is null
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
  or (kind::text = 'scheduling_changed' and actor_member_id is not null and record_id is null and thread_id is null
    and comment_id is null and task_id is null and note_id is null and submission_id is null
    and join_request_id is null)
);
