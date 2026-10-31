-- Someone changed a member's scheduling, in the member's inbox too (spec 0037, AC-1264, with spec 0038): one
-- `scheduling_changed` notification per scheduling notice email queued, naming only the person who made the changes
-- (`actor_member_id`). It names no other row: what changed is in the email and on Availability, which the member
-- always may open. It goes in the daily digest for a member who chose one; otherwise it is marked emailed when made,
-- since its own email already went.
--
-- Builds on 0140's check, every branch kept as it was (task_due, automation and the rest), with one branch added.
-- The new enum value can't be used in the transaction that adds it, so the check compares `kind::text`. Row level
-- security on `notifications` is unchanged: forced, with its plain workspace policy.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'scheduling_changed';
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_subject";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject" CHECK (
  ("kind"::text in ('task_assigned', 'task_due') and "task_id" is not null and "comment_id" is null
    and "note_id" is null and "submission_id" is null and "join_request_id" is null
    and "automation_id" is null)
  or ("kind"::text in ('mention', 'reply') and "comment_id" is not null and "thread_id" is not null
    and "record_id" is not null and "task_id" is null and "note_id" is null and "submission_id" is null
    and "join_request_id" is null and "automation_id" is null)
  or ("kind"::text = 'mention' and "note_id" is not null and "record_id" is not null
    and "comment_id" is null and "thread_id" is null and "task_id" is null and "submission_id" is null
    and "join_request_id" is null and "automation_id" is null)
  or ("kind"::text = 'form_submission' and "submission_id" is not null and "comment_id" is null
    and "thread_id" is null and "task_id" is null and "note_id" is null and "join_request_id" is null
    and "automation_id" is null)
  or ("kind"::text = 'join_request' and "join_request_id" is not null and "record_id" is null
    and "thread_id" is null and "comment_id" is null and "task_id" is null and "note_id" is null
    and "submission_id" is null and "automation_id" is null)
  or ("kind"::text = 'automation' and "automation_id" is not null and "automation_run_id" is not null
    and "thread_id" is null and "comment_id" is null and "task_id" is null and "note_id" is null
    and "submission_id" is null and "join_request_id" is null)
  or ("kind"::text = 'scheduling_changed' and "actor_member_id" is not null and "record_id" is null
    and "thread_id" is null and "comment_id" is null and "task_id" is null and "note_id" is null
    and "submission_id" is null and "join_request_id" is null and "automation_id" is null)
);
