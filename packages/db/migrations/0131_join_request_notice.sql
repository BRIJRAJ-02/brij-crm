-- A request to join tells the people who can approve it (flow pass, 30 October 2026): a `join_request`
-- notification for each active holder of `members.invite`, naming the request by id, never copying the person's
-- name or address. Before, only an email went, and nothing in the app said someone was waiting.
--
-- Builds on 0130's check (form submissions). The new enum value can't be used in the transaction that adds it, so the check compares `kind::text`. The
-- notification goes with its request (on delete cascade), one per member per request. Row level security on
-- `notifications` is unchanged: forced, with its plain workspace policy.
alter type notification_kind add value if not exists 'join_request';
--> statement-breakpoint
alter table notifications add column join_request_id uuid;
--> statement-breakpoint
alter table notifications add constraint notifications_join_request
  foreign key (workspace_id, join_request_id) references join_requests (workspace_id, id) on delete cascade;
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
);
--> statement-breakpoint
create unique index notifications_one_per_join_request on notifications (workspace_id, member_id, join_request_id)
  where join_request_id is not null;
--> statement-breakpoint
create index notifications_by_join_request on notifications (workspace_id, join_request_id)
  where join_request_id is not null;
