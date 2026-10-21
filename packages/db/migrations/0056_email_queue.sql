-- Queued email (the emails lane): `emails`, one row per message, written in the transaction of the change it tells
-- someone about and sent by the worker's `crm_email` task, its params and address blanked once it is sent; and
-- `email_preferences`, the topics of optional email a member turned off. drizzle-kit's tables, keys and indexes; row
-- level security and the queue function hand written at the end. Numbered after the migrations landing before it
-- (booking2 0048, bulk 0049 to 0051, forms 0052 and 0053); the landing renumbers it if that order changes.
CREATE TYPE "public"."email_status" AS ENUM('queued', 'sent', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "email_preferences" (
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"subscribed" boolean NOT NULL,
	"updated_via" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_preferences_pkey" PRIMARY KEY("workspace_id","member_id","topic"),
	CONSTRAINT "email_preferences_via" CHECK ("email_preferences"."updated_via" in ('email_link', 'app'))
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"to_member_id" uuid,
	"to_address" text,
	"reply_to_member_id" uuid,
	"params" jsonb NOT NULL,
	"status" "email_status" DEFAULT 'queued' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"error_code" text,
	"sent_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emails_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "emails_created_by_actor" CHECK (("emails"."created_by_type" is null and "emails"."created_by_id" is null and "emails"."created_by_member_id" is null)
      or ("emails"."created_by_type" = 'system' and "emails"."created_by_id" is null and "emails"."created_by_member_id" is null)
      or ("emails"."created_by_type" = 'member' and "emails"."created_by_id" is not null and "emails"."created_by_member_id" = "emails"."created_by_id")
      or ("emails"."created_by_type"::text not in ('member', 'system', 'calendar') and "emails"."created_by_id" is not null and "emails"."created_by_member_id" is null)),
	CONSTRAINT "emails_reader" CHECK ("emails"."status" <> 'queued' or ("emails"."to_member_id" is null) <> ("emails"."to_address" is null)),
	CONSTRAINT "emails_key" CHECK ("emails"."key" ~ '^[a-z_]+(:[A-Za-z0-9_-]+)+$' and length("emails"."key") <= 300),
	CONSTRAINT "emails_sent" CHECK (("emails"."sent_at" is null) = ("emails"."status" <> 'sent'))
);
--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_to_member" FOREIGN KEY ("workspace_id","to_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_reply_to_member" FOREIGN KEY ("workspace_id","reply_to_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "emails_key_unique" ON "emails" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "emails_created" ON "emails" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "emails_to_member_idx" ON "emails" USING btree ("workspace_id","to_member_id");--> statement-breakpoint
CREATE INDEX "emails_reply_to_member_idx" ON "emails" USING btree ("workspace_id","reply_to_member_id");--> statement-breakpoint

-- The standard policy on both tables: an unset workspace matches nothing, even for the owner. It names no role, so
-- crm_queue's read in crm_enqueue_email sees only the caller's workspace too.
alter table emails enable row level security;
--> statement-breakpoint
alter table emails force row level security;
--> statement-breakpoint
create policy emails_tenant on emails
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table email_preferences enable row level security;
--> statement-breakpoint
alter table email_preferences force row level security;
--> statement-breakpoint
create policy email_preferences_tenant on email_preferences
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- Puts one queued email on Graphile Worker's queue (the emails lane), as crm_enqueue_calendar_sync does for calendar
-- sync, owned by the same crm_queue. It reads the email under the caller's workspace setting (row level security
-- still applies; crm_queue bypasses nothing) and refuses one that isn't queued. It builds the queue row itself, so
-- the caller chooses nothing but the email: task crm_email, payload the workspace and email ids only, keyed by the
-- email so it has one queue row. 11 tries with Graphile's backoff, the last about 10 hours after the first, inside
-- the mail service's 24 hours of idempotency, so a retry after a send that went through never sends twice. One
-- queue per workspace (`email:<workspace>`, priority 5, after members' light jobs): a workspace's emails go one at a
-- time, so one workspace's burst (a busy form) takes one of the light lane's slots and never holds back another's
-- mail; the worker paces every send under the mail service's rate limit. Answers whether it queued.
-- Quoted and fully qualified for the reasons crm_enqueue_job's comment gives.
create function crm_enqueue_email(email_id uuid)
  returns boolean
  language sql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
as $function$
  with email as (
    select e.workspace_id, e.id
    from public.emails e
    where e.id = crm_enqueue_email.email_id
      and e.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
      and e.status = 'queued'
  ),
  added as materialized (
    select graphile_worker.add_job(
      identifier => 'crm_email',
      payload => pg_catalog.json_build_object('workspaceId', email.workspace_id, 'emailId', email.id),
      queue_name => 'email:' || email.workspace_id::text,
      priority => 5,
      run_at => pg_catalog.now(),
      max_attempts => 11,
      job_key => 'crm-email:' || email.workspace_id::text || ':' || email.id::text,
      job_key_mode => 'replace'
    ) as queued
    from email
  )
  select count(*) = 1 from added;
$function$;
--> statement-breakpoint
revoke all on function crm_enqueue_email(uuid) from public;
--> statement-breakpoint
grant execute on function crm_enqueue_email(uuid) to crm_app;
--> statement-breakpoint
-- The three columns the function reads, and nothing else of the table (never the params or the address).
grant select (workspace_id, id, status) on emails to crm_queue;
--> statement-breakpoint
grant crm_queue to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_queue;
--> statement-breakpoint
alter function crm_enqueue_email(uuid) owner to crm_queue;
--> statement-breakpoint
revoke create on schema public from crm_queue;
--> statement-breakpoint
revoke crm_queue from current_user;
