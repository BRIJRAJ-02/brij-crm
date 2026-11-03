-- The business page (spec 0066 B4 lite, owner priority R1 in spec 0068): a workspace's public page at
-- `timefix.com/<company-handle>` and each place at `/<company-handle>/<place-slug>`. Numbered 0175, with 0166 to 0174
-- claimed by other lanes.
--
-- What changes:
-- * `auth.public_handles` holds businesses too (0066, Rules settled: Handles): `owner_kind` is `member` or `business`.
--   A member's handle keeps 0122's rule (a person, or released with its time); a business handle names no person,
--   is never released by an account going, and carries its workspace, so its history belongs to the workspace and
--   survives any member leaving. It is never counted toward a person's 20 (`crm_make_handle_room` and the claims
--   count by `user_id`, which a business row never has). Since every claim already refuses a handle anybody holds,
--   a business handle is refused to every person and the other way round, with no change to their definers.
-- * `crm_business_handle_owner(handle)`: the business branch of the handle lookup, beside `crm_handle_owner` rather
--   than inside it, because every reader of that one takes its `user_id` as a person and must never be handed a
--   business row. It answers the workspace a current or old business handle names; the page itself is then read
--   inside that workspace, under its row level security.
-- * `crm_claim_business_handle(workspace, handle)`: claims a handle for the transaction's own workspace (never
--   another's), keeps every old one as history, at most 20 a workspace; a taken one raises 23505 on
--   public_handles_pkey, as a person's claim does.
-- * `auth.business_listings`, one row per published, listed business: its handle and the slugs of the places search
--   engines may list, written only by `crm_list_business` (its own workspace, its own handle) and read only by
--   `crm_sitemap_businesses`, so `sitemap-handles.xml` lists businesses without reading any tenant table.
-- * Four tenant tables, each with forced row level security and the plain workspace policy, every index led by
--   workspace_id: `business_pages` (one per workspace: the current handle, the draft and the published snapshot,
--   spec 0068's pattern, kept here until the shared one lands), `business_photos` (the gallery's pictures, under the
--   server's own path), `place_pages` (each place's current slug) and `place_slugs` (every slug a place has held, so
--   an old address still finds it; unique per workspace, and never a reserved second segment).
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
alter table auth.public_handles add column owner_kind text not null default 'member';
--> statement-breakpoint
alter table auth.public_handles add constraint public_handles_owner_kind check (owner_kind in ('member', 'business'));
--> statement-breakpoint
alter table auth.public_handles drop constraint public_handles_released;
--> statement-breakpoint
alter table auth.public_handles add constraint public_handles_released check (
  (owner_kind = 'member' and (user_id is null) = (released_at is not null))
  or (owner_kind = 'business' and user_id is null and released_at is null)
);
--> statement-breakpoint
create index public_handles_business on auth.public_handles using btree (workspace_id) where owner_kind = 'business';
--> statement-breakpoint
create table auth.business_listings (
  workspace_id uuid not null,
  handle text not null,
  places text[] not null default '{}'::text[],
  changed_at timestamp (6) with time zone not null default now(),
  constraint business_listings_pkey primary key (workspace_id),
  constraint business_listings_handle_fk foreign key (handle) references auth.public_handles (handle) on delete cascade,
  constraint business_listings_places check (cardinality(places) <= 20)
);
--> statement-breakpoint
create unique index business_listings_handle on auth.business_listings using btree (handle);
--> statement-breakpoint
grant select, insert, update, delete on auth.business_listings to crm_handle;
--> statement-breakpoint
CREATE TABLE "business_pages" (
	"workspace_id" uuid NOT NULL,
	"handle" text,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_changed_at" timestamp (6) with time zone,
	"published" jsonb,
	"published_at" timestamp (6) with time zone,
	"published_by_member_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_member_id" uuid,
	CONSTRAINT "business_pages_pkey" PRIMARY KEY("workspace_id"),
	CONSTRAINT "business_pages_handle" CHECK ("business_pages"."handle" is null or ("business_pages"."handle" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("business_pages"."handle") between 3 and 40)),
	CONSTRAINT "business_pages_draft" CHECK (jsonb_typeof("business_pages"."draft") = 'object' and octet_length("business_pages"."draft"::text) <= 32768),
	CONSTRAINT "business_pages_published" CHECK ("business_pages"."published" is null or (jsonb_typeof("business_pages"."published") = 'object' and octet_length("business_pages"."published"::text) <= 32768)),
	CONSTRAINT "business_pages_live" CHECK (("business_pages"."published" is null) = ("business_pages"."published_at" is null)),
	CONSTRAINT "business_pages_version" CHECK ("business_pages"."version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "business_pages" ADD CONSTRAINT "business_pages_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "business_pages" ADD CONSTRAINT "business_pages_published_by" FOREIGN KEY ("workspace_id","published_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "business_pages_published_by" ON "business_pages" USING btree ("workspace_id","published_by_member_id");
--> statement-breakpoint
CREATE TABLE "business_photos" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"path" text NOT NULL,
	"type" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_member_id" uuid,
	CONSTRAINT "business_photos_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "business_photos_path" CHECK ("business_photos"."path" = 'business-page/' || "business_photos"."workspace_id"::text || '/' || "business_photos"."id"::text || case "business_photos"."type" when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end),
	CONSTRAINT "business_photos_type" CHECK ("business_photos"."type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "business_photos_size" CHECK ("business_photos"."bytes" between 1 and 4194304 and "business_photos"."width" between 1 and 4096 and "business_photos"."height" between 1 and 4096)
);
--> statement-breakpoint
ALTER TABLE "business_photos" ADD CONSTRAINT "business_photos_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "business_photos" ADD CONSTRAINT "business_photos_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "business_photos_created" ON "business_photos" USING btree ("workspace_id","created_at");
--> statement-breakpoint
CREATE INDEX "business_photos_created_by" ON "business_photos" USING btree ("workspace_id","created_by_member_id");
--> statement-breakpoint
CREATE TABLE "place_pages" (
	"workspace_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_pages_pkey" PRIMARY KEY("workspace_id","place_id")
);
--> statement-breakpoint
ALTER TABLE "place_pages" ADD CONSTRAINT "place_pages_place" FOREIGN KEY ("workspace_id","place_id") REFERENCES "public"."places"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "place_slugs" (
	"workspace_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"place_id" uuid NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_slugs_pkey" PRIMARY KEY("workspace_id","slug"),
	CONSTRAINT "place_slugs_shape" CHECK ("place_slugs"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("place_slugs"."slug") between 1 and 60),
	CONSTRAINT "place_slugs_reserved" CHECK ("place_slugs"."slug" not in ('book', 'reserve', 'visit', 'menu', 'e', 'events', 'team', 'reviews', 'services'))
);
--> statement-breakpoint
ALTER TABLE "place_slugs" ADD CONSTRAINT "place_slugs_place" FOREIGN KEY ("workspace_id","place_id") REFERENCES "public"."places"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "place_slugs_place" ON "place_slugs" USING btree ("workspace_id","place_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "place_slugs_owner" ON "place_slugs" USING btree ("workspace_id","slug","place_id");
--> statement-breakpoint
-- A place's current slug is always one of its own held slugs, so the current one is unique per workspace too.
ALTER TABLE "place_pages" ADD CONSTRAINT "place_pages_slug" FOREIGN KEY ("workspace_id","slug","place_id") REFERENCES "public"."place_slugs"("workspace_id","slug","place_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "place_pages_slug_once" ON "place_pages" USING btree ("workspace_id","slug");
--> statement-breakpoint
alter table business_pages enable row level security;
--> statement-breakpoint
alter table business_pages force row level security;
--> statement-breakpoint
create policy business_pages_tenant on business_pages
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table business_photos enable row level security;
--> statement-breakpoint
alter table business_photos force row level security;
--> statement-breakpoint
create policy business_photos_tenant on business_photos
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table place_pages enable row level security;
--> statement-breakpoint
alter table place_pages force row level security;
--> statement-breakpoint
create policy place_pages_tenant on place_pages
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table place_slugs enable row level security;
--> statement-breakpoint
alter table place_slugs force row level security;
--> statement-breakpoint
create policy place_slugs_tenant on place_slugs
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- The workspace a business handle names, by its current or an old handle, or no row. Never a person's handle: those
-- go through crm_handle_owner, which never answers a business.
create function crm_business_handle_owner(wanted text)
  returns table (workspace_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select h.workspace_id
  from auth.public_handles h
  where h.handle = crm_business_handle_owner.wanted and h.owner_kind = 'business'
  limit 1;
end;
--> statement-breakpoint
-- Claims `wanted` for `workspace`'s business, which must be the transaction's own (`app.workspace_id`). A handle the
-- business already held (current or old) is its own again; one anybody else holds raises 23505 on
-- public_handles_pkey; a workspace holds at most 20 (every old one included), past that BUSINESS_HANDLE_LIMIT. The
-- shape is checked here too; reserved words are the app's to refuse, as for a person.
create function crm_claim_business_handle(workspace uuid, wanted text)
  returns text
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  holder_kind text;
  holder_workspace uuid;
begin
  if wanted is null or wanted !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or pg_catalog.char_length(wanted) not between 3 and 40 then
    raise exception using errcode = '22023', message = 'BUSINESS_HANDLE_SHAPE';
  end if;
  if workspace is null
    or workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    raise exception using errcode = '42501', message = 'BUSINESS_HANDLE_WORKSPACE';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_business_handle:' || workspace::text, 0));
  select h.owner_kind, h.workspace_id into holder_kind, holder_workspace
  from auth.public_handles h where h.handle = wanted;
  if found then
    if holder_kind = 'business' and holder_workspace = workspace then
      return wanted;
    end if;
    raise exception using errcode = '23505', constraint = 'public_handles_pkey', message = 'PROFILE_HANDLE_TAKEN';
  end if;
  if (select pg_catalog.count(*) from auth.public_handles h
      where h.workspace_id = workspace and h.owner_kind = 'business') >= 20 then
    raise exception using errcode = 'P0001', message = 'BUSINESS_HANDLE_LIMIT';
  end if;
  insert into auth.public_handles (handle, user_id, workspace_id, owner_kind)
  values (wanted, null, workspace, 'business')
  on conflict (handle) do nothing;
  if not found then
    raise exception using errcode = '23505', constraint = 'public_handles_pkey', message = 'PROFILE_HANDLE_TAKEN';
  end if;
  return wanted;
end;
$$;
--> statement-breakpoint
-- Lists (`listed`) or unlists `workspace`'s business for search engines: its current `handle` and the slugs of the
-- places that may be listed. Only the transaction's own workspace, and only a business handle it holds; answers
-- whether the business is listed after the call.
create function crm_list_business(workspace uuid, wanted text, place_slugs text[], listed boolean)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
begin
  if workspace is null
    or workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    return false;
  end if;
  if not coalesce(listed, false) or wanted is null then
    delete from auth.business_listings l where l.workspace_id = workspace;
    return false;
  end if;
  if not exists (select 1 from auth.public_handles h
      where h.handle = wanted and h.owner_kind = 'business' and h.workspace_id = workspace) then
    delete from auth.business_listings l where l.workspace_id = workspace;
    return false;
  end if;
  if place_slugs is null or pg_catalog.cardinality(place_slugs) > 20 or exists (
      select 1 from pg_catalog.unnest(place_slugs) s(slug)
      where s.slug is null or s.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or pg_catalog.char_length(s.slug) > 60) then
    raise exception using errcode = '22023', message = 'BUSINESS_LISTING_PLACES';
  end if;
  insert into auth.business_listings (workspace_id, handle, places, changed_at)
  values (workspace, wanted, place_slugs, pg_catalog.now())
  on conflict (workspace_id) do update set handle = excluded.handle, places = excluded.places, changed_at = excluded.changed_at;
  return true;
end;
$$;
--> statement-breakpoint
-- The listed businesses (sitemap-handles.xml): each handle with its listed places' slugs and its last change, by
-- handle after `after`, at most `max` (50,000).
create function crm_sitemap_businesses(after text, max integer)
  returns table (handle text, places text[], changed_at timestamptz)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select l.handle, l.places, l.changed_at
  from auth.business_listings l
  where crm_sitemap_businesses.after is null or l.handle collate "C" > crm_sitemap_businesses.after collate "C"
  order by l.handle collate "C"
  limit least(greatest(crm_sitemap_businesses.max, 1), 50000);
end;
--> statement-breakpoint
revoke all on function crm_business_handle_owner(text) from public;
--> statement-breakpoint
revoke all on function crm_claim_business_handle(uuid, text) from public;
--> statement-breakpoint
revoke all on function crm_list_business(uuid, text, text[], boolean) from public;
--> statement-breakpoint
revoke all on function crm_sitemap_businesses(text, integer) from public;
--> statement-breakpoint
grant execute on function crm_business_handle_owner(text) to crm_app;
--> statement-breakpoint
grant execute on function crm_claim_business_handle(uuid, text) to crm_app;
--> statement-breakpoint
grant execute on function crm_list_business(uuid, text, text[], boolean) to crm_app;
--> statement-breakpoint
grant execute on function crm_sitemap_businesses(text, integer) to crm_app;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
-- Each owned by crm_handle and executable by crm_app alone, said here so a migration that breaks it never lands.
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.crm_business_handle_owner(text)'::regprocedure,
    'public.crm_claim_business_handle(uuid, text)'::regprocedure,
    'public.crm_list_business(uuid, text, text[], boolean)'::regprocedure,
    'public.crm_sitemap_businesses(text, integer)'::regprocedure
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = fn) <> 'crm_handle'
      or not (select p.prosecdef from pg_proc p where p.oid = fn)
      or exists (
        select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
        where p.oid = fn and a.privilege_type = 'EXECUTE'
          and a.grantee not in ('crm_handle'::regrole, 'crm_app'::regrole)
      )
      or has_function_privilege('crm_identity', fn, 'EXECUTE')
      or not has_function_privilege('crm_app', fn, 'EXECUTE') then
      raise exception '% must be owned by crm_handle and executable by crm_app alone', fn;
    end if;
  end loop;
  if has_table_privilege('crm_app', 'auth.business_listings', 'SELECT')
    or has_table_privilege('crm_app', 'auth.business_listings', 'INSERT') then
    raise exception 'crm_app must reach auth.business_listings only through its definers';
  end if;
end
$$;
