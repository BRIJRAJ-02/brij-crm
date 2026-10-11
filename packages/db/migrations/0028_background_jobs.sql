-- Background jobs (spec 0008, milestone 1): the `jobs` and `job_items` tenant tables (drizzle-kit's), then, hand
-- written, their row level security, the two roles `crm_worker` (the worker's direct login group) and `crm_queue`
-- (the owner of `crm_enqueue_job`), the one function the app may call to put a job on Graphile Worker's queue, and
-- `crm_outbox_workspaces` moved from the app to the worker. Graphile Worker's own schema is installed before this
-- by `scripts/migrate.ts` (Graphile's migrations, as the owner), and the rights on it are granted after every run
-- (`grantQueueRights` in `src/migrations.ts`), so a Graphile upgrade that adds a table is covered. Numbered 0028,
-- leaving 0026 and 0027 to the other lanes; its journal `when` is the time it was generated.
--
-- New tables only, nothing waits on traffic. Any change to the roles or the function goes through
-- security-access-reviewer.
CREATE TYPE "public"."job_item_state" AS ENUM('pending', 'done', 'refused', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."job_lane" AS ENUM('heavy', 'light');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('preparing', 'ready', 'queued', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "job_items" (
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"state" "job_item_state" DEFAULT 'pending' NOT NULL,
	"code" text,
	"message" text,
	CONSTRAINT "job_items_pkey" PRIMARY KEY("workspace_id","job_id","position")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"lane" "job_lane" NOT NULL,
	"status" "job_status" NOT NULL,
	"params" jsonb NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"dedupe_key" text,
	"once_key" text,
	"priority" smallint NOT NULL,
	"run_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"total" integer,
	"done" integer DEFAULT 0 NOT NULL,
	"refused" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"checkpoint" jsonb,
	"result" jsonb,
	"error_code" text,
	"error_message" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp (6) with time zone,
	"slices" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp (6) with time zone,
	"cancel_requested_at" timestamp (6) with time zone,
	"cancel_requested_by_member_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"started_at" timestamp (6) with time zone,
	"finished_at" timestamp (6) with time zone,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "jobs_created_by_actor" CHECK (("jobs"."created_by_type" is null and "jobs"."created_by_id" is null and "jobs"."created_by_member_id" is null)
      or ("jobs"."created_by_type" = 'system' and "jobs"."created_by_id" is null and "jobs"."created_by_member_id" is null)
      or ("jobs"."created_by_type" = 'member' and "jobs"."created_by_id" is not null and "jobs"."created_by_member_id" = "jobs"."created_by_id")
      or ("jobs"."created_by_type" in ('api_key', 'automation') and "jobs"."created_by_id" is not null and "jobs"."created_by_member_id" is null)),
	CONSTRAINT "jobs_counts" CHECK ("jobs"."done" >= 0 and "jobs"."refused" >= 0 and "jobs"."skipped" >= 0 and "jobs"."total" >= 0),
	CONSTRAINT "jobs_finished" CHECK (("jobs"."finished_at" is null) = ("jobs"."status" not in ('succeeded', 'failed', 'cancelled')))
);
--> statement-breakpoint
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_job" FOREIGN KEY ("workspace_id","job_id") REFERENCES "public"."jobs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_cancel_requested_by" FOREIGN KEY ("workspace_id","cancel_requested_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_items_item" ON "job_items" USING btree ("workspace_id","job_id","item_id");--> statement-breakpoint
CREATE INDEX "job_items_refused" ON "job_items" USING btree ("workspace_id","job_id","code") WHERE "job_items"."state" = 'refused';--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe" ON "jobs" USING btree ("workspace_id","kind","dedupe_key") WHERE "jobs"."status" = 'queued' and "jobs"."slices" = 0;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_once" ON "jobs" USING btree ("workspace_id","kind","once_key") WHERE "jobs"."once_key" is not null;--> statement-breakpoint
CREATE INDEX "jobs_mine" ON "jobs" USING btree ("workspace_id","created_by_member_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "jobs_all" ON "jobs" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "jobs_subject" ON "jobs" USING btree ("workspace_id","subject_id") WHERE "jobs"."finished_at" is null;--> statement-breakpoint
CREATE INDEX "jobs_finished_at" ON "jobs" USING btree ("workspace_id","finished_at") WHERE "jobs"."finished_at" is not null;
--> statement-breakpoint

-- Hand written from here.
-- The standard policy on both tables: an unset workspace matches nothing, even for the owner. It names no role, so
-- it also holds for crm_queue, whose function reads a job under the caller's workspace setting.
alter table jobs enable row level security;
--> statement-breakpoint
alter table jobs force row level security;
--> statement-breakpoint
create policy jobs_tenant on jobs
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table job_items enable row level security;
--> statement-breakpoint
alter table job_items force row level security;
--> statement-breakpoint
create policy job_items_tenant on job_items
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- crm_worker: the group of the worker's direct login (`crm_worker_user`, made by `pnpm db:worker-login`), which
-- the relay and Graphile Worker's runners use. It can't log in, can't bypass row level security, and inherits
-- crm_app, so tenant work under withWorkspace() is the app's. On top it alone reads and changes the queue (granted
-- after Graphile's migrations) and lists the workspaces with unpublished outbox rows.
--
-- crm_queue: the owner of crm_enqueue_job. It can't log in, can't bypass row level security, inherits nothing, and
-- holds exactly what Graphile's add_job needs (granted after Graphile's migrations) plus reading the five jobs
-- columns the function reads.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_worker') then
    create role crm_worker nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication inherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'crm_queue') then
    create role crm_queue nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication noinherit;
  end if;
end
$$;
--> statement-breakpoint
-- Roles are shared by the whole cluster: one made earlier gets exactly these attributes (the ones only a superuser
-- may change are checked at the end).
alter role crm_worker nologin nobypassrls nocreaterole inherit password null;
--> statement-breakpoint
alter role crm_queue nologin nobypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant crm_app to crm_worker;
--> statement-breakpoint
grant usage on schema public to crm_queue;
--> statement-breakpoint
grant select (workspace_id, id, lane, priority, status) on jobs to crm_queue;
--> statement-breakpoint

-- Puts a job on Graphile Worker's queue: the only way the app reaches the queue (AC-115). It reads the job under the
-- caller's workspace setting (row level security still applies, crm_queue bypasses nothing), and only one that may
-- still run: queued, running or preparing, and cancelling, whose next slice ends it. It builds the queue row itself,
-- so the caller chooses no task, payload or queue: task crm_job_heavy or crm_job_light by the job's lane, payload
-- the workspace and job ids alone, queue heavy:<workspace> for heavy jobs (one heavy slice per workspace at a time)
-- and none for light ones, the job's priority, run_at (now when null), 25 attempts as Graphile's backstop, job key
-- crm-job:<id> and job_key_mode 'replace', named on every call (spec 0008, Queue keys). Answers whether it queued.
--
-- A quoted language sql body, so it is bound when it runs: a Graphile upgrade that drops and recreates add_job
-- never fails on it. The parameters are qualified with the function's name, so no column can shadow them; every
-- name outside pg_catalog is qualified too, and the search path holds nothing else. The CTE is materialized, so
-- add_job runs for the one job row whether or not anything reads its answer.
create function crm_enqueue_job(job_id uuid, run_at timestamptz default null)
  returns boolean
  language sql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
as $function$
  with job as (
    select j.workspace_id, j.id, j.lane, j.priority
    from public.jobs j
    where j.id = crm_enqueue_job.job_id
      and j.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
      and j.status in ('preparing', 'queued', 'running', 'cancelling')
  ),
  added as materialized (
    select graphile_worker.add_job(
      identifier => case when job.lane = 'heavy' then 'crm_job_heavy' else 'crm_job_light' end,
      payload => pg_catalog.json_build_object('workspaceId', job.workspace_id, 'jobId', job.id),
      queue_name => case when job.lane = 'heavy' then 'heavy:' || job.workspace_id::text end,
      run_at => coalesce(crm_enqueue_job.run_at, pg_catalog.now()),
      max_attempts => 25,
      job_key => 'crm-job:' || job.id::text,
      priority => job.priority::integer,
      job_key_mode => 'replace'
    ) as queued
    from job
  )
  select count(*) = 1 from added;
$function$;
--> statement-breakpoint
revoke all on function crm_enqueue_job(uuid, timestamptz) from public;
--> statement-breakpoint
grant execute on function crm_enqueue_job(uuid, timestamptz) to crm_app;
--> statement-breakpoint
-- Hand the function to crm_queue, as 0020 hands the relay's to crm_relay: SET on the role and CREATE on the schema
-- for the change only.
grant crm_queue to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_queue;
--> statement-breakpoint
alter function crm_enqueue_job(uuid, timestamptz) owner to crm_queue;
--> statement-breakpoint
revoke create on schema public from crm_queue;
--> statement-breakpoint
revoke crm_queue from current_user;
--> statement-breakpoint

-- Listing the workspaces with unpublished outbox rows reaches across workspaces: the worker's alone from now on
-- (the relay runs on crm_worker_user), never the API's. crm_relay owns it, so the change is made as crm_relay, with
-- SET on it held for the change only.
grant crm_relay to current_user with inherit false, set true;
--> statement-breakpoint
set local role crm_relay;
--> statement-breakpoint
revoke execute on function crm_outbox_workspaces(integer, uuid) from crm_app;
--> statement-breakpoint
grant execute on function crm_outbox_workspaces(integer, uuid) to crm_worker;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke crm_relay from current_user;
--> statement-breakpoint

-- Refuse to finish unless both roles are plain: no login, no power, nothing but the database owner reaching them
-- (Neon's platform roles skipped, as in 0020), crm_app reaching neither, crm_queue in no role at all and
-- crm_worker in crm_app alone.
do $$
begin
  if exists (
    select 1 from pg_roles
    where rolname in ('crm_worker', 'crm_queue')
      and (rolsuper or rolreplication or rolcreatedb or rolcreaterole or rolcanlogin or rolbypassrls)
  ) or exists (
    select 1 from pg_auth_members m
    where m.roleid = 'crm_queue'::regrole
      and m.member <> (select datdba from pg_database where datname = current_database())
      and pg_get_userbyid(m.member) not in ('neon_service', 'cloud_admin')
  ) or exists (
    select 1 from pg_auth_members m where m.member = 'crm_queue'::regrole
  ) or exists (
    select 1 from pg_auth_members m
    where m.member = 'crm_worker'::regrole and m.roleid <> 'crm_app'::regrole
  ) or pg_has_role('crm_app', 'crm_worker', 'MEMBER')
    or pg_has_role('crm_app', 'crm_queue', 'MEMBER')
    or pg_has_role('crm_identity', 'crm_worker', 'MEMBER') then
    raise exception 'crm_worker and crm_queue must be plain roles: crm_worker in crm_app alone, crm_queue in nothing, neither reachable from crm_app';
  end if;
end
$$;
