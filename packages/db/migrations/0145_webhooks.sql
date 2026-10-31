-- Outgoing webhooks (spec 0064, slice 3, placeholder `0xxc`: numbered after main's last, 0144; renumber at the landing).
-- `webhook_endpoints`, a workspace's endpoints with their sealed signing secrets, and `webhook_deliveries`, one row per
-- event and endpoint, written in the transaction of the write the event describes (AC-6422), unique on (endpoint,
-- event) so an event is queued for an endpoint once. Both are tenant tables: forced row level security and the
-- standard policy.
--
-- crm_enqueue_webhook_delivery(delivery) puts one delivery on Graphile Worker's queue, as crm_enqueue_email does,
-- owned by the same crm_queue: it reads the delivery under the caller's workspace setting (row level security still
-- applies) and only one still owed a try (`pending` or `failed`). It builds the queue row itself: task
-- crm_webhook_deliver, payload the workspace and delivery ids only, run at the delivery's `next_attempt_at` (now when
-- unset), one queue per endpoint (`webhook:<workspace>:<endpoint>`, so a slow or dead receiver holds one of the light
-- lane's slots at most and never another endpoint's), priority 6 (after a workspace's emails), keyed by the delivery
-- with `replace`, so the next try queued from inside the running one takes over its key. 3 queue attempts: the
-- backoff of AC-6423 is the delivery's own, and these only cover a worker that died mid send.
--
-- crm_webhook_form_handles(form) answers the handles of the link pages in the caller's workspace that carry a live
-- block of that form, for `link_page.signup` (AC-6426): handles only, owned by crm_handle like every read of the link
-- page tables, which crm_app holds no grant on.
CREATE TABLE "webhook_endpoints" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"url" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"events" text[] NOT NULL,
	"secret_sealed" bytea NOT NULL,
	"secret_hint" text NOT NULL,
	"previous_secret_sealed" bytea,
	"previous_secret_until" timestamp (6) with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"off_reason" text,
	"failing_since" timestamp (6) with time zone,
	"created_by_member_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "webhook_endpoints_status" CHECK ("webhook_endpoints"."status" in ('active', 'off')),
	CONSTRAINT "webhook_endpoints_off" CHECK (("webhook_endpoints"."status" = 'off') = ("webhook_endpoints"."off_reason" is not null) and "webhook_endpoints"."off_reason" in ('turned_off', 'failing')),
	CONSTRAINT "webhook_endpoints_url" CHECK ("webhook_endpoints"."url" like 'https://%' and length("webhook_endpoints"."url") <= 2048),
	CONSTRAINT "webhook_endpoints_description" CHECK (length("webhook_endpoints"."description") <= 120),
	CONSTRAINT "webhook_endpoints_events" CHECK (cardinality("webhook_endpoints"."events") between 1 and 6),
	CONSTRAINT "webhook_endpoints_previous" CHECK (("webhook_endpoints"."previous_secret_sealed" is null) = ("webhook_endpoints"."previous_secret_until" is null))
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt" smallint DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"response_status" smallint,
	"response_ms" integer,
	"response_excerpt" text,
	"failure" text,
	"next_attempt_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp (6) with time zone,
	CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "webhook_deliveries_state" CHECK ("webhook_deliveries"."state" in ('pending', 'sent', 'failed', 'gave_up')),
	CONSTRAINT "webhook_deliveries_payload" CHECK (pg_column_size("webhook_deliveries"."payload") <= 131072),
	CONSTRAINT "webhook_deliveries_excerpt" CHECK (length("webhook_deliveries"."response_excerpt") <= 1024),
	CONSTRAINT "webhook_deliveries_sent" CHECK (("webhook_deliveries"."sent_at" is null) = ("webhook_deliveries"."state" <> 'sent'))
);
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint" FOREIGN KEY ("workspace_id","endpoint_id") REFERENCES "public"."webhook_endpoints"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_endpoints_created_by_idx" ON "webhook_endpoints" USING btree ("workspace_id","created_by_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_once" ON "webhook_deliveries" USING btree ("workspace_id","endpoint_id","event_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_log" ON "webhook_deliveries" USING btree ("workspace_id","endpoint_id","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "webhook_deliveries_created" ON "webhook_deliveries" USING btree ("workspace_id","created_at");--> statement-breakpoint

alter table webhook_endpoints enable row level security;
--> statement-breakpoint
alter table webhook_endpoints force row level security;
--> statement-breakpoint
create policy webhook_endpoints_tenant on webhook_endpoints
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table webhook_deliveries enable row level security;
--> statement-breakpoint
alter table webhook_deliveries force row level security;
--> statement-breakpoint
create policy webhook_deliveries_tenant on webhook_deliveries
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- Quoted and fully qualified for the reasons crm_enqueue_job's comment gives.
create function crm_enqueue_webhook_delivery(delivery_id uuid)
  returns boolean
  language sql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
as $function$
  with delivery as (
    select d.workspace_id, d.id, d.endpoint_id, d.next_attempt_at
    from public.webhook_deliveries d
    where d.id = crm_enqueue_webhook_delivery.delivery_id
      and d.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
      and d.state in ('pending', 'failed')
  ),
  added as materialized (
    select graphile_worker.add_job(
      identifier => 'crm_webhook_deliver',
      payload => pg_catalog.json_build_object('workspaceId', delivery.workspace_id, 'deliveryId', delivery.id),
      queue_name => 'webhook:' || delivery.workspace_id::text || ':' || delivery.endpoint_id::text,
      priority => 6,
      run_at => coalesce(delivery.next_attempt_at, pg_catalog.now()),
      max_attempts => 3,
      job_key => 'crm-webhook:' || delivery.workspace_id::text || ':' || delivery.id::text,
      job_key_mode => 'replace'
    ) as queued
    from delivery
  )
  select count(*) = 1 from added;
$function$;
--> statement-breakpoint
revoke all on function crm_enqueue_webhook_delivery(uuid) from public;
--> statement-breakpoint
grant execute on function crm_enqueue_webhook_delivery(uuid) to crm_app;
--> statement-breakpoint
-- The columns the function reads, and nothing else of the table (never the payload or the receiver's answer).
grant select (workspace_id, id, endpoint_id, state, next_attempt_at) on webhook_deliveries to crm_queue;
--> statement-breakpoint
grant crm_queue to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_queue;
--> statement-breakpoint
alter function crm_enqueue_webhook_delivery(uuid) owner to crm_queue;
--> statement-breakpoint
revoke create on schema public from crm_queue;
--> statement-breakpoint
revoke crm_queue from current_user;
--> statement-breakpoint

create function crm_webhook_form_handles(form uuid)
  returns table (handle text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select distinct p.handle
  from auth.profile_items i
  join auth.public_profiles p on p.user_id = i.user_id and p.workspace_id = i.workspace_id
  where i.kind = 'form'
    and i.form_id = crm_webhook_form_handles.form
    and i.archived_at is null
    and i.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
  order by p.handle
  limit 20;
end;
--> statement-breakpoint
revoke all on function crm_webhook_form_handles(uuid) from public;
--> statement-breakpoint
grant execute on function crm_webhook_form_handles(uuid) to crm_app;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
alter function crm_webhook_form_handles(uuid) owner to crm_handle;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;

--> statement-breakpoint

-- An endpoint turned off after 3 days of failed deliveries (AC-6423) tells each owner and admin in their inbox too: one
-- `webhook_off` notification per member per time it turns off, naming the endpoint (on delete cascade, so deleting the
-- endpoint takes its notices). Builds on 0143's check, every branch kept, one added; the new enum value can't be used
-- in the transaction that adds it, so the check compares `kind::text`. Row level security on `notifications` is
-- unchanged.
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'webhook_off';
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "webhook_endpoint_id" uuid;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_webhook_endpoint" FOREIGN KEY ("workspace_id","webhook_endpoint_id") REFERENCES "public"."webhook_endpoints"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "notifications_by_webhook_endpoint" ON "notifications" USING btree ("workspace_id","webhook_endpoint_id") WHERE "notifications"."webhook_endpoint_id" is not null;
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

);
