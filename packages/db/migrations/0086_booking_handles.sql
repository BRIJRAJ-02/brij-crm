-- Public booking addresses (owner decision, 22 Oct 2026; side lane handles), the Calendly and Cal.com way: each
-- person has a handle, their profile lives at `/<handle>` and each booking page at `/<handle>/<slug>`.
--
-- `auth.public_handles` holds every handle a person has held, their current one included, keyed by the handle
-- alone: unique across every workspace, an old handle keeps finding its person (the public page moves to the
-- current one), and none is freed while its person exists (it goes with them, by the foreign key's cascade).
-- `auth.public_profiles` holds the current handle and a one line bio. Which words can't be handles (every top level
-- path the app serves) is the contracts' `RESERVED_HANDLES`, checked by the service: a new reserved word then needs
-- no migration.
--
-- A booking page's slug becomes unique per owner across workspaces, so `/<handle>/<slug>` names one page:
-- `booking_pages.owner_user_id` is the owner member's identity, kept by the trigger crm_booking_pages_owner_user
-- from `members.user_id` (the invoker's own row level security applies: same workspace only), and
-- `booking_pages_owner_slug` holds it. The old per workspace slug index becomes per owner member, which a page
-- whose owner has no identity still needs. Existing pages are backfilled, and a slug one person holds in two
-- workspaces is made unique (the later page's gains a short suffix; no address used it yet).
-- `profile_section` and `profile_position` place a Public page on its owner's profile.
--
-- Two ways in, hand written, each a definer that answers as little as its caller needs:
-- * crm_handle (can't log in, no bypass, only what its functions need on schema auth), executable by crm_app:
--   crm_save_public_profile(user, handle, bio) claims a handle and sets the bio (23505 on public_handles_pkey for
--   one another person holds; 54000 PUBLIC_HANDLE_LIMIT past 20 held); crm_public_profiles_of(users) answers
--   handles and bios; crm_handle_owner(handle) answers the person a handle (current or old) names: their id,
--   current handle, bio, name and picture, never an email.
-- * crm_booking_lookup (0041's), three more readers of booking_pages past row level security, ids only:
--   crm_booking_page_by_address(user, slug), crm_booking_profile_pages(user, after, search, max) (a profile's
--   Public live pages, in its order, at most 50) and crm_booking_owner_slugs(user, prefix) (the slugs a person's
--   pages hold, so a new page's default is free in every workspace). The services then read each page inside
--   withWorkspace() as its `booking` actor, through the door.
-- Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "auth"."public_handles" (
	"handle" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_handles_pkey" PRIMARY KEY("handle"),
	CONSTRAINT "public_handles_shape" CHECK ("auth"."public_handles"."handle" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("auth"."public_handles"."handle") between 3 and 40)
);
--> statement-breakpoint
CREATE TABLE "auth"."public_profiles" (
	"user_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_profiles_pkey" PRIMARY KEY("user_id"),
	CONSTRAINT "public_profiles_bio" CHECK (char_length("auth"."public_profiles"."bio") <= 160)
);
--> statement-breakpoint
ALTER TABLE "auth"."public_handles" ADD CONSTRAINT "public_handles_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."public_profiles" ADD CONSTRAINT "public_profiles_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."public_profiles" ADD CONSTRAINT "public_profiles_handle_fk" FOREIGN KEY ("handle") REFERENCES "auth"."public_handles"("handle") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "public_handles_user" ON "auth"."public_handles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_profiles_handle" ON "auth"."public_profiles" USING btree ("handle");--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "profile_section" text;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "profile_position" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_profile_section" CHECK (char_length("booking_pages"."profile_section") between 1 and 40);--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_profile_position" CHECK ("booking_pages"."profile_position" between 0 and 999);--> statement-breakpoint
-- The backfill. Row security off: the owner bypasses it, and a role it would filter fails here rather than
-- backfilling nothing, like 0067 and 0082.
set local row_security = off;
--> statement-breakpoint
update booking_pages p set owner_user_id = m.user_id
from members m
where m.workspace_id = p.workspace_id and m.id = p.owner_member_id and m.user_id is not null;
--> statement-breakpoint
update booking_pages p set slug = pg_catalog.rtrim(pg_catalog.left(p.slug, 49), '-') || '-' || pg_catalog.left(pg_catalog.md5(p.id::text), 10)
from (
  select workspace_id, id, row_number() over (partition by owner_user_id, slug order by created_at, id) as n
  from booking_pages
  where deleted_at is null and owner_user_id is not null
) d
where d.workspace_id = p.workspace_id and d.id = p.id and d.n > 1;
--> statement-breakpoint
DROP INDEX "booking_pages_slug";--> statement-breakpoint
CREATE UNIQUE INDEX "booking_pages_slug" ON "booking_pages" USING btree ("workspace_id","owner_member_id","slug") WHERE "booking_pages"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_pages_owner_slug" ON "booking_pages" USING btree ("owner_user_id","slug") WHERE "booking_pages"."deleted_at" is null and "booking_pages"."owner_user_id" is not null;--> statement-breakpoint
CREATE INDEX "booking_pages_profile" ON "booking_pages" USING btree ("owner_user_id","profile_position","id") WHERE "booking_pages"."deleted_at" is null and "booking_pages"."is_private" = false and "booking_pages"."status" = 'live';--> statement-breakpoint
-- The owner's identity, from the owner member's row, whenever a page is made or changes hands. An invoker's
-- function: the members row is read under the writer's own row level security, so only in the page's workspace.
create function crm_booking_pages_owner_user()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $function$
begin
  select m.user_id into new.owner_user_id
  from public.members m
  where m.workspace_id = new.workspace_id and m.id = new.owner_member_id;
  return new;
end;
$function$;
--> statement-breakpoint
revoke all on function crm_booking_pages_owner_user() from public;
--> statement-breakpoint
-- On every insert and update, so the column is always the owner member's identity, whatever a write sets.
create trigger booking_pages_owner_user
  before insert or update on booking_pages
  for each row execute function crm_booking_pages_owner_user();
--> statement-breakpoint
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_handle') then
    create role crm_handle nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$$;
--> statement-breakpoint
alter role crm_handle nologin nobypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant usage on schema auth to crm_handle;
--> statement-breakpoint
grant select, insert on auth.public_handles to crm_handle;
--> statement-breakpoint
grant select, insert on auth.public_profiles to crm_handle;
--> statement-breakpoint
grant update (handle, bio, updated_at) on auth.public_profiles to crm_handle;
--> statement-breakpoint
grant select (id, name, image) on auth."user" to crm_handle;
--> statement-breakpoint
-- Claims `wanted` for `owner` and makes it their current handle, with `about` as their bio. Nothing more for a
-- handle they hold already (an old one comes back); 54000 PUBLIC_HANDLE_LIMIT past 20 held; 23505 on
-- public_handles_pkey for one another person holds, even one only just claimed by a transaction that commits
-- first. One person's claims queue on an advisory lock, so two at once can't both pass the limit.
create function crm_save_public_profile(owner uuid, wanted text, about text)
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  holder uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_public_handle:' || owner::text, 0));
  if not exists (select 1 from auth.public_handles h where h.handle = wanted and h.user_id = owner)
    and (select count(*) from auth.public_handles h where h.user_id = owner) >= 20 then
    raise exception using errcode = '54000', message = 'PUBLIC_HANDLE_LIMIT';
  end if;
  insert into auth.public_handles (handle, user_id) values (wanted, owner) on conflict (handle) do nothing;
  select h.user_id into holder from auth.public_handles h where h.handle = wanted;
  if holder is distinct from owner then
    raise exception using errcode = '23505', constraint = 'public_handles_pkey',
      message = 'That handle is taken.';
  end if;
  insert into auth.public_profiles (user_id, handle, bio) values (owner, wanted, about)
  on conflict (user_id) do update set handle = excluded.handle, bio = excluded.bio, updated_at = pg_catalog.now();
end;
$$;
--> statement-breakpoint
-- The current handle and bio of each person named, or no row for one with no handle yet.
create function crm_public_profiles_of(owners uuid[])
  returns table (user_id uuid, handle text, bio text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.user_id, p.handle, p.bio
  from auth.public_profiles p
  where p.user_id = any (crm_public_profiles_of.owners);
end;
--> statement-breakpoint
-- The person a handle names, by their current or an old one: their id, current handle, bio, name and picture.
create function crm_handle_owner(wanted text)
  returns table (user_id uuid, handle text, bio text, name text, image text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.user_id, p.handle, p.bio, u.name, u.image
  from auth.public_handles h
  join auth.public_profiles p on p.user_id = h.user_id
  join auth."user" u on u.id = h.user_id
  where h.handle = crm_handle_owner.wanted
  limit 1;
end;
--> statement-breakpoint
revoke all on function crm_save_public_profile(uuid, text, text) from public;
--> statement-breakpoint
revoke all on function crm_public_profiles_of(uuid[]) from public;
--> statement-breakpoint
revoke all on function crm_handle_owner(text) from public;
--> statement-breakpoint
grant execute on function crm_save_public_profile(uuid, text, text) to crm_app;
--> statement-breakpoint
grant execute on function crm_public_profiles_of(uuid[]) to crm_app;
--> statement-breakpoint
grant execute on function crm_handle_owner(text) to crm_app;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
alter function crm_save_public_profile(uuid, text, text) owner to crm_handle;
--> statement-breakpoint
alter function crm_public_profiles_of(uuid[]) owner to crm_handle;
--> statement-breakpoint
alter function crm_handle_owner(text) owner to crm_handle;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
grant select (owner_member_id, owner_user_id, slug, deleted_at, is_private, status, title, profile_position) on booking_pages to crm_booking_lookup;
--> statement-breakpoint
grant select (id, deleted_at) on workspaces to crm_booking_lookup;
--> statement-breakpoint
grant select (workspace_id, id, user_id, status) on members to crm_booking_lookup;
--> statement-breakpoint
-- The workspace and page `/<handle>/<slug>` names (by the handle's person), or no row. Ids only. Only a page whose
-- owner is still an active member there, with this very identity, in a workspace that exists: a workspace the
-- person left can't publish under their handle. A Link only page answers too (the owner's call: it works by its
-- address, it is never listed).
create function crm_booking_page_by_address(owner uuid, wanted text)
  returns table (workspace_id uuid, page_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.workspace_id, p.id
  from public.booking_pages p
  join public.workspaces w on w.id = p.workspace_id
  join public.members m on m.workspace_id = p.workspace_id and m.id = p.owner_member_id
  where p.owner_user_id = crm_booking_page_by_address.owner
    and m.user_id = crm_booking_page_by_address.owner
    and m.status = 'active'
    and p.slug = crm_booking_page_by_address.wanted
    and p.deleted_at is null
    and w.deleted_at is null
  limit 1;
end;
--> statement-breakpoint
-- A profile's listed pages: the person's Public, live pages in workspaces that exist where they are still an active
-- member, in their order (position, then
-- oldest first), after the cursor given, optionally only those whose title holds `search`; at most 50. Ids and the
-- position (the next cursor) only.
create function crm_booking_profile_pages(owner uuid, after_position smallint, after_id uuid, search text, max integer)
  returns table (workspace_id uuid, page_id uuid, profile_position smallint)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.workspace_id, p.id, p.profile_position
  from public.booking_pages p
  join public.workspaces w on w.id = p.workspace_id
  join public.members m on m.workspace_id = p.workspace_id and m.id = p.owner_member_id
  where p.owner_user_id = crm_booking_profile_pages.owner
    and m.user_id = crm_booking_profile_pages.owner
    and m.status = 'active'
    and p.deleted_at is null
    and p.is_private = false
    and p.status = 'live'
    and w.deleted_at is null
    and (crm_booking_profile_pages.after_id is null
      or (p.profile_position, p.id) > (crm_booking_profile_pages.after_position, crm_booking_profile_pages.after_id))
    and (crm_booking_profile_pages.search is null
      or pg_catalog.strpos(pg_catalog.lower(p.title), pg_catalog.lower(crm_booking_profile_pages.search)) > 0)
  order by p.profile_position, p.id
  limit least(greatest(crm_booking_profile_pages.max, 1), 50);
end;
--> statement-breakpoint
-- The slugs a person's live pages hold, in any workspace that exists, that start with `prefix`: at most 1,000.
create function crm_booking_owner_slugs(owner uuid, prefix text)
  returns table (slug text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.slug
  from public.booking_pages p
  join public.workspaces w on w.id = p.workspace_id
  where p.owner_user_id = crm_booking_owner_slugs.owner
    and w.deleted_at is null
    and p.deleted_at is null
    and pg_catalog.left(p.slug, pg_catalog.length(crm_booking_owner_slugs.prefix)) = crm_booking_owner_slugs.prefix
  limit 1000;
end;
--> statement-breakpoint
revoke all on function crm_booking_page_by_address(uuid, text) from public;
--> statement-breakpoint
revoke all on function crm_booking_profile_pages(uuid, smallint, uuid, text, integer) from public;
--> statement-breakpoint
revoke all on function crm_booking_owner_slugs(uuid, text) from public;
--> statement-breakpoint
grant execute on function crm_booking_page_by_address(uuid, text) to crm_app;
--> statement-breakpoint
grant execute on function crm_booking_profile_pages(uuid, smallint, uuid, text, integer) to crm_app;
--> statement-breakpoint
grant execute on function crm_booking_owner_slugs(uuid, text) to crm_app;
--> statement-breakpoint
grant crm_booking_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_booking_lookup;
--> statement-breakpoint
alter function crm_booking_page_by_address(uuid, text) owner to crm_booking_lookup;
--> statement-breakpoint
alter function crm_booking_profile_pages(uuid, smallint, uuid, text, integer) owner to crm_booking_lookup;
--> statement-breakpoint
alter function crm_booking_owner_slugs(uuid, text) owner to crm_booking_lookup;
--> statement-breakpoint
revoke create on schema public from crm_booking_lookup;
--> statement-breakpoint
revoke crm_booking_lookup from current_user;
--> statement-breakpoint
-- Refuse to finish unless crm_handle is as narrow as it reads: owning these three functions, executable by crm_app
-- alone, out of the identity login's reach; a plain role in no role, that nothing but the owner can become, holding
-- exactly the privileges granted above.
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.crm_save_public_profile(uuid, text, text)'::regprocedure,
    'public.crm_public_profiles_of(uuid[])'::regprocedure,
    'public.crm_handle_owner(text)'::regprocedure
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = fn) <> 'crm_handle'
      or exists (
        select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
        where p.oid = fn and a.privilege_type = 'EXECUTE'
          and a.grantee not in ('crm_handle'::regrole, 'crm_app'::regrole)
      )
      or has_function_privilege('crm_identity', fn, 'EXECUTE') then
      raise exception '% must be owned by crm_handle and executable by crm_app alone', fn;
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'crm_handle' and (rolcanlogin or rolsuper or rolbypassrls))
    or exists (select 1 from pg_auth_members m where m.member = 'crm_handle'::regrole)
    or exists (
      select 1 from pg_auth_members m
      where m.roleid = 'crm_handle'::regrole and (m.set_option or m.inherit_option)
        and pg_get_userbyid(m.member) not in ('neon_service', 'cloud_admin')
    )
    or pg_has_role('crm_app', 'crm_handle', 'MEMBER')
    or pg_has_role('crm_identity', 'crm_handle', 'MEMBER')
    or exists (
      select 1 from information_schema.role_table_grants g
      where g.grantee = 'crm_handle'
        and (g.table_schema, g.table_name, g.privilege_type) not in (
          ('auth', 'public_handles', 'SELECT'), ('auth', 'public_handles', 'INSERT'),
          ('auth', 'public_profiles', 'SELECT'), ('auth', 'public_profiles', 'INSERT'))
    )
    or exists (
      select 1 from pg_attribute att cross join lateral aclexplode(att.attacl) a
      where a.grantee = 'crm_handle'::regrole
        and (att.attrelid, att.attname, a.privilege_type) not in (
          ('auth.public_profiles'::regclass, 'handle', 'UPDATE'),
          ('auth.public_profiles'::regclass, 'bio', 'UPDATE'),
          ('auth.public_profiles'::regclass, 'updated_at', 'UPDATE'),
          ('auth."user"'::regclass, 'id', 'SELECT'),
          ('auth."user"'::regclass, 'name', 'SELECT'),
          ('auth."user"'::regclass, 'image', 'SELECT'))
    ) then
    raise exception 'crm_handle must be a plain role, out of every login''s reach, holding only its functions'' grants';
  end if;
end
$$;
