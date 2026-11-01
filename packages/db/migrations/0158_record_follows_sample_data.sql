-- Follow a record, and sample data (the follow-sample lane, 31 Oct 2026). PLACEHOLDER number: renumbered after
-- main's last migration when the lane lands.
--
-- `record_follows`: one row per member per record they follow. Made for them when they create a record, are put in
-- one of its member fields (its owner) or are given one of its tasks; they can unfollow. Its record's and its
-- member's foreign keys cascade: unlike the purge registry's dependents (spec 0022), a follow is made by every
-- member's create, holds nothing of the record and is worth nothing without it.
--
-- `notifications` gains `record_activity`: someone else changed a followed record's values, added a note or a
-- comment, or completed one of its tasks. One notice per follower per record per burst, its `activity` holding what
-- happened by id and count only (`{"fields": [<attribute ids>], "notes": n, "comments": n, "tasks": n}`), never a
-- value or any text; the inbox counts only the fields the reader may see, and shows the notice only while they may
-- read its record. In app only: it is marked emailed when made, and no digest lists it.
-- `notification_settings.follow_notices` is the member's switch for them (on by default).
--
-- `sample_data`: the records and tasks a workspace's "Add sample data" made, so "Remove sample data" takes exactly
-- those (and its Undo brings exactly those back: `removed_batch_id` is the remove's batch, the records' own
-- `deleted_batch_id`). Its record's foreign key restricts (the purge registry deletes it first); its task's cascades
-- with the daily cleanup's removal of a deleted task.
--
-- `notifications_subject` is rebuilt from 0143's, every branch kept as it was, with one added. The new enum value
-- can't be used in the transaction that adds it, so the checks compare `kind::text`. Both new tables are tenant
-- tables under forced row level security with the plain workspace policy.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'record_activity';
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "activity" jsonb;
--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "follow_notices" boolean DEFAULT true NOT NULL;
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
  or ("kind"::text = 'record_activity' and "record_id" is not null and "activity" is not null
    and "thread_id" is null and "comment_id" is null and "task_id" is null and "note_id" is null
    and "submission_id" is null and "join_request_id" is null and "automation_id" is null)
);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_activity" CHECK (
  "activity" is null or ("kind"::text = 'record_activity' and jsonb_typeof("activity") = 'object')
);--> statement-breakpoint
CREATE TABLE "record_follows" (
  "workspace_id" uuid NOT NULL,
  "record_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "record_follows_pkey" PRIMARY KEY("workspace_id","record_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "record_follows" ADD CONSTRAINT "record_follows_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_follows" ADD CONSTRAINT "record_follows_record" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_follows" ADD CONSTRAINT "record_follows_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The member's own follows (the member's cascade).
CREATE INDEX "record_follows_by_member" ON "record_follows" USING btree ("workspace_id","member_id");--> statement-breakpoint
ALTER TABLE "record_follows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_follows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "record_follows_tenant" ON "record_follows"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "sample_data" (
  "workspace_id" uuid NOT NULL,
  "id" uuid DEFAULT uuidv7() NOT NULL,
  "record_id" uuid,
  "task_id" uuid,
  "removed_batch_id" uuid,
  "created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sample_data_pkey" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "sample_data_subject" CHECK (num_nonnulls("record_id", "task_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "sample_data" ADD CONSTRAINT "sample_data_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_data" ADD CONSTRAINT "sample_data_record" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_data" ADD CONSTRAINT "sample_data_task" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sample_data_one_per_record" ON "sample_data" USING btree ("workspace_id","record_id") WHERE "sample_data"."record_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sample_data_one_per_task" ON "sample_data" USING btree ("workspace_id","task_id") WHERE "sample_data"."task_id" is not null;--> statement-breakpoint
ALTER TABLE "sample_data" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sample_data" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sample_data_tenant" ON "sample_data"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
