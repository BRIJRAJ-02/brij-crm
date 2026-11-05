-- A guest's booking tells its host in their Inbox (bookings fix lane O, B-12, 4 November 2026): one `booking`
-- notification per host per booking, naming the booking (on delete cascade, so a purged booking takes its notice) and
-- the guest's person record when it was filed. Builds on 0162's check, every branch kept, one added; the new enum
-- value can't be used in the transaction that adds it, so the check compares `kind::text`. Row level security on
-- `notifications` is unchanged.
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'booking';
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "booking_id" uuid;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking" FOREIGN KEY ("workspace_id","booking_id") REFERENCES "public"."bookings"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_one_per_booking" ON "notifications" USING btree ("workspace_id","member_id","booking_id") WHERE "notifications"."booking_id" is not null;
--> statement-breakpoint
CREATE INDEX "notifications_by_booking" ON "notifications" USING btree ("workspace_id","booking_id") WHERE "notifications"."booking_id" is not null;
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
  or ("kind"::text = 'webhook_off' and "webhook_endpoint_id" is not null and "record_id" is null
    and "thread_id" is null and "comment_id" is null and "task_id" is null and "note_id" is null
    and "submission_id" is null and "join_request_id" is null and "automation_id" is null)
  or ("kind"::text = 'booking' and "booking_id" is not null
    and "thread_id" is null and "comment_id" is null and "task_id" is null and "note_id" is null
    and "submission_id" is null and "join_request_id" is null and "automation_id" is null
    and "webhook_endpoint_id" is null and "due_task_id" is null)
);
