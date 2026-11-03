-- The Menu app, slice H1 of the Hospitality suite (spec 0065, AC-6520 to AC-6533). Numbered 0169 after H0's 0168.
--
-- What changes:
-- * Twelve tenant tables: menus and the places they show at, sections (one level of sub sections), items placed in
--   sections (an item is one thing, however many sections hold it), sizes, option groups shared between items and
--   their options, photos, the published snapshot per place (`menu_versions`) and the draft's state (`menu_drafts`:
--   the count of changes waiting for Publish and the rows as published, which Discard puts back). Each has forced row
--   level security and the plain workspace policy, and every index leads with workspace_id.
-- * `import_source` on menus, sections, items and option groups: where an imported row came from (H6), unique per
--   workspace, so importing again is idempotent.
-- * `crm_menu_lookup`, a new lookup role, and its one definer `crm_menu_by_key(key)`: the workspace and place a guest
--   menu's key names, only while the workspace is live, has Hospitality early access, and has Menu installed (AC-6504:
--   a removed app's public page answers nothing). Ids only; the guest page's read then runs inside withWorkspace()
--   under row level security. crm_app may execute it.
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "menus" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"serving" jsonb,
	"position" smallint NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_member_id" uuid,
	"import_source" text,
	CONSTRAINT "menus_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "menus_import_source" CHECK (char_length("menus"."import_source") between 1 and 200),
	CONSTRAINT "menus_name" CHECK (char_length("menus"."name") between 1 and 60),
	CONSTRAINT "menus_note" CHECK (char_length("menus"."note") <= 300),
	CONSTRAINT "menus_serving" CHECK ("menus"."serving" is null or jsonb_typeof("menus"."serving") = 'object')
);
--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Where a row came from (spec 0065, H6 import from checklabs), so importing again updates it rather than adding a copy.
CREATE UNIQUE INDEX "menus_import_source" ON "menus" USING btree ("workspace_id","import_source") WHERE "menus"."import_source" is not null;
--> statement-breakpoint
CREATE INDEX "menus_order" ON "menus" USING btree ("workspace_id","position");
--> statement-breakpoint
CREATE TABLE "menu_places" (
	"workspace_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	CONSTRAINT "menu_places_pkey" PRIMARY KEY("workspace_id","menu_id","place_id")
);
--> statement-breakpoint
ALTER TABLE "menu_places" ADD CONSTRAINT "menu_places_menu" FOREIGN KEY ("workspace_id","menu_id") REFERENCES "public"."menus"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "menu_places" ADD CONSTRAINT "menu_places_place" FOREIGN KEY ("workspace_id","place_id") REFERENCES "public"."places"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "menu_places_place" ON "menu_places" USING btree ("workspace_id","place_id");
--> statement-breakpoint
CREATE TABLE "menu_sections" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"menu_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"layout" text DEFAULT 'list' NOT NULL,
	"serving" jsonb,
	"position" smallint NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"import_source" text,
	CONSTRAINT "menu_sections_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "menu_sections_import_source" CHECK (char_length("menu_sections"."import_source") between 1 and 200),
	CONSTRAINT "menu_sections_name" CHECK (char_length("menu_sections"."name") between 1 and 60),
	CONSTRAINT "menu_sections_description" CHECK (char_length("menu_sections"."description") <= 140),
	CONSTRAINT "menu_sections_layout" CHECK ("menu_sections"."layout" in ('list', 'grid')),
	CONSTRAINT "menu_sections_serving" CHECK ("menu_sections"."serving" is null or jsonb_typeof("menu_sections"."serving") = 'object'),
	CONSTRAINT "menu_sections_not_own_parent" CHECK ("menu_sections"."parent_id" is null or "menu_sections"."parent_id" <> "menu_sections"."id")
);
--> statement-breakpoint
ALTER TABLE "menu_sections" ADD CONSTRAINT "menu_sections_menu" FOREIGN KEY ("workspace_id","menu_id") REFERENCES "public"."menus"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Where a row came from (spec 0065, H6 import from checklabs), so importing again updates it rather than adding a copy.
CREATE UNIQUE INDEX "menu_sections_import_source" ON "menu_sections" USING btree ("workspace_id","import_source") WHERE "menu_sections"."import_source" is not null;
--> statement-breakpoint
-- Deleting a section deletes its sub sections; a sub section never has one of its own (the engine refuses it).
ALTER TABLE "menu_sections" ADD CONSTRAINT "menu_sections_parent" FOREIGN KEY ("workspace_id","parent_id") REFERENCES "public"."menu_sections"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "menu_sections_order" ON "menu_sections" USING btree ("workspace_id","menu_id","position");
--> statement-breakpoint
CREATE INDEX "menu_sections_parent" ON "menu_sections" USING btree ("workspace_id","parent_id");
--> statement-breakpoint
CREATE TABLE "menu_photos" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"large_path" text NOT NULL,
	"small_path" text NOT NULL,
	"type" text NOT NULL,
	"version" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_member_id" uuid,
	CONSTRAINT "menu_photos_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "menu_photos_type" CHECK ("menu_photos"."type" in ('image/webp', 'image/jpeg', 'image/png')),
	CONSTRAINT "menu_photos_version" CHECK ("menu_photos"."version" ~ '^[0-9a-f]{12}$'),
	CONSTRAINT "menu_photos_paths" CHECK (char_length("menu_photos"."large_path") <= 300 and char_length("menu_photos"."small_path") <= 300)
);
--> statement-breakpoint
ALTER TABLE "menu_photos" ADD CONSTRAINT "menu_photos_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_minor" integer,
	"price_note" text,
	"photo_id" uuid,
	"diet" text[] DEFAULT '{}'::text[] NOT NULL,
	"allergens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"kcal" integer,
	"featured" boolean DEFAULT false NOT NULL,
	"sold_out" boolean DEFAULT false NOT NULL,
	"sold_out_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_member_id" uuid,
	"import_source" text,
	CONSTRAINT "menu_items_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "menu_items_import_source" CHECK (char_length("menu_items"."import_source") between 1 and 200),
	CONSTRAINT "menu_items_name" CHECK (char_length("menu_items"."name") between 1 and 80),
	CONSTRAINT "menu_items_description" CHECK (char_length("menu_items"."description") <= 400),
	CONSTRAINT "menu_items_price" CHECK ("menu_items"."price_minor" between 0 and 99999999),
	CONSTRAINT "menu_items_price_note" CHECK (char_length("menu_items"."price_note") <= 24),
	CONSTRAINT "menu_items_diet" CHECK (cardinality("menu_items"."diet") <= 9 and "menu_items"."diet" <@ array['vegan','vegetarian','gluten_free','dairy_free','contains_nuts','halal','spicy_1','spicy_2','spicy_3']::text[]),
	CONSTRAINT "menu_items_allergens" CHECK (jsonb_typeof("menu_items"."allergens") = 'array' and jsonb_array_length("menu_items"."allergens") <= 14),
	CONSTRAINT "menu_items_kcal" CHECK ("menu_items"."kcal" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Where a row came from (spec 0065, H6 import from checklabs), so importing again updates it rather than adding a copy.
CREATE UNIQUE INDEX "menu_items_import_source" ON "menu_items" USING btree ("workspace_id","import_source") WHERE "menu_items"."import_source" is not null;
--> statement-breakpoint
-- A deleted photo leaves its items with none (only photo_id is set null, never the workspace).
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_photo" FOREIGN KEY ("workspace_id","photo_id") REFERENCES "public"."menu_photos"("workspace_id","id") ON DELETE set null ("photo_id") ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "menu_items_sold_out" ON "menu_items" USING btree ("workspace_id") WHERE "menu_items"."sold_out";
--> statement-breakpoint
CREATE INDEX "menu_items_photo" ON "menu_items" USING btree ("workspace_id","photo_id");
--> statement-breakpoint
CREATE TABLE "menu_placements" (
	"workspace_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "menu_placements_pkey" PRIMARY KEY("workspace_id","section_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "menu_placements" ADD CONSTRAINT "menu_placements_section" FOREIGN KEY ("workspace_id","section_id") REFERENCES "public"."menu_sections"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "menu_placements" ADD CONSTRAINT "menu_placements_item" FOREIGN KEY ("workspace_id","item_id") REFERENCES "public"."menu_items"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "menu_placements_item" ON "menu_placements" USING btree ("workspace_id","item_id");
--> statement-breakpoint
CREATE TABLE "menu_item_sizes" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_minor" integer NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "menu_item_sizes_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "menu_item_sizes_name" CHECK (char_length("menu_item_sizes"."name") between 1 and 40),
	CONSTRAINT "menu_item_sizes_price" CHECK ("menu_item_sizes"."price_minor" between 0 and 99999999)
);
--> statement-breakpoint
ALTER TABLE "menu_item_sizes" ADD CONSTRAINT "menu_item_sizes_item" FOREIGN KEY ("workspace_id","item_id") REFERENCES "public"."menu_items"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "menu_item_sizes_item" ON "menu_item_sizes" USING btree ("workspace_id","item_id","position");
--> statement-breakpoint
CREATE TABLE "menu_option_groups" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"rule" text NOT NULL,
	"max" smallint,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"import_source" text,
	CONSTRAINT "menu_option_groups_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "menu_option_groups_import_source" CHECK (char_length("menu_option_groups"."import_source") between 1 and 200),
	CONSTRAINT "menu_option_groups_name" CHECK (char_length("menu_option_groups"."name") between 1 and 40),
	CONSTRAINT "menu_option_groups_rule" CHECK (("menu_option_groups"."rule" in ('one', 'any') and "menu_option_groups"."max" is null) or ("menu_option_groups"."rule" = 'up_to' and "menu_option_groups"."max" between 1 and 20))
);
--> statement-breakpoint
ALTER TABLE "menu_option_groups" ADD CONSTRAINT "menu_option_groups_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Where a row came from (spec 0065, H6 import from checklabs), so importing again updates it rather than adding a copy.
CREATE UNIQUE INDEX "menu_option_groups_import_source" ON "menu_option_groups" USING btree ("workspace_id","import_source") WHERE "menu_option_groups"."import_source" is not null;
--> statement-breakpoint
CREATE TABLE "menu_options" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_delta_minor" integer DEFAULT 0 NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "menu_options_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "menu_options_name" CHECK (char_length("menu_options"."name") between 1 and 40),
	CONSTRAINT "menu_options_price" CHECK ("menu_options"."price_delta_minor" between -99999999 and 99999999)
);
--> statement-breakpoint
ALTER TABLE "menu_options" ADD CONSTRAINT "menu_options_group" FOREIGN KEY ("workspace_id","group_id") REFERENCES "public"."menu_option_groups"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "menu_options_group" ON "menu_options" USING btree ("workspace_id","group_id","position");
--> statement-breakpoint
CREATE TABLE "menu_item_option_groups" (
	"workspace_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "menu_item_option_groups_pkey" PRIMARY KEY("workspace_id","item_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "menu_item_option_groups" ADD CONSTRAINT "menu_item_option_groups_item" FOREIGN KEY ("workspace_id","item_id") REFERENCES "public"."menu_items"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "menu_item_option_groups" ADD CONSTRAINT "menu_item_option_groups_group" FOREIGN KEY ("workspace_id","group_id") REFERENCES "public"."menu_option_groups"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "menu_item_option_groups_group" ON "menu_item_option_groups" USING btree ("workspace_id","group_id");
--> statement-breakpoint
CREATE TABLE "menu_versions" (
	"workspace_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"published_by_member_id" uuid,
	"published_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_versions_pkey" PRIMARY KEY("workspace_id","place_id","version"),
	CONSTRAINT "menu_versions_version" CHECK ("menu_versions"."version" >= 1),
	CONSTRAINT "menu_versions_snapshot" CHECK (jsonb_typeof("menu_versions"."snapshot") = 'object' and octet_length("menu_versions"."snapshot"::text) <= 4000000)
);
--> statement-breakpoint
ALTER TABLE "menu_versions" ADD CONSTRAINT "menu_versions_place" FOREIGN KEY ("workspace_id","place_id") REFERENCES "public"."places"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "menu_drafts" (
	"workspace_id" uuid NOT NULL,
	"changes" integer DEFAULT 0 NOT NULL,
	"published" jsonb,
	"published_at" timestamp (6) with time zone,
	"published_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_drafts_pkey" PRIMARY KEY("workspace_id"),
	CONSTRAINT "menu_drafts_changes" CHECK ("menu_drafts"."changes" >= 0),
	CONSTRAINT "menu_drafts_published" CHECK ("menu_drafts"."published" is null or (jsonb_typeof("menu_drafts"."published") = 'object' and octet_length("menu_drafts"."published"::text) <= 8000000))
);
--> statement-breakpoint
ALTER TABLE "menu_drafts" ADD CONSTRAINT "menu_drafts_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
alter table menus enable row level security;
--> statement-breakpoint
alter table menus force row level security;
--> statement-breakpoint
create policy menus_tenant on menus
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table menu_places enable row level security;
--> statement-breakpoint
alter table menu_places force row level security;
--> statement-breakpoint
create policy menu_places_tenant on menu_places
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table menu_sections enable row level security;
--> statement-breakpoint
alter table menu_sections force row level security;
--> statement-breakpoint
create policy menu_sections_tenant on menu_sections
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table menu_photos enable row level security;
--> statement-breakpoint
alter table menu_photos force row level security;
--> statement-breakpoint
create policy menu_photos_tenant on menu_photos
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table menu_items enable row level security;
--> statement-breakpoint
alter table menu_items force row level security;
--> statement-breakpoint
create policy menu_items_tenant on menu_items
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table menu_placements enable row level security;
--> statement-breakpoint
alter table menu_placements force row level security;
--> statement-breakpoint
create policy menu_placements_tenant on menu_placements
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table menu_item_sizes enable row level security;
--> statement-breakpoint
alter table menu_item_sizes force row level security;
--> statement-breakpoint
create policy menu_item_sizes_tenant on menu_item_sizes
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table menu_option_groups enable row level security;
--> statement-breakpoint
alter table menu_option_groups force row level security;
--> statement-breakpoint
create policy menu_option_groups_tenant on menu_option_groups
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table menu_options enable row level security;
--> statement-breakpoint
alter table menu_options force row level security;
--> statement-breakpoint
create policy menu_options_tenant on menu_options
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table menu_item_option_groups enable row level security;
--> statement-breakpoint
alter table menu_item_option_groups force row level security;
--> statement-breakpoint
create policy menu_item_option_groups_tenant on menu_item_option_groups
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table menu_versions enable row level security;
--> statement-breakpoint
alter table menu_versions force row level security;
--> statement-breakpoint
create policy menu_versions_tenant on menu_versions
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table menu_drafts enable row level security;
--> statement-breakpoint
alter table menu_drafts force row level security;
--> statement-breakpoint
create policy menu_drafts_tenant on menu_drafts
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_menu_lookup') then
    create role crm_menu_lookup nologin nosuperuser bypassrls nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$$;
--> statement-breakpoint
alter role crm_menu_lookup nologin bypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant usage on schema public to crm_menu_lookup;
--> statement-breakpoint
grant select (workspace_id, id, menu_key) on places to crm_menu_lookup;
--> statement-breakpoint
grant select (workspace_id, app, removed_at) on workspace_apps to crm_menu_lookup;
--> statement-breakpoint
grant select (id, deleted_at, early_access) on workspaces to crm_menu_lookup;
--> statement-breakpoint
-- The workspace and place a guest menu's key names (spec 0065, AC-6528), or no row: only while the workspace is live,
-- Timefix's early access is open for it and Menu is installed (AC-6504). Ids only: no name, hours or snapshot, which
-- the caller then reads inside withWorkspace() under row level security. A standard SQL body bound to its tables, a
-- fixed search_path, every name qualified, the parameter by the function's name.
create function crm_menu_by_key(key text)
  returns table (workspace_id uuid, place_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.workspace_id, p.id
  from public.places p
  join public.workspaces w on w.id = p.workspace_id
  join public.workspace_apps a on a.workspace_id = p.workspace_id and a.app = 'menu'
  where p.menu_key = crm_menu_by_key.key
    and w.deleted_at is null
    and 'business_apps' = any(w.early_access)
    and a.removed_at is null
  limit 1;
end;
--> statement-breakpoint
revoke all on function crm_menu_by_key(text) from public;
--> statement-breakpoint
grant execute on function crm_menu_by_key(text) to crm_app;
--> statement-breakpoint
grant crm_menu_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_menu_lookup;
--> statement-breakpoint
alter function crm_menu_by_key(text) owner to crm_menu_lookup;
--> statement-breakpoint
revoke create on schema public from crm_menu_lookup;
--> statement-breakpoint
revoke crm_menu_lookup from current_user;
--> statement-breakpoint
-- Refuse to finish unless the lookup is as narrow as it reads: owned by crm_menu_lookup, executable by it and crm_app
-- alone, out of the identity login's reach, and crm_menu_lookup a plain role in no role, holding nothing but its
-- nine columns.
do $$
declare
  lookup constant regprocedure := 'public.crm_menu_by_key(text)'::regprocedure;
begin
  if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = lookup) <> 'crm_menu_lookup'
    or exists (
      select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid = lookup and a.privilege_type = 'EXECUTE'
        and a.grantee not in ('crm_menu_lookup'::regrole, 'crm_app'::regrole)
    )
    or has_function_privilege('crm_identity', lookup, 'EXECUTE') then
    raise exception 'crm_menu_by_key must be owned by crm_menu_lookup and executable by crm_app alone';
  end if;
  if exists (
    select 1 from pg_auth_members m where m.member = 'crm_menu_lookup'::regrole
  ) or pg_has_role('crm_app', 'crm_menu_lookup', 'MEMBER')
    or pg_has_role('crm_identity', 'crm_menu_lookup', 'MEMBER')
    or exists (
      select 1 from pg_roles
      where rolname = 'crm_menu_lookup' and (rolsuper or rolreplication or rolcreatedb or rolcreaterole or rolcanlogin
        or not rolbypassrls)
    ) then
    raise exception 'crm_menu_lookup must be a plain role in no role';
  end if;
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(privilege)
    where c.relkind in ('r', 'p', 'v', 'm', 'f')
      and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_toast%'
      and has_table_privilege('crm_menu_lookup', c.oid, p.privilege)
  ) or exists (
    select 1
    from pg_attribute att
    cross join lateral aclexplode(att.attacl) a
    where a.grantee = 'crm_menu_lookup'::regrole
      and not (a.privilege_type = 'SELECT' and (
        (att.attrelid = 'public.places'::regclass and att.attname in ('workspace_id', 'id', 'menu_key'))
        or (att.attrelid = 'public.workspace_apps'::regclass and att.attname in ('workspace_id', 'app', 'removed_at'))
        or (att.attrelid = 'public.workspaces'::regclass and att.attname in ('id', 'deleted_at', 'early_access'))))
  ) then
    raise exception 'crm_menu_lookup may only read the nine columns its lookup names';
  end if;
end
$$;
