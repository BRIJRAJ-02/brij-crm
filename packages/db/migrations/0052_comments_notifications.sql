-- Comments, mentions and the inbox (spec 0038): `comments` with `comment_versions` and `comment_reactions`, and
-- `notifications` with `notification_settings`, plus the outbox kinds `comments` and `notifications`. The tables,
-- keys and indexes are drizzle-kit's; row level security and the email task's enqueue function are hand written at
-- the end. A comment's and a notification's foreign keys to records have no `on delete` action: the purge deletes
-- them first (spec 0022). The new outbox kinds are added in this transaction and first used by later ones.
--
-- The foreign keys briefly lock records, tasks and members against writes. Give up after 5 seconds rather than
-- queue behind traffic, like 0037.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('mention', 'reply', 'task_assigned');--> statement-breakpoint
ALTER TYPE "public"."outbox_kind" ADD VALUE 'comments';--> statement-breakpoint
ALTER TYPE "public"."outbox_kind" ADD VALUE 'notifications';--> statement-breakpoint
CREATE TABLE "comment_reactions" (
	"workspace_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reactions_pkey" PRIMARY KEY("workspace_id","comment_id","member_id","emoji"),
	CONSTRAINT "comment_reactions_emoji" CHECK (emoji in ('👍', '❤️', '🎉', '😄', '👀', '✅'))
);
--> statement-breakpoint
CREATE TABLE "comment_versions" (
	"workspace_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp (6) with time zone NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	CONSTRAINT "comment_versions_pkey" PRIMARY KEY("workspace_id","comment_id","version"),
	CONSTRAINT "comment_versions_body" CHECK (char_length("comment_versions"."body") between 1 and 10000),
	CONSTRAINT "comment_versions_created_by_actor" CHECK (("comment_versions"."created_by_type" is null and "comment_versions"."created_by_id" is null and "comment_versions"."created_by_member_id" is null)
      or ("comment_versions"."created_by_type" = 'system' and "comment_versions"."created_by_id" is null and "comment_versions"."created_by_member_id" is null)
      or ("comment_versions"."created_by_type" = 'member' and "comment_versions"."created_by_id" is not null and "comment_versions"."created_by_member_id" = "comment_versions"."created_by_id")
      or ("comment_versions"."created_by_type"::text not in ('member', 'system', 'calendar') and "comment_versions"."created_by_id" is not null and "comment_versions"."created_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"body" text NOT NULL,
	"mention_member_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"edited_at" timestamp (6) with time zone,
	"resolved_at" timestamp (6) with time zone,
	"resolved_by_type" "actor_type",
	"resolved_by_id" uuid,
	"resolved_by_member_id" uuid,
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
	CONSTRAINT "comments_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "comments_body" CHECK (char_length("comments"."body") between 1 and 10000),
	CONSTRAINT "comments_mentions" CHECK (cardinality("comments"."mention_member_ids") <= 50),
	CONSTRAINT "comments_version" CHECK ("comments"."version" >= 1),
	CONSTRAINT "comments_edited" CHECK (("comments"."version" = 1) = ("comments"."edited_at" is null)),
	CONSTRAINT "comments_resolved" CHECK ("comments"."resolved_at" is null or "comments"."thread_id" = "comments"."id"),
	CONSTRAINT "comments_resolved_actor" CHECK (("comments"."resolved_at" is null) = ("comments"."resolved_by_type" is null)),
	CONSTRAINT "comments_deleted" CHECK (("comments"."deleted_at" is null) = ("comments"."deleted_by_type" is null)),
	CONSTRAINT "comments_created_by_actor" CHECK (("comments"."created_by_type" is null and "comments"."created_by_id" is null and "comments"."created_by_member_id" is null)
      or ("comments"."created_by_type" = 'system' and "comments"."created_by_id" is null and "comments"."created_by_member_id" is null)
      or ("comments"."created_by_type" = 'member' and "comments"."created_by_id" is not null and "comments"."created_by_member_id" = "comments"."created_by_id")
      or ("comments"."created_by_type"::text not in ('member', 'system', 'calendar') and "comments"."created_by_id" is not null and "comments"."created_by_member_id" is null)),
	CONSTRAINT "comments_updated_by_actor" CHECK (("comments"."updated_by_type" is null and "comments"."updated_by_id" is null and "comments"."updated_by_member_id" is null)
      or ("comments"."updated_by_type" = 'system' and "comments"."updated_by_id" is null and "comments"."updated_by_member_id" is null)
      or ("comments"."updated_by_type" = 'member' and "comments"."updated_by_id" is not null and "comments"."updated_by_member_id" = "comments"."updated_by_id")
      or ("comments"."updated_by_type"::text not in ('member', 'system', 'calendar') and "comments"."updated_by_id" is not null and "comments"."updated_by_member_id" is null)),
	CONSTRAINT "comments_resolved_by_actor" CHECK (("comments"."resolved_by_type" is null and "comments"."resolved_by_id" is null and "comments"."resolved_by_member_id" is null)
      or ("comments"."resolved_by_type" = 'system' and "comments"."resolved_by_id" is null and "comments"."resolved_by_member_id" is null)
      or ("comments"."resolved_by_type" = 'member' and "comments"."resolved_by_id" is not null and "comments"."resolved_by_member_id" = "comments"."resolved_by_id")
      or ("comments"."resolved_by_type"::text not in ('member', 'system', 'calendar') and "comments"."resolved_by_id" is not null and "comments"."resolved_by_member_id" is null)),
	CONSTRAINT "comments_deleted_by_actor" CHECK (("comments"."deleted_by_type" is null and "comments"."deleted_by_id" is null and "comments"."deleted_by_member_id" is null)
      or ("comments"."deleted_by_type" = 'system' and "comments"."deleted_by_id" is null and "comments"."deleted_by_member_id" is null)
      or ("comments"."deleted_by_type" = 'member' and "comments"."deleted_by_id" is not null and "comments"."deleted_by_member_id" = "comments"."deleted_by_id")
      or ("comments"."deleted_by_type"::text not in ('member', 'system', 'calendar') and "comments"."deleted_by_id" is not null and "comments"."deleted_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"email_mentions" boolean DEFAULT true NOT NULL,
	"email_replies" boolean DEFAULT false NOT NULL,
	"email_assignments" boolean DEFAULT true NOT NULL,
	"digest" boolean DEFAULT false NOT NULL,
	"time_zone" text,
	"digest_sent_on" date,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_pkey" PRIMARY KEY("workspace_id","member_id"),
	CONSTRAINT "notification_settings_digest" CHECK (not "notification_settings"."digest" or "notification_settings"."time_zone" is not null),
	CONSTRAINT "notification_settings_zone" CHECK ("notification_settings"."time_zone" is null or char_length("notification_settings"."time_zone") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"actor_member_id" uuid,
	"record_id" uuid,
	"thread_id" uuid,
	"comment_id" uuid,
	"task_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp (6) with time zone,
	"done_at" timestamp (6) with time zone,
	"emailed_at" timestamp (6) with time zone,
	CONSTRAINT "notifications_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "notifications_subject" CHECK (("notifications"."kind" = 'task_assigned' and "notifications"."task_id" is not null and "notifications"."comment_id" is null)
        or ("notifications"."kind" <> 'task_assigned' and "notifications"."comment_id" is not null and "notifications"."thread_id" is not null
          and "notifications"."record_id" is not null and "notifications"."task_id" is null)),
	CONSTRAINT "notifications_actor_actor" CHECK (("notifications"."actor_type" is null and "notifications"."actor_id" is null and "notifications"."actor_member_id" is null)
      or ("notifications"."actor_type" = 'system' and "notifications"."actor_id" is null and "notifications"."actor_member_id" is null)
      or ("notifications"."actor_type" = 'member' and "notifications"."actor_id" is not null and "notifications"."actor_member_id" = "notifications"."actor_id")
      or ("notifications"."actor_type"::text not in ('member', 'system', 'calendar') and "notifications"."actor_id" is not null and "notifications"."actor_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment" FOREIGN KEY ("workspace_id","comment_id") REFERENCES "public"."comments"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_versions" ADD CONSTRAINT "comment_versions_comment" FOREIGN KEY ("workspace_id","comment_id") REFERENCES "public"."comments"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_versions" ADD CONSTRAINT "comment_versions_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_record" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_thread" FOREIGN KEY ("workspace_id","thread_id") REFERENCES "public"."comments"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_resolved_by" FOREIGN KEY ("workspace_id","resolved_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_deleted_by" FOREIGN KEY ("workspace_id","deleted_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_record" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_comment" FOREIGN KEY ("workspace_id","comment_id") REFERENCES "public"."comments"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_task" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor" FOREIGN KEY ("workspace_id","actor_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_by_record" ON "comments" USING btree ("workspace_id","record_id","created_at","id") WHERE "comments"."id" = "comments"."thread_id";--> statement-breakpoint
CREATE INDEX "comments_by_thread" ON "comments" USING btree ("workspace_id","thread_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comments_record_all" ON "comments" USING btree ("workspace_id","record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_one_per_comment" ON "notifications" USING btree ("workspace_id","member_id","comment_id") WHERE "notifications"."comment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_one_per_task" ON "notifications" USING btree ("workspace_id","member_id","task_id") WHERE "notifications"."task_id" is not null;--> statement-breakpoint
CREATE INDEX "notifications_inbox" ON "notifications" USING btree ("workspace_id","member_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "notifications"."done_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_done" ON "notifications" USING btree ("workspace_id","member_id","done_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "notifications"."done_at" is not null;--> statement-breakpoint
CREATE INDEX "notifications_unread" ON "notifications" USING btree ("workspace_id","member_id","created_at" DESC NULLS LAST) WHERE "notifications"."read_at" is null and "notifications"."done_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_by_record" ON "notifications" USING btree ("workspace_id","record_id") WHERE "notifications"."record_id" is not null;
--> statement-breakpoint

-- Hand written from here.
-- The standard policy on each table: an unset workspace matches nothing, even for the owner.
alter table comments enable row level security;
--> statement-breakpoint
alter table comments force row level security;
--> statement-breakpoint
create policy comments_tenant on comments
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table comment_versions enable row level security;
--> statement-breakpoint
alter table comment_versions force row level security;
--> statement-breakpoint
create policy comment_versions_tenant on comment_versions
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table comment_reactions enable row level security;
--> statement-breakpoint
alter table comment_reactions force row level security;
--> statement-breakpoint
create policy comment_reactions_tenant on comment_reactions
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table notifications enable row level security;
--> statement-breakpoint
alter table notifications force row level security;
--> statement-breakpoint
create policy notifications_tenant on notifications
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table notification_settings enable row level security;
--> statement-breakpoint
alter table notification_settings force row level security;
--> statement-breakpoint
create policy notification_settings_tenant on notification_settings
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- Puts a member's notification email on Graphile Worker's queue (spec 0038, AC-1176), as crm_enqueue_calendar_sync
-- does for calendar sync, owned by the same crm_queue. It reads the member under the caller's workspace setting (row
-- level security still applies), and only an active one. It builds the queue row itself, so the caller chooses no
-- task, payload or queue: task crm_notification_email, payload the workspace and member ids alone, run 5 minutes from
-- now, job key crm-notify:<workspace>:<member> with job_key_mode 'preserve_run_at', so a burst of notifications is one
-- waiting row that keeps its first time, and 5 attempts. Answers whether it queued.
create function crm_enqueue_notification_email(member_id uuid)
  returns boolean
  language sql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
as $function$
  with member as (
    select m.workspace_id, m.id
    from public.members m
    where m.id = crm_enqueue_notification_email.member_id
      and m.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
      and m.status = 'active'
  ),
  added as materialized (
    select graphile_worker.add_job(
      identifier => 'crm_notification_email',
      payload => pg_catalog.json_build_object('workspaceId', member.workspace_id, 'memberId', member.id),
      run_at => pg_catalog.now() + interval '5 minutes',
      max_attempts => 5,
      job_key => 'crm-notify:' || member.workspace_id::text || ':' || member.id::text,
      job_key_mode => 'preserve_run_at'
    ) as queued
    from member
  )
  select count(*) = 1 from added;
$function$;
--> statement-breakpoint
revoke all on function crm_enqueue_notification_email(uuid) from public;
--> statement-breakpoint
grant execute on function crm_enqueue_notification_email(uuid) to crm_app;
--> statement-breakpoint
-- The three columns the function reads, and nothing else of the table.
grant select (workspace_id, id, status) on members to crm_queue;
--> statement-breakpoint
grant crm_queue to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_queue;
--> statement-breakpoint
alter function crm_enqueue_notification_email(uuid) owner to crm_queue;
--> statement-breakpoint
revoke create on schema public from crm_queue;
--> statement-breakpoint
revoke crm_queue from current_user;
