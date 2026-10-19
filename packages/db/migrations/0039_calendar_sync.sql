-- Calendar sync (spec 0024, milestone 1): members' calendar connections, the meetings synced from them, which
-- connections hold each meeting, its attendees, the records it shows on, and the workspace's calendar settings. The
-- types, tables, keys and indexes are drizzle-kit's; the header, the lock timeout, row level security and the queue
-- function at the end are hand written.
--
-- `actor_type` gains `calendar` and `outbox_kind` gains `meetings`. Enum values are only ever added, and nothing in
-- this migration uses them: the actor checks that admit calendar sync compare the type as text, so they never name
-- the new value inside the transaction that adds it.
--
-- The foreign keys briefly lock members and records against writes. Give up after 5 seconds rather than queue
-- behind traffic, like 0020, 0023, 0026, 0029, 0033 and 0037.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TYPE "public"."attendee_match" AS ENUM('linked', 'ambiguous', 'unknown', 'member');--> statement-breakpoint
CREATE TYPE "public"."attendee_response" AS ENUM('accepted', 'declined', 'tentative', 'needs_action');--> statement-breakpoint
CREATE TYPE "public"."calendar_provider" AS ENUM('google', 'microsoft');--> statement-breakpoint
CREATE TYPE "public"."calendar_sharing" AS ENUM('shared', 'private');--> statement-breakpoint
CREATE TYPE "public"."calendar_status" AS ENUM('syncing', 'connected', 'expired', 'revoked', 'failed');--> statement-breakpoint
CREATE TYPE "public"."meeting_link_via" AS ENUM('attendee', 'domain');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('confirmed', 'tentative', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."actor_type" ADD VALUE 'calendar';--> statement-breakpoint
ALTER TYPE "public"."outbox_kind" ADD VALUE 'meetings';--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"member_id" uuid NOT NULL,
	"provider" "calendar_provider" NOT NULL,
	"account_email" text NOT NULL,
	"status" "calendar_status" DEFAULT 'syncing' NOT NULL,
	"sharing" "calendar_sharing" DEFAULT 'shared' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"tokens" "bytea" NOT NULL,
	"sync_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channel" jsonb,
	"last_synced_at" timestamp (6) with time zone,
	"last_error" jsonb,
	"failing_since" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "calendar_connections_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "calendar_connections_email" CHECK (char_length("calendar_connections"."account_email") between 3 and 320 and "calendar_connections"."account_email" = lower(btrim("calendar_connections"."account_email"))),
	CONSTRAINT "calendar_connections_created_by_actor" CHECK (("calendar_connections"."created_by_type" is null and "calendar_connections"."created_by_id" is null and "calendar_connections"."created_by_member_id" is null)
      or ("calendar_connections"."created_by_type" = 'system' and "calendar_connections"."created_by_id" is null and "calendar_connections"."created_by_member_id" is null)
      or ("calendar_connections"."created_by_type" = 'member' and "calendar_connections"."created_by_id" is not null and "calendar_connections"."created_by_member_id" = "calendar_connections"."created_by_id")
      or ("calendar_connections"."created_by_type" in ('api_key', 'automation') and "calendar_connections"."created_by_id" is not null and "calendar_connections"."created_by_member_id" is null)),
	CONSTRAINT "calendar_connections_updated_by_actor" CHECK (("calendar_connections"."updated_by_type" is null and "calendar_connections"."updated_by_id" is null and "calendar_connections"."updated_by_member_id" is null)
      or ("calendar_connections"."updated_by_type"::text in ('system', 'calendar') and "calendar_connections"."updated_by_id" is null and "calendar_connections"."updated_by_member_id" is null)
      or ("calendar_connections"."updated_by_type" = 'member' and "calendar_connections"."updated_by_id" is not null and "calendar_connections"."updated_by_member_id" = "calendar_connections"."updated_by_id")
      or ("calendar_connections"."updated_by_type" in ('api_key', 'automation') and "calendar_connections"."updated_by_id" is not null and "calendar_connections"."updated_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "calendar_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"create_unknown_people" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "calendar_settings_created_by_actor" CHECK (("calendar_settings"."created_by_type" is null and "calendar_settings"."created_by_id" is null and "calendar_settings"."created_by_member_id" is null)
      or ("calendar_settings"."created_by_type" = 'system' and "calendar_settings"."created_by_id" is null and "calendar_settings"."created_by_member_id" is null)
      or ("calendar_settings"."created_by_type" = 'member' and "calendar_settings"."created_by_id" is not null and "calendar_settings"."created_by_member_id" = "calendar_settings"."created_by_id")
      or ("calendar_settings"."created_by_type" in ('api_key', 'automation') and "calendar_settings"."created_by_id" is not null and "calendar_settings"."created_by_member_id" is null)),
	CONSTRAINT "calendar_settings_updated_by_actor" CHECK (("calendar_settings"."updated_by_type" is null and "calendar_settings"."updated_by_id" is null and "calendar_settings"."updated_by_member_id" is null)
      or ("calendar_settings"."updated_by_type" = 'system' and "calendar_settings"."updated_by_id" is null and "calendar_settings"."updated_by_member_id" is null)
      or ("calendar_settings"."updated_by_type" = 'member' and "calendar_settings"."updated_by_id" is not null and "calendar_settings"."updated_by_member_id" = "calendar_settings"."updated_by_id")
      or ("calendar_settings"."updated_by_type" in ('api_key', 'automation') and "calendar_settings"."updated_by_id" is not null and "calendar_settings"."updated_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "meeting_attendees" (
	"workspace_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"position" smallint NOT NULL,
	"response" "attendee_response" DEFAULT 'needs_action' NOT NULL,
	"is_organizer" boolean DEFAULT false NOT NULL,
	"member_id" uuid,
	"person_record_id" uuid,
	"match" "attendee_match" NOT NULL,
	CONSTRAINT "meeting_attendees_pkey" PRIMARY KEY("workspace_id","meeting_id","email"),
	CONSTRAINT "meeting_attendees_email" CHECK (char_length("meeting_attendees"."email") between 3 and 320),
	CONSTRAINT "meeting_attendees_name" CHECK (char_length("meeting_attendees"."name") <= 320),
	CONSTRAINT "meeting_attendees_linked" CHECK (("meeting_attendees"."match" = 'linked') = ("meeting_attendees"."person_record_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "meeting_records" (
	"workspace_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"via" "meeting_link_via" NOT NULL,
	"starts_at" timestamp (6) with time zone NOT NULL,
	CONSTRAINT "meeting_records_pkey" PRIMARY KEY("workspace_id","meeting_id","record_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_sources" (
	"workspace_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_event_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"etag" text,
	"marked_private" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_sources_pkey" PRIMARY KEY("workspace_id","meeting_id","connection_id")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"ical_uid" text NOT NULL,
	"original_start" timestamp (6) with time zone,
	"title" text NOT NULL,
	"starts_at" timestamp (6) with time zone NOT NULL,
	"ends_at" timestamp (6) with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"location" text,
	"video_url" text,
	"status" "meeting_status" DEFAULT 'confirmed' NOT NULL,
	"organizer_email" text,
	"is_private" boolean DEFAULT false NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_by_crm" boolean DEFAULT false NOT NULL,
	"booking_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "meetings_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "meetings_times" CHECK ("meetings"."ends_at" >= "meetings"."starts_at"),
	CONSTRAINT "meetings_title" CHECK (char_length("meetings"."title") <= 1024),
	CONSTRAINT "meetings_ical_uid" CHECK (char_length("meetings"."ical_uid") between 1 and 1024),
	CONSTRAINT "meetings_location" CHECK (char_length("meetings"."location") <= 500),
	CONSTRAINT "meetings_video_url" CHECK (char_length("meetings"."video_url") <= 2048),
	CONSTRAINT "meetings_created_by_actor" CHECK (("meetings"."created_by_type" is null and "meetings"."created_by_id" is null and "meetings"."created_by_member_id" is null)
      or ("meetings"."created_by_type"::text in ('system', 'calendar') and "meetings"."created_by_id" is null and "meetings"."created_by_member_id" is null)
      or ("meetings"."created_by_type" = 'member' and "meetings"."created_by_id" is not null and "meetings"."created_by_member_id" = "meetings"."created_by_id")
      or ("meetings"."created_by_type" in ('api_key', 'automation') and "meetings"."created_by_id" is not null and "meetings"."created_by_member_id" is null)),
	CONSTRAINT "meetings_updated_by_actor" CHECK (("meetings"."updated_by_type" is null and "meetings"."updated_by_id" is null and "meetings"."updated_by_member_id" is null)
      or ("meetings"."updated_by_type"::text in ('system', 'calendar') and "meetings"."updated_by_id" is null and "meetings"."updated_by_member_id" is null)
      or ("meetings"."updated_by_type" = 'member' and "meetings"."updated_by_id" is not null and "meetings"."updated_by_member_id" = "meetings"."updated_by_id")
      or ("meetings"."updated_by_type" in ('api_key', 'automation') and "meetings"."updated_by_id" is not null and "meetings"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_settings" ADD CONSTRAINT "calendar_settings_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_settings" ADD CONSTRAINT "calendar_settings_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_settings" ADD CONSTRAINT "calendar_settings_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meeting" FOREIGN KEY ("workspace_id","meeting_id") REFERENCES "public"."meetings"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_person" FOREIGN KEY ("workspace_id","person_record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_records" ADD CONSTRAINT "meeting_records_meeting" FOREIGN KEY ("workspace_id","meeting_id") REFERENCES "public"."meetings"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_records" ADD CONSTRAINT "meeting_records_record" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_sources" ADD CONSTRAINT "meeting_sources_meeting" FOREIGN KEY ("workspace_id","meeting_id") REFERENCES "public"."meetings"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_sources" ADD CONSTRAINT "meeting_sources_connection" FOREIGN KEY ("workspace_id","connection_id") REFERENCES "public"."calendar_connections"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connections_account" ON "calendar_connections" USING btree ("workspace_id","member_id","provider","account_email");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connections_default" ON "calendar_connections" USING btree ("workspace_id","member_id") WHERE "calendar_connections"."is_default";--> statement-breakpoint
CREATE INDEX "meeting_attendees_by_person" ON "meeting_attendees" USING btree ("workspace_id","person_record_id") WHERE "meeting_attendees"."person_record_id" is not null;--> statement-breakpoint
CREATE INDEX "meeting_records_by_record" ON "meeting_records" USING btree ("workspace_id","record_id","starts_at" DESC NULLS LAST,"meeting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_sources_event" ON "meeting_sources" USING btree ("workspace_id","connection_id","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_event" ON "meetings" USING btree ("workspace_id","ical_uid",coalesce("original_start", 'epoch'::timestamptz));--> statement-breakpoint
CREATE INDEX "meetings_by_start" ON "meetings" USING btree ("workspace_id","starts_at");
--> statement-breakpoint

-- Hand written from here.
-- The standard policy on all six: an unset workspace matches nothing, even for the owner.
alter table calendar_connections enable row level security;
--> statement-breakpoint
alter table calendar_connections force row level security;
--> statement-breakpoint
create policy calendar_connections_tenant on calendar_connections
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table meetings enable row level security;
--> statement-breakpoint
alter table meetings force row level security;
--> statement-breakpoint
create policy meetings_tenant on meetings
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table meeting_sources enable row level security;
--> statement-breakpoint
alter table meeting_sources force row level security;
--> statement-breakpoint
create policy meeting_sources_tenant on meeting_sources
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table meeting_attendees enable row level security;
--> statement-breakpoint
alter table meeting_attendees force row level security;
--> statement-breakpoint
create policy meeting_attendees_tenant on meeting_attendees
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table meeting_records enable row level security;
--> statement-breakpoint
alter table meeting_records force row level security;
--> statement-breakpoint
create policy meeting_records_tenant on meeting_records
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table calendar_settings enable row level security;
--> statement-breakpoint
alter table calendar_settings force row level security;
--> statement-breakpoint
create policy calendar_settings_tenant on calendar_settings
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- Puts a connection's sync on Graphile Worker's queue (spec 0024): how the app (the OAuth callback, and milestone 2's
-- push notification) reaches the queue for calendar sync, as crm_enqueue_job does for jobs, owned by the same
-- crm_queue. It reads the connection under the caller's workspace setting (row level security still applies,
-- crm_queue bypasses nothing), and only one that may still sync: syncing or connected. It builds the queue row
-- itself, so the caller chooses no task, payload or queue: task crm_calendar_sync, payload the workspace and
-- connection ids alone, queue calendar:<workspace>:<connection> (one sync per connection at a time), run_at (now
-- when null), 25 attempts as Graphile's backstop (the task records a provider's failure itself and schedules its
-- next run), job key crm-calendar:<workspace>:<connection> and job_key_mode 'replace', so a burst is one waiting
-- row, brought forward. Answers whether it queued. Quoted and fully qualified for the reasons crm_enqueue_job's
-- comment gives.
create function crm_enqueue_calendar_sync(connection_id uuid, run_at timestamptz default null)
  returns boolean
  language sql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
as $function$
  with connection as (
    select c.workspace_id, c.id
    from public.calendar_connections c
    where c.id = crm_enqueue_calendar_sync.connection_id
      and c.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
      and c.status in ('syncing', 'connected')
  ),
  added as materialized (
    select graphile_worker.add_job(
      identifier => 'crm_calendar_sync',
      payload => pg_catalog.json_build_object('workspaceId', connection.workspace_id, 'connectionId', connection.id),
      queue_name => 'calendar:' || connection.workspace_id::text || ':' || connection.id::text,
      run_at => coalesce(crm_enqueue_calendar_sync.run_at, pg_catalog.now()),
      max_attempts => 25,
      job_key => 'crm-calendar:' || connection.workspace_id::text || ':' || connection.id::text,
      job_key_mode => 'replace'
    ) as queued
    from connection
  )
  select count(*) = 1 from added;
$function$;
--> statement-breakpoint
revoke all on function crm_enqueue_calendar_sync(uuid, timestamptz) from public;
--> statement-breakpoint
grant execute on function crm_enqueue_calendar_sync(uuid, timestamptz) to crm_app;
--> statement-breakpoint
-- The three columns the function reads, and nothing else of the table (never the tokens).
grant select (workspace_id, id, status) on calendar_connections to crm_queue;
--> statement-breakpoint
grant crm_queue to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_queue;
--> statement-breakpoint
alter function crm_enqueue_calendar_sync(uuid, timestamptz) owner to crm_queue;
--> statement-breakpoint
revoke create on schema public from crm_queue;
--> statement-breakpoint
revoke crm_queue from current_user;
