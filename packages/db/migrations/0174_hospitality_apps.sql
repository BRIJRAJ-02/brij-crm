-- The Hospitality suite, slice H0 (spec 0065, AC-6501 to AC-6511): installable apps behind Timefix's early access,
-- the business profile, its places with opening hours, and each place's areas and tables. Numbered 0168 after main's
-- 0165, with 0166 and 0167 claimed by other lanes.
--
-- What changes:
-- * `workspaces.early_access`, a closed list of flags (`business_apps` today: the business apps, Hospitality first), written only by the operator console's
--   first write: `crm_set_early_access`, a definer owned by crm_operator, which may update that column and nothing
--   else (column privileges, so Postgres refuses any other whatever a body says). crm_app may execute it; the api
--   calls it only from its operator module, behind OPERATOR_EMAILS, two factor and a recent sign in.
-- * `crm_operator_workspaces` answers each workspace's early access too, so the console shows the switch's state;
--   crm_operator gains select on that one column.
-- * `auth.operator_event` gains `before` and `after`, so a console write keeps what it changed (AC-6502).
-- * Five tenant tables: `workspace_apps`, `business_profiles`, `places`, `areas` and `resources` (what a place books or
--   seats: tables, rooms, chairs, beds, courts; the shared base of every business app), each with forced
--   row level security and the plain workspace policy; every index leads with workspace_id, but the places' two
--   public keys, which a guest page finds before the workspace is known (H1, H3).
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
alter table workspaces add column early_access text[] not null default '{}'::text[];
--> statement-breakpoint
alter table workspaces add constraint workspaces_early_access check (early_access <@ array['business_apps']::text[]);
--> statement-breakpoint
-- The app keeps updating every other column of a workspace, but never its early access: its table wide update (from
-- the default privileges) becomes one on each column but that one.
do $$
declare
  columns text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into columns
  from pg_attribute a
  where a.attrelid = 'public.workspaces'::regclass and a.attnum > 0 and not a.attisdropped
    and a.attname <> 'early_access';
  execute 'revoke update on public.workspaces from crm_app';
  execute format('grant update (%s) on public.workspaces to crm_app', columns);
end
$$;
--> statement-breakpoint
alter table auth.operator_event
  add column before jsonb,
  add column after jsonb;
--> statement-breakpoint
alter table auth.operator_event add constraint operator_event_change check (
  (before is null or (jsonb_typeof(before) = 'object' and octet_length(before::text) <= 2000))
  and (after is null or (jsonb_typeof(after) = 'object' and octet_length(after::text) <= 2000))
);
--> statement-breakpoint
CREATE TABLE "workspace_apps" (
	"workspace_id" uuid NOT NULL,
	"app" text NOT NULL,
	"installed_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"installed_by_member_id" uuid,
	"removed_at" timestamp (6) with time zone,
	"plan" text,
	CONSTRAINT "workspace_apps_pkey" PRIMARY KEY("workspace_id","app"),
	CONSTRAINT "workspace_apps_app" CHECK ("workspace_apps"."app" in ('menu', 'menu_qr', 'table_seating')),
	CONSTRAINT "workspace_apps_plan" CHECK ("workspace_apps"."plan" is null or char_length("workspace_apps"."plan") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "workspace_apps" ADD CONSTRAINT "workspace_apps_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_apps" ADD CONSTRAINT "workspace_apps_installed_by" FOREIGN KEY ("workspace_id","installed_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workspace_apps_installed_by" ON "workspace_apps" USING btree ("workspace_id","installed_by_member_id");
--> statement-breakpoint
CREATE TABLE "business_profiles" (
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	"phone" text,
	"email" text,
	"website" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_member_id" uuid,
	CONSTRAINT "business_profiles_pkey" PRIMARY KEY("workspace_id"),
	CONSTRAINT "business_profiles_name" CHECK (char_length("business_profiles"."name") between 1 and 80),
	CONSTRAINT "business_profiles_kind" CHECK ("business_profiles"."kind" in ('restaurant', 'cafe', 'bar', 'bakery', 'salon', 'spa', 'barber', 'clinic', 'fitness', 'other')),
	CONSTRAINT "business_profiles_description" CHECK (char_length("business_profiles"."description") <= 160),
	CONSTRAINT "business_profiles_phone" CHECK (char_length("business_profiles"."phone") <= 40),
	CONSTRAINT "business_profiles_email" CHECK (char_length("business_profiles"."email") <= 254),
	CONSTRAINT "business_profiles_website" CHECK (char_length("business_profiles"."website") <= 2048),
	CONSTRAINT "business_profiles_links" CHECK (jsonb_typeof("business_profiles"."links") = 'array' and jsonb_array_length("business_profiles"."links") <= 10)
);
--> statement-breakpoint
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "places" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"address_line" text,
	"city" text,
	"postcode" text,
	"country" text NOT NULL,
	"time_zone" text NOT NULL,
	"locale" text NOT NULL,
	"phone" text,
	"hours" jsonb DEFAULT '{"weekly":{},"exceptions":[]}'::jsonb NOT NULL,
	"public_key" text NOT NULL,
	"menu_key" text NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_member_id" uuid,
	CONSTRAINT "places_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "places_name" CHECK (char_length("places"."name") between 1 and 80),
	CONSTRAINT "places_address" CHECK (char_length("places"."address_line") <= 200 and char_length("places"."city") <= 100
      and char_length("places"."postcode") <= 20),
	CONSTRAINT "places_country" CHECK ("places"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "places_time_zone" CHECK (char_length("places"."time_zone") between 1 and 64),
	CONSTRAINT "places_locale" CHECK ("places"."locale" ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
	CONSTRAINT "places_phone" CHECK (char_length("places"."phone") <= 40),
	CONSTRAINT "places_hours" CHECK (jsonb_typeof("places"."hours") = 'object' and "places"."hours" ? 'weekly' and "places"."hours" ? 'exceptions'),
	CONSTRAINT "places_public_key" CHECK ("places"."public_key" ~ '^[A-Za-z0-9_-]{16}$'),
	CONSTRAINT "places_menu_key" CHECK ("places"."menu_key" ~ '^[A-Za-z0-9_-]{16}$'),
	CONSTRAINT "places_position" CHECK ("places"."position" between 0 and 19)
);
--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "places_public_key" ON "places" USING btree ("public_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "places_menu_key" ON "places" USING btree ("menu_key");
--> statement-breakpoint
CREATE INDEX "places_order" ON "places" USING btree ("workspace_id","position");
--> statement-breakpoint
CREATE TABLE "areas" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"place_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_member_id" uuid,
	CONSTRAINT "areas_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "areas_name_length" CHECK (char_length("areas"."name") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_place" FOREIGN KEY ("workspace_id","place_id") REFERENCES "public"."places"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "areas_name" ON "areas" USING btree ("workspace_id","place_id",lower("name"));
--> statement-breakpoint
CREATE TABLE "resources" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"place_id" uuid NOT NULL,
	"area_id" uuid,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"min_capacity" smallint NOT NULL,
	"max_capacity" smallint NOT NULL,
	"online" boolean DEFAULT true NOT NULL,
	"position" integer NOT NULL,
	"joins" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"archived_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_member_id" uuid,
	CONSTRAINT "resources_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "resources_kind" CHECK ("resources"."kind" in ('table', 'room', 'chair', 'bed', 'court', 'station', 'equipment', 'other')),
	CONSTRAINT "resources_label_length" CHECK (char_length("resources"."label") between 1 and 12),
	CONSTRAINT "resources_capacity" CHECK ("resources"."min_capacity" between 1 and 100 and "resources"."max_capacity" between 1 and 100 and "resources"."min_capacity" <= "resources"."max_capacity"),
	CONSTRAINT "resources_joins" CHECK (cardinality("resources"."joins") <= 10 and not ("resources"."id" = any("resources"."joins")))
);
--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_place" FOREIGN KEY ("workspace_id","place_id") REFERENCES "public"."places"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Deleting an area leaves its tables in the place with no area (only area_id is set null, never the workspace).
ALTER TABLE "resources" ADD CONSTRAINT "resources_area" FOREIGN KEY ("workspace_id","area_id") REFERENCES "public"."areas"("workspace_id","id") ON DELETE set null ("area_id") ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "resources_label" ON "resources" USING btree ("workspace_id","place_id",lower("label")) WHERE "resources"."archived_at" is null;
--> statement-breakpoint
CREATE INDEX "resources_order" ON "resources" USING btree ("workspace_id","place_id","position");
--> statement-breakpoint
CREATE INDEX "resources_area" ON "resources" USING btree ("workspace_id","area_id");
--> statement-breakpoint
alter table workspace_apps enable row level security;
--> statement-breakpoint
alter table workspace_apps force row level security;
--> statement-breakpoint
create policy workspace_apps_tenant on workspace_apps
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table business_profiles enable row level security;
--> statement-breakpoint
alter table business_profiles force row level security;
--> statement-breakpoint
create policy business_profiles_tenant on business_profiles
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table places enable row level security;
--> statement-breakpoint
alter table places force row level security;
--> statement-breakpoint
create policy places_tenant on places
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table areas enable row level security;
--> statement-breakpoint
alter table areas force row level security;
--> statement-breakpoint
create policy areas_tenant on areas
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table resources enable row level security;
--> statement-breakpoint
alter table resources force row level security;
--> statement-breakpoint
create policy resources_tenant on resources
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- The console reads each workspace's flags, and its one write changes that column alone.
grant select (early_access), update (early_access) on workspaces to crm_operator;
--> statement-breakpoint
-- The workspace function answers the early access flags too (a new column, so it is made again).
drop function crm_operator_workspaces(uuid[]);
--> statement-breakpoint
-- Per workspace (at most 200 ids): its name, address, when it was made and deleted, its active members, its live
-- records, counted to 100,001 at most (the console shows "100,000+"), and what Timefix opened early for it.
create function crm_operator_workspaces(ids uuid[])
  returns table (
    workspace_id uuid, name text, slug text, created_at timestamptz, deleted_at timestamptz,
    members integer, records integer, early_access text[]
  )
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 200
begin atomic
  select w.id, w.name, w.slug, w.created_at, w.deleted_at,
    (select count(*)::integer from public.members m where m.workspace_id = w.id and m.status = 'active'),
    (select count(*)::integer from (
      select 1 from public.records r where r.workspace_id = w.id and r.deleted_at is null limit 100001
    ) c),
    w.early_access
  from public.workspaces w
  where w.id = any(crm_operator_workspaces.ids[1:200]);
end;
--> statement-breakpoint
-- The operator console's one write (spec 0065, AC-6502): turns `flag` on or off for one workspace and answers its
-- flags before and after, in the order of the closed list. A flag outside the list, or a workspace that isn't there,
-- answers no row and changes nothing. The row is locked, so two switches at once queue rather than lose one.
create function crm_set_early_access(workspace uuid, flag text, turn_on boolean)
  returns table (before text[], after text[])
  language sql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  with was as (
    select w.id, w.early_access
    from public.workspaces w
    where w.id = crm_set_early_access.workspace
      and crm_set_early_access.flag = any(array['business_apps']::text[])
      and crm_set_early_access.turn_on is not null
    for update
  )
  update public.workspaces w
  set early_access = array(
    select f from unnest(array['business_apps']::text[]) with ordinality as l(f, n)
    where (f = any(was.early_access) and f <> crm_set_early_access.flag)
      or (f = crm_set_early_access.flag and crm_set_early_access.turn_on)
    order by n
  )
  from was
  where w.id = was.id
  returning was.early_access, w.early_access;
end;
--> statement-breakpoint
revoke all on function crm_operator_workspaces(uuid[]) from public;
--> statement-breakpoint
revoke all on function crm_set_early_access(uuid, text, boolean) from public;
--> statement-breakpoint
grant execute on function crm_operator_workspaces(uuid[]) to crm_app;
--> statement-breakpoint
grant execute on function crm_set_early_access(uuid, text, boolean) to crm_app;
--> statement-breakpoint
grant crm_operator to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_operator;
--> statement-breakpoint
alter function crm_operator_workspaces(uuid[]) owner to crm_operator;
--> statement-breakpoint
alter function crm_set_early_access(uuid, text, boolean) owner to crm_operator;
--> statement-breakpoint
revoke create on schema public from crm_operator;
--> statement-breakpoint
revoke crm_operator from current_user;
--> statement-breakpoint
-- Refuse to finish unless crm_operator is still as narrow as it reads: its seven functions its own, definers with a
-- standard body and the fixed search path, executable only by crm_app; no table privilege; and on workspaces no
-- update but early_access.
do $$
declare
  owned integer;
begin
  select count(*) into owned from pg_proc p where pg_get_userbyid(p.proowner) = 'crm_operator';
  if owned <> 7 or exists (
    select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
    where pg_get_userbyid(p.proowner) = 'crm_operator' and a.privilege_type = 'EXECUTE'
      and a.grantee not in ('crm_operator'::regrole, 'crm_app'::regrole)
  ) or exists (
    select 1 from pg_proc p
    where pg_get_userbyid(p.proowner) = 'crm_operator'
      and (not p.prosecdef or p.prosqlbody is null or p.proconfig <> array['search_path=pg_catalog, pg_temp'])
  ) or exists (
    select 1 from information_schema.role_table_grants g where g.grantee = 'crm_operator'
  ) or exists (
    select 1 from pg_attribute att cross join lateral aclexplode(att.attacl) a
    where a.grantee = 'crm_operator'::regrole and a.privilege_type <> 'SELECT'
      and not (att.attrelid = 'public.workspaces'::regclass and att.attname = 'early_access'
        and a.privilege_type = 'UPDATE')
  ) then
    raise exception '0168_hospitality_apps: crm_operator must own exactly its seven functions and update only early_access';
  end if;
end
$$;
