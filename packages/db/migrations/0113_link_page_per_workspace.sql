-- One link page per workspace (spec 0056, 26 Oct 2026): a handle stops belonging to the person and belongs to the
-- person's membership in ONE workspace, and so does the link page behind it. A person in three workspaces can hold up
-- to three handles and three pages, each its own, and a page holds only its own workspace's booking pages, forms and
-- meeting links. The link page shipped days ago, so what crossed workspaces is deleted here, not carried (owner,
-- 26 Oct 2026).
--
-- What changes:
-- * `auth.public_handles`, `auth.public_profiles`, `auth.profile_items`, `auth.profile_views` and
--   `auth.profile_view_days` gain `workspace_id` (not null once backfilled). A handle names one membership; a profile
--   is keyed by (user, workspace) and its handle must be one that same membership holds (a composite key); items
--   and their order are per (user, workspace); views are counted per (user, workspace, day).
-- * Every crm_handle definer takes the workspace beside the owner, and refuses (writes) or answers nothing (reads)
--   unless the owner is an ACTIVE member of that workspace, asked through one new narrow reader,
--   crm_workspace_member (owned by crm_booking_lookup, which already reads members and workspaces past row level
--   security; crm_handle gains the right to execute it and still holds no grant on a tenant table). A `page` or
--   `form` item is written only for a page or form that crm_booking_owner_pages / crm_form_owner_forms find in the
--   item's own workspace (42704 PROFILE_TARGET_MISSING otherwise), so the item's workspace is never trusted.
-- * `crm_handle_owner(handle)` answers nothing for a person who is no longer an active member of the handle's
--   workspace (AC-5603): the handle stays reserved to them, `crm_handle_taken(handle)` still says so.
-- * The booking readers (crm_booking_page_by_address, crm_booking_profile_pages, crm_booking_owner_slugs,
--   crm_booking_owner_pages, crm_form_owner_forms) take the workspace and answer inside it only. The unique
--   (owner, slug) across workspaces goes, on booking_pages (`booking_pages_owner_slug`) and on the slug history
--   (`booking_page_slugs_owner_slug`, which becomes unique per owner AND workspace); the per workspace rules stay.
--
-- The backfill (AC-5614 to 5616): each existing person gets their handles, profile, views and link, heading, contact,
-- text, faq and testimonial items in ONE home workspace: where they hold the most live Public booking pages
-- (ties: the earliest membership; none: the earliest membership), a membership that is still active ahead of one
-- that is not. Their page and form items from any other workspace are deleted with their presses, and the line
-- counted in the deploy log is the only trace. Every other workspace starts with no handle and an empty page. Every
-- step is guarded, so the migration can run twice. Postgres 17 compatible. Any change to these roles or functions goes
-- through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
alter table "auth"."public_handles" add column if not exists "workspace_id" uuid;
--> statement-breakpoint
alter table "auth"."public_profiles" add column if not exists "workspace_id" uuid;
--> statement-breakpoint
alter table "auth"."profile_views" add column if not exists "workspace_id" uuid;
--> statement-breakpoint
alter table "auth"."profile_view_days" add column if not exists "workspace_id" uuid;
--> statement-breakpoint
-- Items: their workspace is the page's, so every kind carries one. A page or form item already does.
alter table "auth"."profile_items" alter column "workspace_id" drop not null;
--> statement-breakpoint
-- The backfill, as the owner and past row level security: a role it would filter fails here rather than backfilling
-- nothing, like 0067, 0082, 0086 and 0098.
set local row_security = off;
--> statement-breakpoint
do $$
declare
  moved integer;
  gone_items integer := 0;
  gone_people integer := 0;
begin
  create temporary table if not exists link_page_home (user_id uuid primary key, workspace_id uuid) on commit drop;
  insert into link_page_home (user_id, workspace_id)
  select p.user_id, (
    select m.workspace_id
    from public.members m
    join public.workspaces w on w.id = m.workspace_id
    where m.user_id = p.user_id
    order by
      (m.status = 'active' and w.deleted_at is null) desc,
      (select count(*) from public.booking_pages b
        where b.workspace_id = m.workspace_id and b.owner_member_id = m.id and b.owner_user_id = p.user_id
          and b.deleted_at is null and b.is_private = false and b.status = 'live') desc,
      m.created_at, m.id
    limit 1
  )
  from (
    select h.user_id from auth.public_handles h where h.workspace_id is null
    union select q.user_id from auth.public_profiles q where q.workspace_id is null
    union select i.user_id from auth.profile_items i where i.workspace_id is null
    union select v.user_id from auth.profile_views v where v.workspace_id is null
    union select d.user_id from auth.profile_view_days d where d.workspace_id is null
    union select i.user_id from auth.profile_items i where i.kind in ('page', 'form')
      and exists (select 1 from auth.public_handles h where h.user_id = i.user_id and h.workspace_id is null)
  ) p
  on conflict (user_id) do nothing;

  -- Page and form items from any workspace but the home one are deleted (their presses go by the foreign key's
  -- cascade): the link page never crossed workspaces again.
  delete from auth.profile_items i using link_page_home lh
  where i.user_id = lh.user_id and i.kind in ('page', 'form') and i.workspace_id is distinct from lh.workspace_id;
  get diagnostics gone_items = row_count;

  update auth.public_handles h set workspace_id = lh.workspace_id
  from link_page_home lh where h.user_id = lh.user_id and h.workspace_id is null and lh.workspace_id is not null;
  update auth.public_profiles q set workspace_id = lh.workspace_id
  from link_page_home lh where q.user_id = lh.user_id and q.workspace_id is null and lh.workspace_id is not null;
  update auth.profile_items i set workspace_id = lh.workspace_id
  from link_page_home lh where i.user_id = lh.user_id and i.workspace_id is null and lh.workspace_id is not null;
  update auth.profile_views v set workspace_id = lh.workspace_id
  from link_page_home lh where v.user_id = lh.user_id and v.workspace_id is null and lh.workspace_id is not null;
  update auth.profile_view_days d set workspace_id = lh.workspace_id
  from link_page_home lh where d.user_id = lh.user_id and d.workspace_id is null and lh.workspace_id is not null;

  -- A person with no membership at all has no workspace to hold a page: their rows go (the account never had a
  -- workspace, so it never had a link page worth keeping).
  delete from auth.profile_items where workspace_id is null;
  delete from auth.profile_views where workspace_id is null;
  delete from auth.profile_view_days where workspace_id is null;
  delete from auth.public_profiles where workspace_id is null;
  delete from auth.public_handles where workspace_id is null;
  get diagnostics gone_people = row_count;

  -- The places close up where a deleted item left a gap.
  update auth.profile_items i set position = (r.n - 1)::smallint
  from (
    select p.id, row_number() over (partition by p.user_id order by p.position, p.id) as n
    from auth.profile_items p where p.archived_at is null
  ) r
  where i.id = r.id and i.position is distinct from (r.n - 1)::smallint;

  select count(*) into moved from link_page_home;
  if moved > 0 or gone_items > 0 then
    raise notice '0113_link_page_per_workspace: % people moved to one workspace, % cross-workspace page/form items removed, % rows without a membership removed',
      moved, gone_items, gone_people;
  end if;
end
$$;
--> statement-breakpoint
alter table "auth"."public_handles" alter column "workspace_id" set not null;
--> statement-breakpoint
alter table "auth"."public_profiles" alter column "workspace_id" set not null;
--> statement-breakpoint
alter table "auth"."profile_items" alter column "workspace_id" set not null;
--> statement-breakpoint
alter table "auth"."profile_views" alter column "workspace_id" set not null;
--> statement-breakpoint
alter table "auth"."profile_view_days" alter column "workspace_id" set not null;
--> statement-breakpoint
-- Handles: one membership each. The composite unique is what a profile's handle must be one of.
drop index if exists "auth"."public_handles_user";
--> statement-breakpoint
create index if not exists "public_handles_user_workspace" on "auth"."public_handles" using btree ("user_id", "workspace_id");
--> statement-breakpoint
create unique index if not exists "public_handles_membership" on "auth"."public_handles" using btree ("handle", "user_id", "workspace_id");
--> statement-breakpoint
-- Profiles: keyed by (user, workspace), and the handle is one that same membership holds.
alter table "auth"."public_profiles" drop constraint if exists "public_profiles_handle_fk";
--> statement-breakpoint
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'public_profiles_pkey'
      and conrelid = 'auth.public_profiles'::regclass
      and pg_get_constraintdef(oid) not like '%workspace_id%') then
    alter table auth.public_profiles drop constraint public_profiles_pkey;
    alter table auth.public_profiles add constraint public_profiles_pkey primary key (user_id, workspace_id);
  end if;
end
$$;
--> statement-breakpoint
alter table "auth"."public_profiles" drop constraint if exists "public_profiles_membership_fk";
--> statement-breakpoint
alter table "auth"."public_profiles" add constraint "public_profiles_membership_fk" foreign key ("handle", "user_id", "workspace_id") references "auth"."public_handles" ("handle", "user_id", "workspace_id");
--> statement-breakpoint
-- Items: a page item or a form item names its target, and nothing else does; the order is per page.
alter table "auth"."profile_items" drop constraint if exists "profile_items_target";
--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_target" check (("kind" = 'page') = ("page_id" is not null));
--> statement-breakpoint
alter table "auth"."profile_items" drop constraint if exists "profile_items_place";
--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_place" unique ("user_id", "workspace_id", "position") deferrable initially deferred;
--> statement-breakpoint
drop index if exists "auth"."profile_items_contact_once";
--> statement-breakpoint
create unique index "profile_items_contact_once" on "auth"."profile_items" using btree ("user_id", "workspace_id") where "kind" = 'contact' and "archived_at" is null;
--> statement-breakpoint
drop index if exists "auth"."profile_items_heading_once";
--> statement-breakpoint
create unique index "profile_items_heading_once" on "auth"."profile_items" using btree ("user_id", "workspace_id", lower(btrim("data" ->> 'title'))) where "kind" = 'heading' and "archived_at" is null;
--> statement-breakpoint
drop index if exists "auth"."profile_items_archived";
--> statement-breakpoint
create index "profile_items_archived" on "auth"."profile_items" using btree ("user_id", "workspace_id", "archived_at") where "archived_at" is not null;
--> statement-breakpoint
-- Views and their days: per (user, workspace).
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'profile_views_pkey'
      and conrelid = 'auth.profile_views'::regclass and pg_get_constraintdef(oid) not like '%workspace_id%') then
    alter table auth.profile_views drop constraint profile_views_pkey;
    alter table auth.profile_views add constraint profile_views_pkey primary key (user_id, workspace_id, day, visitor);
  end if;
  if exists (select 1 from pg_constraint where conname = 'profile_view_days_pkey'
      and conrelid = 'auth.profile_view_days'::regclass and pg_get_constraintdef(oid) not like '%workspace_id%') then
    alter table auth.profile_view_days drop constraint profile_view_days_pkey;
    alter table auth.profile_view_days add constraint profile_view_days_pkey primary key (user_id, workspace_id, day);
  end if;
end
$$;
--> statement-breakpoint
-- A slug may now repeat across a person's workspaces, and each address (handle, slug) still names exactly one page:
-- the per workspace rule, `booking_pages_slug` (workspace, owner member, slug), is the one that stays.
drop index if exists "booking_pages_owner_slug";
--> statement-breakpoint
drop index if exists "booking_page_slugs_owner_slug";
--> statement-breakpoint
create unique index "booking_page_slugs_owner_slug" on "booking_page_slugs" using btree ("owner_user_id", "workspace_id", "slug");
--> statement-breakpoint
-- The readers of tenant tables, past row level security, ids only. First the one that says whether a person is an
-- active member of a workspace that exists: crm_handle's definers ask it and hold no grant on `members` themselves.
grant crm_booking_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_booking_lookup;
--> statement-breakpoint
set local role crm_booking_lookup;
--> statement-breakpoint
create function crm_workspace_member(owner uuid, workspace uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select exists (
    select 1
    from public.members m
    join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = crm_workspace_member.workspace
      and m.user_id = crm_workspace_member.owner
      and m.status = 'active'
      and w.deleted_at is null
  );
end;
--> statement-breakpoint
revoke all on function crm_workspace_member(uuid, uuid) from public;
--> statement-breakpoint
grant execute on function crm_workspace_member(uuid, uuid) to crm_handle;
--> statement-breakpoint
drop function crm_booking_page_by_address(uuid, text);
--> statement-breakpoint
drop function crm_booking_profile_pages(uuid, smallint, uuid, text, integer);
--> statement-breakpoint
drop function crm_booking_owner_slugs(uuid, text);
--> statement-breakpoint
drop function crm_booking_owner_pages(uuid, uuid[]);
--> statement-breakpoint
-- The page `/<handle>/<slug>` names inside the handle's workspace (the page holding that slug now, else the one that
-- held it), or no row. Ids only. Only a page whose owner is still an active member there with this very identity, in
-- a workspace that exists; never a Link only page.
create function crm_booking_page_by_address(owner uuid, workspace uuid, wanted text)
  returns table (workspace_id uuid, page_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.workspace_id, p.id
  from (
    select c.workspace_id, c.id as page_id, 0 as rank
    from public.booking_pages c
    where c.owner_user_id = crm_booking_page_by_address.owner
      and c.workspace_id = crm_booking_page_by_address.workspace
      and c.slug = crm_booking_page_by_address.wanted and c.deleted_at is null
    union all
    select s.workspace_id, s.page_id, 1 as rank
    from public.booking_page_slugs s
    where s.owner_user_id = crm_booking_page_by_address.owner
      and s.workspace_id = crm_booking_page_by_address.workspace
      and s.slug = crm_booking_page_by_address.wanted
  ) f
  join public.booking_pages p on p.workspace_id = f.workspace_id and p.id = f.page_id
  join public.workspaces w on w.id = p.workspace_id
  join public.members m on m.workspace_id = p.workspace_id and m.id = p.owner_member_id
  where p.owner_user_id = crm_booking_page_by_address.owner
    and m.user_id = crm_booking_page_by_address.owner
    and m.status = 'active'
    and p.is_private = false
    and p.deleted_at is null
    and w.deleted_at is null
  order by f.rank
  limit 1;
end;
--> statement-breakpoint
create function crm_booking_profile_pages(owner uuid, workspace uuid, after_position smallint, after_id uuid, search text, max integer)
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
    and p.workspace_id = crm_booking_profile_pages.workspace
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
-- The slugs a person's pages hold, live or remembered, in ONE workspace, that start with `prefix`: at most 1,000.
create function crm_booking_owner_slugs(owner uuid, workspace uuid, prefix text)
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
    and p.workspace_id = crm_booking_owner_slugs.workspace
    and w.deleted_at is null
    and p.deleted_at is null
    and pg_catalog.left(p.slug, pg_catalog.length(crm_booking_owner_slugs.prefix)) = crm_booking_owner_slugs.prefix
  union
  select s.slug
  from public.booking_page_slugs s
  where s.owner_user_id = crm_booking_owner_slugs.owner
    and s.workspace_id = crm_booking_owner_slugs.workspace
    and pg_catalog.left(s.slug, pg_catalog.length(crm_booking_owner_slugs.prefix)) = crm_booking_owner_slugs.prefix
  limit 1000;
end;
--> statement-breakpoint
-- Which of `owner`'s booking pages in `workspace` may sit on their link page there, and which of those visitors see
-- now (`is_live`): Public, not deleted, theirs, still an active member with this very identity, in a workspace that
-- exists; only those `pages` names when it is not null. Ids only, at most 200. Nothing from any other workspace.
create function crm_booking_owner_pages(owner uuid, workspace uuid, pages uuid[])
  returns table (workspace_id uuid, page_id uuid, is_live boolean)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.workspace_id, p.id, p.status = 'live'
  from public.booking_pages p
  join public.workspaces w on w.id = p.workspace_id
  join public.members m on m.workspace_id = p.workspace_id and m.id = p.owner_member_id
  where p.owner_user_id = crm_booking_owner_pages.owner
    and p.workspace_id = crm_booking_owner_pages.workspace
    and m.user_id = crm_booking_owner_pages.owner
    and m.status = 'active'
    and p.deleted_at is null
    and p.is_private = false
    and w.deleted_at is null
    and (crm_booking_owner_pages.pages is null or p.id = any (crm_booking_owner_pages.pages))
  order by p.workspace_id, p.id
  limit 200;
end;
--> statement-breakpoint
revoke all on function crm_booking_page_by_address(uuid, uuid, text) from public;
--> statement-breakpoint
revoke all on function crm_booking_profile_pages(uuid, uuid, smallint, uuid, text, integer) from public;
--> statement-breakpoint
revoke all on function crm_booking_owner_slugs(uuid, uuid, text) from public;
--> statement-breakpoint
revoke all on function crm_booking_owner_pages(uuid, uuid, uuid[]) from public;
--> statement-breakpoint
grant execute on function crm_booking_page_by_address(uuid, uuid, text) to crm_app;
--> statement-breakpoint
grant execute on function crm_booking_profile_pages(uuid, uuid, smallint, uuid, text, integer) to crm_app;
--> statement-breakpoint
grant execute on function crm_booking_owner_slugs(uuid, uuid, text) to crm_app;
--> statement-breakpoint
grant execute on function crm_booking_owner_pages(uuid, uuid, uuid[]) to crm_app, crm_handle;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_booking_lookup;
--> statement-breakpoint
revoke crm_booking_lookup from current_user;
--> statement-breakpoint
-- The forms, the same way (crm_form_lookup, 0104): inside one workspace, and executable by crm_handle too, so the
-- definer that writes a form item can ask whether the form is in the item's workspace.
grant crm_form_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_form_lookup;
--> statement-breakpoint
set local role crm_form_lookup;
--> statement-breakpoint
drop function crm_form_owner_forms(uuid, uuid[]);
--> statement-breakpoint
create function crm_form_owner_forms(owner uuid, workspace uuid, forms uuid[])
  returns table (workspace_id uuid, form_id uuid, public_key text, is_live boolean)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select f.workspace_id, f.id, f.public_key, f.status = 'live'
  from public.forms f
  join public.workspaces w on w.id = f.workspace_id
  join public.members m on m.workspace_id = f.workspace_id and m.id = f.created_by_member_id
  where m.user_id = crm_form_owner_forms.owner
    and f.workspace_id = crm_form_owner_forms.workspace
    and m.status = 'active'
    and f.archived_at is null
    and w.deleted_at is null
    and (crm_form_owner_forms.forms is null or f.id = any (crm_form_owner_forms.forms))
  order by f.workspace_id, f.id
  limit 200;
end;
--> statement-breakpoint
revoke all on function crm_form_owner_forms(uuid, uuid, uuid[]) from public;
--> statement-breakpoint
grant execute on function crm_form_owner_forms(uuid, uuid, uuid[]) to crm_app, crm_handle;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_form_lookup;
--> statement-breakpoint
revoke crm_form_lookup from current_user;
--> statement-breakpoint
-- Now crm_handle's own definers, all made as crm_handle so they are already its own. The old signatures go first.
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
drop function crm_save_public_profile(uuid, text, text);
--> statement-breakpoint
drop function crm_public_profiles_of(uuid[]);
--> statement-breakpoint
drop function crm_handle_owner(text);
--> statement-breakpoint
drop function crm_profile_items(uuid);
--> statement-breakpoint
drop function crm_profile_items_archived(uuid);
--> statement-breakpoint
drop function crm_profile_items_public(uuid, smallint, uuid, integer);
--> statement-breakpoint
drop function crm_save_profile_item(uuid, uuid, text, jsonb, uuid, uuid, uuid);
--> statement-breakpoint
drop function crm_order_profile_items(uuid, uuid[]);
--> statement-breakpoint
drop function crm_archive_profile_item(uuid, uuid, boolean);
--> statement-breakpoint
drop function crm_delete_profile_item(uuid, uuid);
--> statement-breakpoint
drop function crm_place_profile_page(uuid, uuid, uuid);
--> statement-breakpoint
drop function crm_import_profile_links(uuid, uuid, text, jsonb, jsonb);
--> statement-breakpoint
drop function crm_save_profile_theme(uuid, jsonb);
--> statement-breakpoint
drop function crm_save_profile_indexable(uuid, boolean);
--> statement-breakpoint
drop function crm_count_profile_view(uuid, text);
--> statement-breakpoint
drop function crm_count_item_press(uuid, uuid, text);
--> statement-breakpoint
drop function crm_profile_counts(uuid, date, date);
--> statement-breakpoint
drop function crm_pack_profile_items(uuid);
--> statement-breakpoint
-- Claims `wanted` for `owner` in `workspace` and makes it that membership's current handle, with `about` as the bio
-- there. 42501 PROFILE_NOT_MEMBER unless the owner is an active member of the workspace; 54000 PUBLIC_HANDLE_LIMIT
-- past 20 held in all; 23505 on public_handles_pkey for a handle any other person, or this person in another
-- workspace, holds or held. One person's claims queue on an advisory lock.
create function crm_save_public_profile(owner uuid, workspace uuid, wanted text, about text)
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  holder uuid;
  held_in uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_public_handle:' || owner::text, 0));
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  if not exists (select 1 from auth.public_handles h
      where h.handle = wanted and h.user_id = owner and h.workspace_id = workspace)
    and (select count(*) from auth.public_handles h where h.user_id = owner) >= 20 then
    raise exception using errcode = '54000', message = 'PUBLIC_HANDLE_LIMIT';
  end if;
  insert into auth.public_handles (handle, user_id, workspace_id) values (wanted, owner, workspace)
  on conflict (handle) do nothing;
  select h.user_id, h.workspace_id into holder, held_in from auth.public_handles h where h.handle = wanted;
  if holder is distinct from owner or held_in is distinct from workspace then
    raise exception using errcode = '23505', constraint = 'public_handles_pkey',
      message = 'That handle is taken.';
  end if;
  insert into auth.public_profiles (user_id, workspace_id, handle, bio) values (owner, workspace, wanted, about)
  on conflict (user_id, workspace_id) do update
    set handle = excluded.handle, bio = excluded.bio, updated_at = pg_catalog.now();
end;
$$;
--> statement-breakpoint
-- The current handle, bio and look of each person named in ONE workspace, or no row for one with no handle there.
create function crm_public_profiles_of(owners uuid[], workspace uuid)
  returns table (user_id uuid, handle text, bio text, theme jsonb, indexable boolean)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.user_id, p.handle, p.bio, p.theme, p.indexable
  from auth.public_profiles p
  where p.user_id = any (crm_public_profiles_of.owners)
    and p.workspace_id = crm_public_profiles_of.workspace;
end;
--> statement-breakpoint
-- The membership a handle names, by its current or an old handle: the person and workspace, current handle, bio,
-- name, picture (unless hidden), look and whether search engines may list it, never an email. No row unless that
-- person is still an active member of that workspace (AC-5603): the handle stays reserved to them (crm_handle_taken)
-- and works again if they rejoin.
create function crm_handle_owner(wanted text)
  returns table (user_id uuid, workspace_id uuid, handle text, bio text, name text, image text, theme jsonb,
    indexable boolean)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.user_id, p.workspace_id, p.handle, p.bio, u.name,
    case when coalesce(k.picture_hidden, false) then null else u.image end,
    p.theme, p.indexable
  from auth.public_handles h
  join auth.public_profiles p on p.user_id = h.user_id and p.workspace_id = h.workspace_id
  join auth."user" u on u.id = h.user_id
  left join auth.user_prefs k on k.user_id = h.user_id
  where h.handle = crm_handle_owner.wanted
    and public.crm_workspace_member(h.user_id, h.workspace_id)
  limit 1;
end;
--> statement-breakpoint
-- Whether anyone holds or ever held `wanted`: a handle is never freed, so a claim and a suggestion ask this, not
-- whether its person is still a member.
create function crm_handle_taken(wanted text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select exists (select 1 from auth.public_handles h where h.handle = crm_handle_taken.wanted);
end;
--> statement-breakpoint
-- The handles `owner` holds now, one per workspace they are still an active member of: the workspace and its
-- current handle, for the one line that says they have a page elsewhere (AC-5618). Their own, by their own id.
create function crm_profile_handles_of(owner uuid)
  returns table (workspace_id uuid, handle text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.workspace_id, p.handle
  from auth.public_profiles p
  where p.user_id = crm_profile_handles_of.owner
    and public.crm_workspace_member(p.user_id, p.workspace_id)
  order by p.updated_at, p.workspace_id
  limit 20;
end;
--> statement-breakpoint
create function crm_profile_items(owner uuid, workspace uuid)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid, form_id uuid,
    archived_at timestamptz, updated_at timestamptz)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.form_id, i.archived_at, i.updated_at
  from auth.profile_items i
  where i.user_id = crm_profile_items.owner and i.workspace_id = crm_profile_items.workspace
    and i.archived_at is null
    and public.crm_workspace_member(crm_profile_items.owner, crm_profile_items.workspace)
  order by i.position, i.id
  limit 1000;
end;
--> statement-breakpoint
create function crm_profile_items_archived(owner uuid, workspace uuid)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid, form_id uuid,
    archived_at timestamptz, updated_at timestamptz)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.form_id, i.archived_at, i.updated_at
  from auth.profile_items i
  where i.user_id = crm_profile_items_archived.owner and i.workspace_id = crm_profile_items_archived.workspace
    and i.archived_at is not null
    and public.crm_workspace_member(crm_profile_items_archived.owner, crm_profile_items_archived.workspace)
  order by i.archived_at desc, i.id
  limit 100;
end;
--> statement-breakpoint
create function crm_profile_items_public(owner uuid, workspace uuid, after_position smallint, after_id uuid, max integer)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid, form_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.form_id
  from auth.profile_items i
  where i.user_id = crm_profile_items_public.owner and i.workspace_id = crm_profile_items_public.workspace
    and i.archived_at is null
    and (crm_profile_items_public.after_id is null
      or (i.position, i.id) > (crm_profile_items_public.after_position, crm_profile_items_public.after_id))
    and public.crm_workspace_member(crm_profile_items_public.owner, crm_profile_items_public.workspace)
  order by i.position, i.id
  limit least(greatest(crm_profile_items_public.max, 1), 61);
end;
--> statement-breakpoint
-- Places `owner`'s live blocks in `workspace` 0, 1, 2 … in the order they stand. Not a definer: it runs only inside
-- crm_handle's own functions, as crm_handle.
create function crm_pack_profile_items(owner uuid, workspace uuid)
  returns void
  language sql
  set search_path = pg_catalog, pg_temp
begin atomic
  update auth.profile_items i
  set position = (r.n - 1)::smallint
  from (
    select p.id, pg_catalog.row_number() over (order by p.position, p.id) as n
    from auth.profile_items p
    where p.user_id = crm_pack_profile_items.owner and p.workspace_id = crm_pack_profile_items.workspace
      and p.archived_at is null
  ) r
  where i.id = r.id and i.position is distinct from (r.n - 1)::smallint;
end;
--> statement-breakpoint
-- Adds or edits one block of `owner`'s link page in `workspace`, and answers it. Idempotent on `item`. 42501
-- PROFILE_NOT_MEMBER unless the owner is an active member of the workspace; P0002 PROFILE_ITEM_MISSING for another
-- person's or another workspace's id; 42704 PROFILE_TARGET_MISSING for a booking page or form that is not the owner's
-- Public page or own form in THIS workspace (read through the booking and form lookups, never trusting the id). The
-- limits are per page: 60 live blocks, 200 kept, and a cap for each kind.
create function crm_save_profile_item(owner uuid, workspace uuid, item uuid, wanted_kind text, given jsonb, page uuid, form uuid)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid, form_id uuid,
    archived_at timestamptz, updated_at timestamptz)
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  held auth.profile_items%rowtype;
  live integer;
  live_kind integer;
  kept integer;
  cap integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  perform public.crm_check_profile_item(wanted_kind, given,
    case when wanted_kind in ('page', 'form') then workspace end, page, form);
  if wanted_kind = 'page' and not exists (
    select 1 from public.crm_booking_owner_pages(owner, workspace, array[page]) o where o.page_id = page
  ) then
    raise exception using errcode = '42704', message = 'PROFILE_TARGET_MISSING';
  end if;
  if wanted_kind = 'form' and not exists (
    select 1 from public.crm_form_owner_forms(owner, workspace, array[form]) o where o.form_id = form
  ) then
    raise exception using errcode = '42704', message = 'PROFILE_TARGET_MISSING';
  end if;
  select * into held from auth.profile_items i where i.id = item for update;
  if found then
    if held.user_id <> owner or held.workspace_id <> workspace then
      raise exception using errcode = 'P0002', message = 'PROFILE_ITEM_MISSING';
    end if;
    if held.kind <> wanted_kind then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    update auth.profile_items i
    set data = given, page_id = page, form_id = form, updated_at = pg_catalog.now()
    where i.id = item and (i.data, i.page_id, i.form_id) is distinct from (given, page, form);
  else
    select count(*) filter (where i.archived_at is null),
      count(*) filter (where i.archived_at is null and i.kind = wanted_kind),
      count(*)
    into live, live_kind, kept
    from auth.profile_items i where i.user_id = owner and i.workspace_id = workspace;
    cap := case wanted_kind
      when 'link' then 40 when 'heading' then 12 when 'text' then 5 when 'faq' then 2 when 'form' then 3
      when 'testimonial' then 6 else 60 end;
    if live >= 60 or kept >= 200 then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'items';
    end if;
    if live_kind >= cap then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = wanted_kind;
    end if;
    insert into auth.profile_items (id, user_id, workspace_id, kind, position, data, page_id, form_id)
    values (item, owner, workspace, wanted_kind,
      (select coalesce(max(i.position) + 1, 0) from auth.profile_items i
        where i.user_id = owner and i.workspace_id = workspace and i.archived_at is null),
      given, page, form);
  end if;
  return query
    select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.form_id, i.archived_at, i.updated_at
    from auth.profile_items i where i.id = item;
end;
$$;
--> statement-breakpoint
create function crm_order_profile_items(owner uuid, workspace uuid, ids uuid[])
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  if ids is null
    or (select count(distinct w.id) from pg_catalog.unnest(ids) w(id)) <> pg_catalog.cardinality(ids)
    or (select count(*) from auth.profile_items i
      where i.user_id = owner and i.workspace_id = workspace and i.archived_at is null)
      <> pg_catalog.cardinality(ids)
    or exists (
      select 1 from pg_catalog.unnest(ids) w(id)
      where not exists (
        select 1 from auth.profile_items i
        where i.id = w.id and i.user_id = owner and i.workspace_id = workspace and i.archived_at is null
      )
    ) then
    raise exception using errcode = '22023', message = 'PROFILE_ORDER_STALE';
  end if;
  update auth.profile_items i
  set position = (w.n - 1)::smallint, updated_at = pg_catalog.now()
  from pg_catalog.unnest(ids) with ordinality w(id, n)
  where i.id = w.id and i.user_id = owner and i.workspace_id = workspace
    and i.position is distinct from (w.n - 1)::smallint;
end;
$$;
--> statement-breakpoint
create function crm_archive_profile_item(owner uuid, workspace uuid, item uuid, archived boolean)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  held auth.profile_items%rowtype;
  live integer;
  live_kind integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  select * into held from auth.profile_items i
  where i.id = item and i.user_id = owner and i.workspace_id = workspace for update;
  if not found then
    return false;
  end if;
  if archived and held.archived_at is null then
    update auth.profile_items i set archived_at = pg_catalog.now(), position = null, updated_at = pg_catalog.now()
    where i.id = item;
    perform public.crm_pack_profile_items(owner, workspace);
  elsif not archived and held.archived_at is not null then
    select count(*), count(*) filter (where i.kind = held.kind) into live, live_kind
    from auth.profile_items i where i.user_id = owner and i.workspace_id = workspace and i.archived_at is null;
    if live >= 60 then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'items';
    end if;
    if live_kind >= (case held.kind when 'link' then 40 when 'heading' then 12 when 'contact' then 1
        when 'text' then 5 when 'faq' then 2 when 'form' then 3 when 'testimonial' then 6 else 60 end) then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = held.kind;
    end if;
    update auth.profile_items i
    set archived_at = null, updated_at = pg_catalog.now(),
      position = (select coalesce(max(p.position) + 1, 0) from auth.profile_items p
        where p.user_id = owner and p.workspace_id = workspace and p.archived_at is null)
    where i.id = item;
  end if;
  return true;
end;
$$;
--> statement-breakpoint
create function crm_delete_profile_item(owner uuid, workspace uuid, item uuid)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  delete from auth.profile_items i where i.id = item and i.user_id = owner and i.workspace_id = workspace;
  if not found then
    return false;
  end if;
  perform public.crm_pack_profile_items(owner, workspace);
  return true;
end;
$$;
--> statement-breakpoint
-- Puts one booking page at the end of `owner`'s link page in `workspace`, once, as it is made Public: nothing when
-- the owner is not an active member there, when any block of theirs there names it already, or past a limit. A
-- booking page is never refused for its link page.
create function crm_place_profile_page(owner uuid, workspace uuid, page uuid)
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  if workspace is null or page is null
    or not public.crm_workspace_member(owner, workspace)
    or exists (select 1 from auth.profile_items i
      where i.user_id = owner and i.workspace_id = workspace and i.page_id = page)
    or (select count(*) from auth.profile_items i
      where i.user_id = owner and i.workspace_id = workspace and i.archived_at is null) >= 60
    or (select count(*) from auth.profile_items i where i.user_id = owner and i.workspace_id = workspace) >= 200 then
    return;
  end if;
  insert into auth.profile_items (id, user_id, workspace_id, kind, position, data, page_id)
  values (public.uuidv7(), owner, workspace, 'page',
    (select coalesce(max(i.position) + 1, 0) from auth.profile_items i
      where i.user_id = owner and i.workspace_id = workspace and i.archived_at is null),
    '{}'::jsonb, page);
end;
$$;
--> statement-breakpoint
create function crm_import_profile_links(owner uuid, workspace uuid, import uuid, source text, blocks jsonb, skipped jsonb)
  returns table (existed boolean, made integer)
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  block jsonb;
  ids uuid[] := '{}';
  kept integer;
  recent integer;
  held auth.link_imports%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  select * into held from auth.link_imports i where i.id = import;
  if found then
    if held.user_id <> owner then
      raise exception using errcode = 'P0002', message = 'LINK_IMPORT_MISSING';
    end if;
    return query select true, coalesce(pg_catalog.array_length(held.item_ids, 1), 0);
    return;
  end if;
  if pg_catalog.jsonb_array_length(blocks) > 40 then
    raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'link';
  end if;
  select count(*) into recent from auth.link_imports i
  where i.user_id = owner and i.created_at > pg_catalog.now() - interval '1 hour';
  if recent >= 5 then
    raise exception using errcode = '54000', message = 'LINK_IMPORT_LIMIT', detail = 'imports';
  end if;
  select count(*) into kept from auth.profile_items i where i.user_id = owner and i.workspace_id = workspace;
  if kept + pg_catalog.jsonb_array_length(blocks) > 200 then
    raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'items';
  end if;
  for block in select * from pg_catalog.jsonb_array_elements(blocks) loop
    perform public.crm_check_profile_item('link', block -> 'data', null, null, null);
    insert into auth.profile_items (id, user_id, workspace_id, kind, position, data, archived_at)
    values ((block ->> 'id')::uuid, owner, workspace, 'link', null, block -> 'data', pg_catalog.now());
    ids := ids || (block ->> 'id')::uuid;
  end loop;
  insert into auth.link_imports (id, user_id, source, item_ids, skipped)
  values (import, owner, source, ids, skipped);
  return query select false, coalesce(pg_catalog.array_length(ids, 1), 0);
end;
$$;
--> statement-breakpoint
create function crm_save_profile_theme(owner uuid, workspace uuid, theme jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  kept jsonb;
begin
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  update auth.public_profiles p
  set theme = crm_save_profile_theme.theme, updated_at = pg_catalog.now()
  where p.user_id = crm_save_profile_theme.owner and p.workspace_id = crm_save_profile_theme.workspace
  returning p.theme into kept;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  return kept;
end;
$$;
--> statement-breakpoint
create function crm_save_profile_indexable(owner uuid, workspace uuid, wanted boolean)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  kept boolean;
begin
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  update auth.public_profiles p
  set indexable = crm_save_profile_indexable.wanted, updated_at = pg_catalog.now()
  where p.user_id = crm_save_profile_indexable.owner and p.workspace_id = crm_save_profile_indexable.workspace
  returning p.indexable into kept;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  return kept;
end;
$$;
--> statement-breakpoint
-- A view of `owner`'s page in `workspace`, counted per (person, workspace, day, visitor). Nothing for a person who
-- is not an active member there.
create function crm_count_profile_view(owner uuid, workspace uuid, visitor text)
  returns void
  language sql
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  with visit as (
    insert into auth.profile_views (user_id, workspace_id, day, visitor)
    select u.id, crm_count_profile_view.workspace, (pg_catalog.now() at time zone 'UTC')::date,
      crm_count_profile_view.visitor
    from auth."user" u
    where u.id = crm_count_profile_view.owner
      and public.crm_workspace_member(crm_count_profile_view.owner, crm_count_profile_view.workspace)
    on conflict (user_id, workspace_id, day, visitor)
      do update set views = auth.profile_views.views + 1, last_at = pg_catalog.now()
    returning auth.profile_views.user_id, auth.profile_views.workspace_id, auth.profile_views.day,
      (auth.profile_views.xmax = 0) as is_new
  )
  insert into auth.profile_view_days (user_id, workspace_id, day, views, visitors)
  select visit.user_id, visit.workspace_id, visit.day, 1, case when visit.is_new then 1 else 0 end from visit
  on conflict (user_id, workspace_id, day)
    do update set views = auth.profile_view_days.views + 1,
      visitors = auth.profile_view_days.visitors + excluded.visitors;
end;
--> statement-breakpoint
create function crm_count_item_press(owner uuid, workspace uuid, item uuid, visitor text)
  returns void
  language sql
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  with press as (
    insert into auth.profile_item_presses (item_id, day, visitor)
    select i.id, (pg_catalog.now() at time zone 'UTC')::date, crm_count_item_press.visitor
    from auth.profile_items i
    where i.id = crm_count_item_press.item and i.user_id = crm_count_item_press.owner
      and i.workspace_id = crm_count_item_press.workspace and i.archived_at is null
      and i.kind = any (array['link', 'page', 'contact'])
    on conflict (item_id, day, visitor)
      do update set presses = auth.profile_item_presses.presses + 1, last_at = pg_catalog.now()
    returning auth.profile_item_presses.item_id, auth.profile_item_presses.day
  )
  insert into auth.profile_item_press_days (item_id, day, presses)
  select press.item_id, press.day, 1 from press
  on conflict (item_id, day) do update set presses = auth.profile_item_press_days.presses + 1;
end;
--> statement-breakpoint
create function crm_profile_counts(owner uuid, workspace uuid, from_day date, to_day date)
  returns table (item_id uuid, presses bigint, views bigint, visitors bigint)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.item_id, sum(p.presses), null::bigint, null::bigint
  from auth.profile_item_press_days p
  join auth.profile_items i on i.id = p.item_id
  where i.user_id = crm_profile_counts.owner and i.workspace_id = crm_profile_counts.workspace
    and i.archived_at is null
    and p.day between crm_profile_counts.from_day and crm_profile_counts.to_day
    and crm_profile_counts.to_day - crm_profile_counts.from_day between 0 and 400
    and public.crm_workspace_member(crm_profile_counts.owner, crm_profile_counts.workspace)
  group by p.item_id
  union all
  select null::uuid, null::bigint, coalesce(sum(v.views), 0), coalesce(sum(v.visitors), 0)
  from auth.profile_view_days v
  where v.user_id = crm_profile_counts.owner and v.workspace_id = crm_profile_counts.workspace
    and v.day between crm_profile_counts.from_day and crm_profile_counts.to_day
    and crm_profile_counts.to_day - crm_profile_counts.from_day between 0 and 400
    and public.crm_workspace_member(crm_profile_counts.owner, crm_profile_counts.workspace);
end;
--> statement-breakpoint
create or replace function crm_sweep_profile_counts(max integer)
  returns integer
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  cutoff date := (pg_catalog.now() at time zone 'UTC')::date - 365;
  batch integer := greatest(least(max, 10000), 0);
  gone integer;
  most integer := 0;
begin
  -- Each workspace's cleanup calls it, at about the same time: rows another one holds are left to it.
  delete from auth.profile_views v where (v.user_id, v.workspace_id, v.day, v.visitor) in (
    select o.user_id, o.workspace_id, o.day, o.visitor from auth.profile_views o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  most := greatest(most, gone);
  delete from auth.profile_item_presses p where (p.item_id, p.day, p.visitor) in (
    select o.item_id, o.day, o.visitor from auth.profile_item_presses o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  most := greatest(most, gone);
  delete from auth.profile_view_days v where (v.user_id, v.workspace_id, v.day) in (
    select o.user_id, o.workspace_id, o.day from auth.profile_view_days o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  most := greatest(most, gone);
  delete from auth.profile_item_press_days p where (p.item_id, p.day) in (
    select o.item_id, o.day from auth.profile_item_press_days o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  return greatest(most, gone);
end;
$$;
--> statement-breakpoint
-- Who may run them: crm_app alone, except the pack, which only crm_handle's own functions call (as they always have).
revoke all on function crm_save_public_profile(uuid, uuid, text, text) from public;
--> statement-breakpoint
revoke all on function crm_public_profiles_of(uuid[], uuid) from public;
--> statement-breakpoint
revoke all on function crm_handle_owner(text) from public;
--> statement-breakpoint
revoke all on function crm_handle_taken(text) from public;
--> statement-breakpoint
revoke all on function crm_profile_handles_of(uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_items(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_items_archived(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_items_public(uuid, uuid, smallint, uuid, integer) from public;
--> statement-breakpoint
revoke all on function crm_pack_profile_items(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_save_profile_item(uuid, uuid, uuid, text, jsonb, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_order_profile_items(uuid, uuid, uuid[]) from public;
--> statement-breakpoint
revoke all on function crm_archive_profile_item(uuid, uuid, uuid, boolean) from public;
--> statement-breakpoint
revoke all on function crm_delete_profile_item(uuid, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_place_profile_page(uuid, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_import_profile_links(uuid, uuid, uuid, text, jsonb, jsonb) from public;
--> statement-breakpoint
revoke all on function crm_save_profile_theme(uuid, uuid, jsonb) from public;
--> statement-breakpoint
revoke all on function crm_save_profile_indexable(uuid, uuid, boolean) from public;
--> statement-breakpoint
revoke all on function crm_count_profile_view(uuid, uuid, text) from public;
--> statement-breakpoint
revoke all on function crm_count_item_press(uuid, uuid, uuid, text) from public;
--> statement-breakpoint
revoke all on function crm_profile_counts(uuid, uuid, date, date) from public;
--> statement-breakpoint
grant execute on function crm_save_public_profile(uuid, uuid, text, text) to crm_app;
--> statement-breakpoint
grant execute on function crm_public_profiles_of(uuid[], uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_handle_owner(text) to crm_app;
--> statement-breakpoint
grant execute on function crm_handle_taken(text) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_handles_of(uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_items(uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_items_archived(uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_items_public(uuid, uuid, smallint, uuid, integer) to crm_app;
--> statement-breakpoint
grant execute on function crm_save_profile_item(uuid, uuid, uuid, text, jsonb, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_order_profile_items(uuid, uuid, uuid[]) to crm_app;
--> statement-breakpoint
grant execute on function crm_archive_profile_item(uuid, uuid, uuid, boolean) to crm_app;
--> statement-breakpoint
grant execute on function crm_delete_profile_item(uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_place_profile_page(uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_import_profile_links(uuid, uuid, uuid, text, jsonb, jsonb) to crm_app;
--> statement-breakpoint
grant execute on function crm_save_profile_theme(uuid, uuid, jsonb) to crm_app;
--> statement-breakpoint
grant execute on function crm_save_profile_indexable(uuid, uuid, boolean) to crm_app;
--> statement-breakpoint
grant execute on function crm_count_profile_view(uuid, uuid, text) to crm_app;
--> statement-breakpoint
grant execute on function crm_count_item_press(uuid, uuid, uuid, text) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_counts(uuid, uuid, date, date) to crm_app;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
-- Refuse to finish unless every function is as narrow as it reads: owned by its role, a definer, executable by
-- crm_app alone (crm_workspace_member by crm_handle alone, the pack by nobody), and out of the identity login's
-- reach; and crm_app still holds nothing on the tables.
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.crm_save_public_profile(uuid, uuid, text, text)'::regprocedure,
    'public.crm_public_profiles_of(uuid[], uuid)'::regprocedure,
    'public.crm_handle_owner(text)'::regprocedure,
    'public.crm_handle_taken(text)'::regprocedure,
    'public.crm_profile_handles_of(uuid)'::regprocedure,
    'public.crm_profile_items(uuid, uuid)'::regprocedure,
    'public.crm_profile_items_archived(uuid, uuid)'::regprocedure,
    'public.crm_profile_items_public(uuid, uuid, smallint, uuid, integer)'::regprocedure,
    'public.crm_save_profile_item(uuid, uuid, uuid, text, jsonb, uuid, uuid)'::regprocedure,
    'public.crm_order_profile_items(uuid, uuid, uuid[])'::regprocedure,
    'public.crm_archive_profile_item(uuid, uuid, uuid, boolean)'::regprocedure,
    'public.crm_delete_profile_item(uuid, uuid, uuid)'::regprocedure,
    'public.crm_place_profile_page(uuid, uuid, uuid)'::regprocedure,
    'public.crm_import_profile_links(uuid, uuid, uuid, text, jsonb, jsonb)'::regprocedure,
    'public.crm_save_profile_theme(uuid, uuid, jsonb)'::regprocedure,
    'public.crm_save_profile_indexable(uuid, uuid, boolean)'::regprocedure,
    'public.crm_count_profile_view(uuid, uuid, text)'::regprocedure,
    'public.crm_count_item_press(uuid, uuid, uuid, text)'::regprocedure,
    'public.crm_profile_counts(uuid, uuid, date, date)'::regprocedure
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
  if (select pg_get_userbyid(p.proowner) from pg_proc p
      where p.oid = 'public.crm_pack_profile_items(uuid, uuid)'::regprocedure) <> 'crm_handle'
    or has_function_privilege('crm_app', 'public.crm_pack_profile_items(uuid, uuid)', 'EXECUTE')
    or has_function_privilege('crm_identity', 'public.crm_pack_profile_items(uuid, uuid)', 'EXECUTE') then
    raise exception 'crm_pack_profile_items must be owned by crm_handle and reachable only from its own functions';
  end if;
  foreach fn in array array[
    'public.crm_booking_page_by_address(uuid, uuid, text)'::regprocedure,
    'public.crm_booking_profile_pages(uuid, uuid, smallint, uuid, text, integer)'::regprocedure,
    'public.crm_booking_owner_slugs(uuid, uuid, text)'::regprocedure,
    'public.crm_booking_owner_pages(uuid, uuid, uuid[])'::regprocedure,
    'public.crm_workspace_member(uuid, uuid)'::regprocedure
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = fn) <> 'crm_booking_lookup'
      or has_function_privilege('crm_identity', fn, 'EXECUTE') then
      raise exception '% must be owned by crm_booking_lookup and out of the identity login''s reach', fn;
    end if;
  end loop;
  if (select pg_get_userbyid(p.proowner) from pg_proc p
      where p.oid = 'public.crm_form_owner_forms(uuid, uuid, uuid[])'::regprocedure) <> 'crm_form_lookup'
    or has_function_privilege('crm_identity', 'public.crm_form_owner_forms(uuid, uuid, uuid[])', 'EXECUTE') then
    raise exception 'crm_form_owner_forms must be owned by crm_form_lookup and out of the identity login''s reach';
  end if;
  -- The membership reader is crm_handle's alone: not crm_app's, not the identity login's.
  if has_function_privilege('crm_app', 'public.crm_workspace_member(uuid, uuid)', 'EXECUTE')
    or not has_function_privilege('crm_handle', 'public.crm_workspace_member(uuid, uuid)', 'EXECUTE') then
    raise exception 'crm_workspace_member must be executable by crm_handle alone';
  end if;
  if has_table_privilege('crm_app', 'auth.profile_items', 'SELECT')
    or has_table_privilege('crm_app', 'auth.public_handles', 'SELECT')
    or has_table_privilege('crm_app', 'auth.public_profiles', 'SELECT')
    or has_table_privilege('crm_handle', 'public.members', 'SELECT')
    or has_table_privilege('crm_handle', 'public.booking_pages', 'SELECT') then
    raise exception 'the link page tables are reached only through crm_handle''s functions, which read no tenant table';
  end if;
  -- No booking page, form or address resolves outside its own workspace any more, and a slug may repeat across a
  -- person's workspaces: the old cross workspace unique is gone.
  if exists (select 1 from pg_indexes where indexname = 'booking_pages_owner_slug') then
    raise exception 'booking_pages_owner_slug must be gone';
  end if;
end
$$;
