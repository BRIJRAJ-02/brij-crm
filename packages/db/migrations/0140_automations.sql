-- Automations (parity #53): "when X, if Y, do Z". Three things at once, because they only work together:
--
-- 1. `automations` (the definition, whole, as jsonb the contracts' schema checked) and `automation_runs` (the queue, the
--    idempotency key and the log in one: a `queued` row per matching automation and event, unique per automation,
--    subject and event; the `crm_automation` task claims it, runs the actions as the member the automation runs as,
--    and records how it ended). Both are tenant tables under forced row level security with the plain policy. A run's
--    subject is a record or a task by id alone, so no purge ever waits on the log.
-- 2. Notices: `notification_kind` gains `automation` and `notifications` three nullable columns (the automation, its
--    run, the task for a task due notice) with the subject check widened. One notice per member per run. The new enum
--    value is not used in this transaction (the check compares `kind::text`), so it runs inside it.
-- 3. Two narrow functions. `crm_enqueue_automation()` (owned by crm_queue, executable by crm_app) queues the
--    workspace's `crm_automation` task, keyed per workspace and held 2 seconds so a burst is one job: the caller
--    chooses no task, payload or queue, the workspace is the transaction's own setting, and it reads no table.
--    `crm_automation_due_workspaces(after, max)` (owned by crm_sweep, executable by crm_worker alone) names, ids only,
--    the live workspaces holding an enabled task due automation, for the hourly sweep; crm_sweep reads four columns of
--    `automations` for it and nothing else.
--
-- `outbox_kind` gains `automations` (one row naming nothing when an automation or a run's outcome changes).
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'automation';
--> statement-breakpoint
ALTER TYPE "public"."outbox_kind" ADD VALUE IF NOT EXISTS 'automations';
--> statement-breakpoint
CREATE TABLE "automations" (
  "workspace_id" uuid NOT NULL,
  "id" uuid DEFAULT uuidv7() NOT NULL,
  "trigger_kind" text NOT NULL,
  "object_id" uuid,
  "attribute_id" uuid,
  "trigger" jsonb NOT NULL,
  "conditions" jsonb,
  "actions" jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "enabled_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "disabled_reason" text,
  "failures" smallint DEFAULT 0 NOT NULL,
  "last_run_at" timestamp (6) with time zone,
  "run_as_member_id" uuid NOT NULL,
  "created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "created_by_type" "actor_type" NOT NULL,
  "created_by_id" uuid,
  "created_by_member_id" uuid,
  "updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "updated_by_type" "actor_type" NOT NULL,
  "updated_by_id" uuid,
  "updated_by_member_id" uuid,
  "deleted_at" timestamp (6) with time zone,
  "deleted_by_type" "actor_type",
  "deleted_by_id" uuid,
  "deleted_by_member_id" uuid,
  CONSTRAINT "automations_pkey" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "automations_trigger_kind" CHECK ("trigger_kind" in ('record_created', 'field_changed', 'task_due')),
  CONSTRAINT "automations_trigger_shape" CHECK (("trigger_kind" = 'record_created' and "object_id" is not null and "attribute_id" is null)
        or ("trigger_kind" = 'field_changed' and "object_id" is not null and "attribute_id" is not null)
        or ("trigger_kind" = 'task_due' and "object_id" is null and "attribute_id" is null)),
  CONSTRAINT "automations_actions" CHECK (jsonb_typeof("actions") = 'array' and jsonb_array_length("actions") between 1 and 3),
  CONSTRAINT "automations_disabled_reason" CHECK ("disabled_reason" in ('FAILING', 'CREATOR_GONE')),
  CONSTRAINT "automations_on_has_no_reason" CHECK (not "enabled" or "disabled_reason" is null),
  CONSTRAINT "automations_failures" CHECK ("failures" >= 0),
  CONSTRAINT "automations_deleted" CHECK (("deleted_at" is null) = ("deleted_by_type" is null)),
  CONSTRAINT "automations_created_by_actor" CHECK (("created_by_type" is null and "created_by_id" is null and "created_by_member_id" is null)
      or ("created_by_type" = 'system' and "created_by_id" is null and "created_by_member_id" is null)
      or ("created_by_type" = 'member' and "created_by_id" is not null and "created_by_member_id" = "created_by_id")
      or ("created_by_type"::text not in ('member', 'system', 'calendar') and "created_by_id" is not null and "created_by_member_id" is null)),
  CONSTRAINT "automations_updated_by_actor" CHECK (("updated_by_type" is null and "updated_by_id" is null and "updated_by_member_id" is null)
      or ("updated_by_type" = 'system' and "updated_by_id" is null and "updated_by_member_id" is null)
      or ("updated_by_type" = 'member' and "updated_by_id" is not null and "updated_by_member_id" = "updated_by_id")
      or ("updated_by_type"::text not in ('member', 'system', 'calendar') and "updated_by_id" is not null and "updated_by_member_id" is null)),
  CONSTRAINT "automations_deleted_by_actor" CHECK (("deleted_by_type" is null and "deleted_by_id" is null and "deleted_by_member_id" is null)
      or ("deleted_by_type" = 'system' and "deleted_by_id" is null and "deleted_by_member_id" is null)
      or ("deleted_by_type" = 'member' and "deleted_by_id" is not null and "deleted_by_member_id" = "deleted_by_id")
      or ("deleted_by_type"::text not in ('member', 'system', 'calendar') and "deleted_by_id" is not null and "deleted_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_run_as" FOREIGN KEY ("workspace_id","run_as_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_deleted_by" FOREIGN KEY ("workspace_id","deleted_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automations_hook" ON "automations" USING btree ("workspace_id","object_id","trigger_kind") WHERE "automations"."enabled" and "automations"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "automations_due" ON "automations" USING btree ("workspace_id") WHERE "automations"."enabled" and "automations"."deleted_at" is null and "automations"."trigger_kind" = 'task_due';--> statement-breakpoint
CREATE INDEX "automations_list" ON "automations" USING btree ("workspace_id","created_at","id") WHERE "automations"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "automations_trashed" ON "automations" USING btree ("workspace_id","deleted_at") WHERE "automations"."deleted_at" is not null;--> statement-breakpoint
ALTER TABLE "automations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "automations_tenant" ON "automations"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
  "workspace_id" uuid NOT NULL,
  "id" uuid DEFAULT uuidv7() NOT NULL,
  "automation_id" uuid NOT NULL,
  "subject_kind" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "object_id" uuid,
  "event_key" text NOT NULL,
  "version_id" uuid,
  "status" text DEFAULT 'queued' NOT NULL,
  "code" text,
  "created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "claimed_at" timestamp (6) with time zone,
  "finished_at" timestamp (6) with time zone,
  CONSTRAINT "automation_runs_pkey" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "automation_runs_subject_kind" CHECK ("subject_kind" in ('record', 'task')),
  CONSTRAINT "automation_runs_status" CHECK ("status" in ('queued', 'running', 'done', 'failed', 'skipped')),
  CONSTRAINT "automation_runs_event_key" CHECK (char_length("event_key") between 1 and 80),
  CONSTRAINT "automation_runs_code" CHECK (char_length("code") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation" FOREIGN KEY ("workspace_id","automation_id") REFERENCES "public"."automations"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_once" ON "automation_runs" USING btree ("workspace_id","automation_id","subject_id","event_key");--> statement-breakpoint
CREATE INDEX "automation_runs_queue" ON "automation_runs" USING btree ("workspace_id","created_at","id") WHERE "automation_runs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "automation_runs_running" ON "automation_runs" USING btree ("workspace_id","claimed_at") WHERE "automation_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "automation_runs_log" ON "automation_runs" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id") WHERE "automation_runs"."status" <> 'skipped';--> statement-breakpoint
CREATE INDEX "automation_runs_claimed" ON "automation_runs" USING btree ("workspace_id","claimed_at") WHERE "automation_runs"."claimed_at" is not null;--> statement-breakpoint
CREATE INDEX "automation_runs_by_age" ON "automation_runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_runs_by_automation" ON "automation_runs" USING btree ("workspace_id","automation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automation_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "automation_runs_tenant" ON "automation_runs"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "automation_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "automation_run_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "due_task_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_automation" FOREIGN KEY ("workspace_id","automation_id") REFERENCES "public"."automations"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_due_task" FOREIGN KEY ("workspace_id","due_task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_one_per_automation_run" ON "notifications" USING btree ("workspace_id","member_id","automation_run_id") WHERE "notifications"."automation_run_id" is not null;--> statement-breakpoint
CREATE INDEX "notifications_by_automation" ON "notifications" USING btree ("workspace_id","automation_id") WHERE "notifications"."automation_id" is not null;--> statement-breakpoint
CREATE INDEX "notifications_by_due_task" ON "notifications" USING btree ("workspace_id","due_task_id") WHERE "notifications"."due_task_id" is not null;
--> statement-breakpoint

-- Queues the workspace's automation task: task crm_automation, payload the workspace id alone, run 2 seconds from now,
-- job key crm-automation:<workspace> with job_key_mode 'preserve_run_at', so a burst of writes is one waiting row that
-- keeps its first time, and 5 attempts. The workspace is the transaction's own setting (row level security's), so the
-- caller can queue no one else's. Answers whether it queued.
create function crm_enqueue_automation()
  returns boolean
  language sql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
as $function$
  with ws as (
    select nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid as id
  ),
  added as materialized (
    select graphile_worker.add_job(
      identifier => 'crm_automation',
      payload => pg_catalog.json_build_object('workspaceId', ws.id),
      run_at => pg_catalog.now() + interval '2 seconds',
      max_attempts => 5,
      job_key => 'crm-automation:' || ws.id::text,
      job_key_mode => 'preserve_run_at'
    ) as queued
    from ws
    where ws.id is not null
  )
  select count(*) = 1 from added;
$function$;
--> statement-breakpoint
revoke all on function crm_enqueue_automation() from public;
--> statement-breakpoint
grant execute on function crm_enqueue_automation() to crm_app;
--> statement-breakpoint
grant crm_queue to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_queue;
--> statement-breakpoint
alter function crm_enqueue_automation() owner to crm_queue;
--> statement-breakpoint
revoke create on schema public from crm_queue;
--> statement-breakpoint
revoke crm_queue from current_user;
--> statement-breakpoint

-- The hourly sweep's read (the worker's `crm_cron_automation_due`): the live workspaces with an enabled task due
-- automation, after `after`, in id order, at most `max` (clamped to 1 to 500). Ids only. It reaches across workspaces,
-- so it is the worker's alone (crm_worker), owned by crm_sweep like crm_workspace_ids, with select on just the four
-- columns of `automations` it reads.
grant select (workspace_id, trigger_kind, enabled, deleted_at) on automations to crm_sweep;
--> statement-breakpoint
create function crm_automation_due_workspaces(after uuid, max integer)
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 500
begin atomic
  select w.id
  from public.workspaces w
  where w.deleted_at is null
    and w.id > coalesce(crm_automation_due_workspaces.after, '00000000-0000-0000-0000-000000000000'::uuid)
    and exists (
      select 1 from public.automations a
      where a.workspace_id = w.id and a.enabled and a.deleted_at is null and a.trigger_kind = 'task_due'
    )
  order by w.id
  limit least(greatest(crm_automation_due_workspaces.max, 1), 500);
end;
--> statement-breakpoint
revoke all on function crm_automation_due_workspaces(uuid, integer) from public;
--> statement-breakpoint
grant execute on function crm_automation_due_workspaces(uuid, integer) to crm_worker;
--> statement-breakpoint
grant crm_sweep to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_sweep;
--> statement-breakpoint
alter function crm_automation_due_workspaces(uuid, integer) owner to crm_sweep;
--> statement-breakpoint
revoke create on schema public from crm_sweep;
--> statement-breakpoint
revoke crm_sweep from current_user;
