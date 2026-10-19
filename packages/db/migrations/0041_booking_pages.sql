-- Booking pages (spec 0025, milestone 1): `booking_pages`, `booking_page_members`, `bookings` and
-- `booking_member_hours` (a member's own weekly hours and days off, which their pages may follow), with the standard
-- tenant policy on each; drizzle-kit's tables, keys and indexes, the rest hand written at the end.
--
-- The actor type gains `booking`: the records a visitor's booking writes name the booking page (AC-634). Postgres
-- refuses a new enum value used in the transaction that added it; nothing here uses it, and every table's actor rule
-- already names only the types it excludes (0039's shape), so no rule changes.
--
-- Two bookings of one host never overlap: `bookings_no_overlap` excludes confirmed bookings of the same workspace and
-- host whose `during` (the meeting widened by the page's buffers) overlap. btree_gist gives uuid its `=` in a GiST
-- index. The per host advisory lock in the booking service is the guarantee; this is the last guard if anything writes
-- around it.
--
-- The public endpoints find a page by its public key before they know the workspace: crm_booking_page_by_key(key),
-- owned by crm_booking_lookup (no login, bypasses row level security only to read three columns of booking_pages),
-- answers the workspace and page ids and nothing else, for crm_app only. The guest page finds its booking the same
-- way, by the SHA-256 of its manage token: crm_booking_by_token(hash), owned by the same role, which also reads four
-- columns of bookings, answers the workspace, page and booking ids.
--
-- The foreign keys briefly lock the tables they touch. Give up after 5 seconds rather than queue behind traffic, like
-- 0020, 0023, 0026, 0029, 0033 and 0037.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TYPE "public"."actor_type" ADD VALUE 'booking';--> statement-breakpoint
CREATE TABLE "booking_member_hours" (
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"availability" jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "booking_member_hours_pkey" PRIMARY KEY("workspace_id","member_id"),
	CONSTRAINT "booking_member_hours_created_by_actor" CHECK (("booking_member_hours"."created_by_type" is null and "booking_member_hours"."created_by_id" is null and "booking_member_hours"."created_by_member_id" is null)
      or ("booking_member_hours"."created_by_type" = 'system' and "booking_member_hours"."created_by_id" is null and "booking_member_hours"."created_by_member_id" is null)
      or ("booking_member_hours"."created_by_type" = 'member' and "booking_member_hours"."created_by_id" is not null and "booking_member_hours"."created_by_member_id" = "booking_member_hours"."created_by_id")
      or ("booking_member_hours"."created_by_type"::text not in ('member', 'system', 'calendar') and "booking_member_hours"."created_by_id" is not null and "booking_member_hours"."created_by_member_id" is null)),
	CONSTRAINT "booking_member_hours_updated_by_actor" CHECK (("booking_member_hours"."updated_by_type" is null and "booking_member_hours"."updated_by_id" is null and "booking_member_hours"."updated_by_member_id" is null)
      or ("booking_member_hours"."updated_by_type" = 'system' and "booking_member_hours"."updated_by_id" is null and "booking_member_hours"."updated_by_member_id" is null)
      or ("booking_member_hours"."updated_by_type" = 'member' and "booking_member_hours"."updated_by_id" is not null and "booking_member_hours"."updated_by_member_id" = "booking_member_hours"."updated_by_id")
      or ("booking_member_hours"."updated_by_type"::text not in ('member', 'system', 'calendar') and "booking_member_hours"."updated_by_id" is not null and "booking_member_hours"."updated_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "booking_page_members" (
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "booking_page_members_pkey" PRIMARY KEY("workspace_id","page_id","member_id"),
	CONSTRAINT "booking_page_members_position" CHECK ("booking_page_members"."position" between 0 and 7)
);
--> statement-breakpoint
CREATE TABLE "booking_pages" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"public_key" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'personal' NOT NULL,
	"owner_member_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"durations" smallint[] NOT NULL,
	"location" jsonb NOT NULL,
	"availability" jsonb NOT NULL,
	"buffer_before" smallint DEFAULT 0 NOT NULL,
	"buffer_after" smallint DEFAULT 0 NOT NULL,
	"min_notice_minutes" integer DEFAULT 0 NOT NULL,
	"window_days" smallint DEFAULT 60 NOT NULL,
	"daily_limit" smallint,
	"slot_step" smallint,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deal" jsonb,
	"status" text DEFAULT 'live' NOT NULL,
	"hours_mode" text DEFAULT 'own' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	"deleted_at" timestamp (6) with time zone,
	CONSTRAINT "booking_pages_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "booking_pages_public_key_shape" CHECK ("booking_pages"."public_key" ~ '^[A-Za-z0-9_-]{16}$'),
	CONSTRAINT "booking_pages_slug_shape" CHECK ("booking_pages"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("booking_pages"."slug") <= 60),
	CONSTRAINT "booking_pages_kind" CHECK ("booking_pages"."kind" in ('personal', 'collective', 'round_robin')),
	CONSTRAINT "booking_pages_status" CHECK ("booking_pages"."status" in ('live', 'paused')),
	CONSTRAINT "booking_pages_hours_mode" CHECK ("booking_pages"."hours_mode" in ('mine', 'own')),
	CONSTRAINT "booking_pages_title" CHECK (char_length("booking_pages"."title") between 1 and 120),
	CONSTRAINT "booking_pages_description" CHECK (char_length("booking_pages"."description") <= 2000),
	CONSTRAINT "booking_pages_durations" CHECK (cardinality("booking_pages"."durations") between 1 and 5 and "booking_pages"."durations" <@ '{15,30,45,60,90}'::smallint[]),
	CONSTRAINT "booking_pages_buffers" CHECK ("booking_pages"."buffer_before" between 0 and 60 and "booking_pages"."buffer_after" between 0 and 60),
	CONSTRAINT "booking_pages_notice" CHECK ("booking_pages"."min_notice_minutes" between 0 and 20160),
	CONSTRAINT "booking_pages_window" CHECK ("booking_pages"."window_days" between 1 and 365),
	CONSTRAINT "booking_pages_daily_limit" CHECK ("booking_pages"."daily_limit" is null or "booking_pages"."daily_limit" between 1 and 50),
	CONSTRAINT "booking_pages_slot_step" CHECK ("booking_pages"."slot_step" is null or "booking_pages"."slot_step" in (15, 30, 60)),
	CONSTRAINT "booking_pages_created_by_actor" CHECK (("booking_pages"."created_by_type" is null and "booking_pages"."created_by_id" is null and "booking_pages"."created_by_member_id" is null)
      or ("booking_pages"."created_by_type" = 'system' and "booking_pages"."created_by_id" is null and "booking_pages"."created_by_member_id" is null)
      or ("booking_pages"."created_by_type" = 'member' and "booking_pages"."created_by_id" is not null and "booking_pages"."created_by_member_id" = "booking_pages"."created_by_id")
      or ("booking_pages"."created_by_type"::text not in ('member', 'system', 'calendar') and "booking_pages"."created_by_id" is not null and "booking_pages"."created_by_member_id" is null)),
	CONSTRAINT "booking_pages_updated_by_actor" CHECK (("booking_pages"."updated_by_type" is null and "booking_pages"."updated_by_id" is null and "booking_pages"."updated_by_member_id" is null)
      or ("booking_pages"."updated_by_type" = 'system' and "booking_pages"."updated_by_id" is null and "booking_pages"."updated_by_member_id" is null)
      or ("booking_pages"."updated_by_type" = 'member' and "booking_pages"."updated_by_id" is not null and "booking_pages"."updated_by_member_id" = "booking_pages"."updated_by_id")
      or ("booking_pages"."updated_by_type"::text not in ('member', 'system', 'calendar') and "booking_pages"."updated_by_id" is not null and "booking_pages"."updated_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"page_id" uuid NOT NULL,
	"host_member_id" uuid NOT NULL,
	"starts_at" timestamp (6) with time zone NOT NULL,
	"ends_at" timestamp (6) with time zone NOT NULL,
	"during" "tstzrange" NOT NULL,
	"visitor_name" text NOT NULL,
	"visitor_email" text NOT NULL,
	"visitor_time_zone" text NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"cancel_reason" text,
	"reschedules" smallint DEFAULT 0 NOT NULL,
	"manage_token_hash" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"meeting_id" uuid,
	"video_url" text,
	"event_failed_at" timestamp (6) with time zone,
	"person_record_id" uuid,
	"company_record_id" uuid,
	"deal_record_id" uuid,
	"submission_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "bookings_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "bookings_status" CHECK ("bookings"."status" in ('confirmed', 'cancelled')),
	CONSTRAINT "bookings_times" CHECK ("bookings"."ends_at" > "bookings"."starts_at"),
	CONSTRAINT "bookings_during" CHECK (lower("bookings"."during") <= "bookings"."starts_at" and upper("bookings"."during") >= "bookings"."ends_at" and lower_inc("bookings"."during") and not upper_inc("bookings"."during")),
	CONSTRAINT "bookings_cancelled" CHECK ("bookings"."status" = 'cancelled' or "bookings"."cancel_reason" is null),
	CONSTRAINT "bookings_visitor" CHECK (char_length("bookings"."visitor_name") between 1 and 200 and char_length("bookings"."visitor_email") between 3 and 254),
	CONSTRAINT "bookings_reschedules" CHECK ("bookings"."reschedules" between 0 and 5),
	CONSTRAINT "bookings_video_url" CHECK ("bookings"."video_url" is null or char_length("bookings"."video_url") <= 2000),
	CONSTRAINT "bookings_created_by_actor" CHECK (("bookings"."created_by_type" is null and "bookings"."created_by_id" is null and "bookings"."created_by_member_id" is null)
      or ("bookings"."created_by_type" = 'system' and "bookings"."created_by_id" is null and "bookings"."created_by_member_id" is null)
      or ("bookings"."created_by_type" = 'member' and "bookings"."created_by_id" is not null and "bookings"."created_by_member_id" = "bookings"."created_by_id")
      or ("bookings"."created_by_type"::text not in ('member', 'system', 'calendar') and "bookings"."created_by_id" is not null and "bookings"."created_by_member_id" is null)),
	CONSTRAINT "bookings_updated_by_actor" CHECK (("bookings"."updated_by_type" is null and "bookings"."updated_by_id" is null and "bookings"."updated_by_member_id" is null)
      or ("bookings"."updated_by_type" = 'system' and "bookings"."updated_by_id" is null and "bookings"."updated_by_member_id" is null)
      or ("bookings"."updated_by_type" = 'member' and "bookings"."updated_by_id" is not null and "bookings"."updated_by_member_id" = "bookings"."updated_by_id")
      or ("bookings"."updated_by_type"::text not in ('member', 'system', 'calendar') and "bookings"."updated_by_id" is not null and "bookings"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "booking_member_hours" ADD CONSTRAINT "booking_member_hours_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_member_hours" ADD CONSTRAINT "booking_member_hours_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_member_hours" ADD CONSTRAINT "booking_member_hours_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_page_members" ADD CONSTRAINT "booking_page_members_page" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."booking_pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_page_members" ADD CONSTRAINT "booking_page_members_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_owner" FOREIGN KEY ("workspace_id","owner_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_page" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."booking_pages"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_host" FOREIGN KEY ("workspace_id","host_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_page_members_by_member" ON "booking_page_members" USING btree ("workspace_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_pages_public_key" ON "booking_pages" USING btree ("public_key");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_pages_slug" ON "booking_pages" USING btree ("workspace_id","slug") WHERE "booking_pages"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "booking_pages_by_owner" ON "booking_pages" USING btree ("workspace_id","owner_member_id","created_at") WHERE "booking_pages"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_attempt" ON "bookings" USING btree ("workspace_id","page_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_manage_token" ON "bookings" USING btree ("manage_token_hash");--> statement-breakpoint
CREATE INDEX "bookings_by_page" ON "bookings" USING btree ("workspace_id","page_id","starts_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "bookings_by_host" ON "bookings" USING btree ("workspace_id","host_member_id","starts_at") WHERE "bookings"."status" = 'confirmed';--> statement-breakpoint
CREATE INDEX "bookings_by_person" ON "bookings" USING btree ("workspace_id","person_record_id","created_at") WHERE "bookings"."person_record_id" is not null;--> statement-breakpoint

-- Hand written from here.
-- The standard policy on each new table: an unset workspace matches nothing, even for the owner.
alter table booking_pages enable row level security;
--> statement-breakpoint
alter table booking_pages force row level security;
--> statement-breakpoint
create policy booking_pages_tenant on booking_pages
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table booking_page_members enable row level security;
--> statement-breakpoint
alter table booking_page_members force row level security;
--> statement-breakpoint
create policy booking_page_members_tenant on booking_page_members
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table booking_member_hours enable row level security;
--> statement-breakpoint
alter table booking_member_hours force row level security;
--> statement-breakpoint
create policy booking_member_hours_tenant on booking_member_hours
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table bookings enable row level security;
--> statement-breakpoint
alter table bookings force row level security;
--> statement-breakpoint
create policy bookings_tenant on bookings
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- No double booking, whatever writes the row (AC-632).
create extension if not exists btree_gist;
--> statement-breakpoint
alter table bookings
  add constraint bookings_no_overlap
  exclude using gist (workspace_id with =, host_member_id with =, during with &&)
  where (status = 'confirmed');
--> statement-breakpoint

-- The public lookup's role: no login, no power but reading three columns of booking_pages past row level security.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_booking_lookup') then
    create role crm_booking_lookup nologin nosuperuser bypassrls nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$$;
--> statement-breakpoint
alter role crm_booking_lookup nologin bypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant usage on schema public to crm_booking_lookup;
--> statement-breakpoint
grant select (workspace_id, id, public_key) on booking_pages to crm_booking_lookup;
--> statement-breakpoint
grant select (workspace_id, id, page_id, manage_token_hash) on bookings to crm_booking_lookup;
--> statement-breakpoint

-- The workspace and page a public key names, or no row. Ids only: no title, status or hours, which the caller then
-- reads inside withWorkspace() under row level security. Hardened as crm_workspace_ids in 0034: a standard SQL body
-- bound to its table, a fixed search_path, every name qualified, the parameter by the function's name.
create function crm_booking_page_by_key(key text)
  returns table (workspace_id uuid, page_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.workspace_id, p.id
  from public.booking_pages p
  where p.public_key = crm_booking_page_by_key.key
  limit 1;
end;
--> statement-breakpoint
revoke all on function crm_booking_page_by_key(text) from public;
--> statement-breakpoint
grant execute on function crm_booking_page_by_key(text) to crm_app;
--> statement-breakpoint

-- The workspace, page and booking a manage token's hash names, or no row. Ids only, hardened the same way.
create function crm_booking_by_token(token_hash text)
  returns table (workspace_id uuid, page_id uuid, booking_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select b.workspace_id, b.page_id, b.id
  from public.bookings b
  where b.manage_token_hash = crm_booking_by_token.token_hash
  limit 1;
end;
--> statement-breakpoint
revoke all on function crm_booking_by_token(text) from public;
--> statement-breakpoint
grant execute on function crm_booking_by_token(text) to crm_app;
--> statement-breakpoint
grant crm_booking_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_booking_lookup;
--> statement-breakpoint
alter function crm_booking_page_by_key(text) owner to crm_booking_lookup;
--> statement-breakpoint
alter function crm_booking_by_token(text) owner to crm_booking_lookup;
--> statement-breakpoint
revoke create on schema public from crm_booking_lookup;
--> statement-breakpoint
revoke crm_booking_lookup from current_user;
