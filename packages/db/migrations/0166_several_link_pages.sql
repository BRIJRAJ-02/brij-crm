-- Several link pages (spec 0064, slice 2, AC-6413 to AC-6417; 2 Nov 2026, lane P1). Numbered 0166, after every
-- migration main and the open lanes hold (main ends at 0156; 0157 to 0165 are claimed on lane branches).
--
-- A person may now keep up to 5 link pages in one workspace, each with its own handle, private name, look, blocks,
-- search setting, share image and numbers. Until now the page was keyed by (`user_id`, `workspace_id`); from here
-- every page has its own `id`, and what hangs off a page is keyed by it.
--
-- What changes, in the spec's safe sequence (add the columns nullable, backfill, add the keys, then switch reads and
-- writes):
-- * `auth.public_profiles` gains `id` (the new primary key, backfilled), `name` (private, at most 40), `is_primary`
--   and `position`. The old (`user_id`, `workspace_id`) key becomes a plain index, a partial unique index keeps one
--   primary page per person and workspace, and a trigger keeps at most 5 (54000 `PROFILE_PAGE_LIMIT`), makes the
--   first page its person's primary, and places each new page last. Every page that exists today becomes its
--   person's primary page, so no visitor sees any change (AC-6417).
-- * `auth.profile_items` gains `profile_id`, backfilled from the person's page in that workspace, with a foreign key
--   to the page on delete cascade. Its "once" indexes and the deferred place key move to (`profile_id`, ...). A
--   block whose person has no page there (the handle cap can leave a membership without one) keeps a null
--   `profile_id`, reaches nobody, and is adopted by the first page that person makes there; a check, not valid for
--   those old rows, refuses any new block without a page.
-- * `auth.profile_views`, `auth.profile_view_days`, `auth.profile_view_source_days` and `auth.profile_booking_days`
--   gain `profile_id`, backfilled, and become keyed by it, going with their page. Presses are keyed by their block,
--   which is already one page's, so they need nothing.
-- * `auth.public_handles` gains `profile_id` (null for a handle that names nobody, and for one whose page was
--   deleted): each handle finds its page. An old handle of a deleted page still names its person, so it stays
--   reserved to them (spec 0056) and finds their primary page.
-- * `auth.profile_images` stays the person's pictures in that workspace, shared by their pages there. It went with
--   the page through the old key; it now goes with the person's last page there (`crm_public_profiles_drop_images`,
--   an after delete trigger, crm_handle's), which is what the purge deleting the pages takes with it.
-- * Every definer that reads or writes one page takes a last, optional `profile`: null is the person's primary page,
--   so every caller that names none keeps reading and writing exactly the page it did. A page that is not the
--   person's own in that workspace is no page at all. Those whose argument list grows are dropped and made again
--   with the same owner, settings and grants. `crm_handle_owner` answers the page's id and private name.
-- * New definers, crm_handle's, executable by crm_app alone: `crm_profile_pages` (the switcher's list),
--   `crm_create_profile_page`, `crm_rename_profile_page`, `crm_set_primary_profile_page` and
--   `crm_delete_profile_page` (refused for a person's only page; the handle stays reserved to them).
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
set local row_security = on;
--> statement-breakpoint
alter table "auth"."public_profiles" add column "id" uuid;
--> statement-breakpoint
alter table "auth"."public_profiles" add column "name" text not null default '';
--> statement-breakpoint
alter table "auth"."public_profiles" add column "is_primary" boolean not null default false;
--> statement-breakpoint
alter table "auth"."public_profiles" add column "position" smallint;
--> statement-breakpoint
update "auth"."public_profiles" set "id" = public.uuidv7(), "is_primary" = true, "position" = 0 where "id" is null;
--> statement-breakpoint
alter table "auth"."public_profiles" alter column "id" set default public.uuidv7();
--> statement-breakpoint
alter table "auth"."public_profiles" alter column "id" set not null;
--> statement-breakpoint
alter table "auth"."public_profiles" alter column "position" set not null;
--> statement-breakpoint
alter table "auth"."public_profiles" add constraint "public_profiles_name"
  check (char_length("name") <= 40 and "name" !~ '[[:cntrl:]]' and "name" = btrim("name"));
--> statement-breakpoint
alter table "auth"."public_profiles" add constraint "public_profiles_position" check ("position" between 0 and 99);
--> statement-breakpoint
-- The three tables that pointed at the old key let go of it first; each takes the new one below.
alter table "auth"."profile_view_source_days" drop constraint "profile_view_source_days_page_fk";
--> statement-breakpoint
alter table "auth"."profile_booking_days" drop constraint "profile_booking_days_page_fk";
--> statement-breakpoint
alter table "auth"."profile_images" drop constraint "profile_images_page_fk";
--> statement-breakpoint
alter table "auth"."public_profiles" drop constraint "public_profiles_pkey";
--> statement-breakpoint
alter table "auth"."public_profiles" add constraint "public_profiles_pkey" primary key ("id");
--> statement-breakpoint
create index "public_profiles_user_workspace" on "auth"."public_profiles" using btree ("user_id", "workspace_id");
--> statement-breakpoint
create unique index "public_profiles_primary" on "auth"."public_profiles" using btree ("user_id", "workspace_id")
  where "is_primary";
--> statement-breakpoint
-- Blocks.
alter table "auth"."profile_items" add column "profile_id" uuid;
--> statement-breakpoint
update "auth"."profile_items" i set "profile_id" = p."id"
from "auth"."public_profiles" p
where p."user_id" = i."user_id" and p."workspace_id" = i."workspace_id" and i."profile_id" is null;
--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_page_fk"
  foreign key ("profile_id") references "auth"."public_profiles" ("id") on delete cascade;
--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_on_a_page" check ("profile_id" is not null) not valid;
--> statement-breakpoint
alter table "auth"."profile_items" drop constraint "profile_items_place";
--> statement-breakpoint
alter table "auth"."profile_items" add constraint "profile_items_place" unique ("profile_id", "position")
  deferrable initially deferred;
--> statement-breakpoint
drop index "auth"."profile_items_page_once";
--> statement-breakpoint
create unique index "profile_items_page_once" on "auth"."profile_items" using btree ("profile_id", "page_id")
  where "kind" = 'page' and "archived_at" is null;
--> statement-breakpoint
drop index "auth"."profile_items_form_once";
--> statement-breakpoint
create unique index "profile_items_form_once" on "auth"."profile_items" using btree ("profile_id", "form_id")
  where "kind" = 'form' and "archived_at" is null;
--> statement-breakpoint
drop index "auth"."profile_items_heading_once";
--> statement-breakpoint
create unique index "profile_items_heading_once" on "auth"."profile_items"
  using btree ("profile_id", lower(btrim("data" ->> 'title')))
  where "kind" = 'heading' and "archived_at" is null;
--> statement-breakpoint
drop index "auth"."profile_items_archived";
--> statement-breakpoint
create index "profile_items_archived" on "auth"."profile_items" using btree ("profile_id", "archived_at")
  where "archived_at" is not null;
--> statement-breakpoint
-- Views. A count can only exist for a page (its definer refused any other), so a row with none has nothing to
-- belong to and goes.
alter table "auth"."profile_views" add column "profile_id" uuid;
--> statement-breakpoint
update "auth"."profile_views" v set "profile_id" = p."id"
from "auth"."public_profiles" p
where p."user_id" = v."user_id" and p."workspace_id" = v."workspace_id" and v."profile_id" is null;
--> statement-breakpoint
delete from "auth"."profile_views" where "profile_id" is null;
--> statement-breakpoint
alter table "auth"."profile_views" alter column "profile_id" set not null;
--> statement-breakpoint
alter table "auth"."profile_views" drop constraint "profile_views_pkey";
--> statement-breakpoint
alter table "auth"."profile_views" add constraint "profile_views_pkey" primary key ("profile_id", "day", "visitor");
--> statement-breakpoint
alter table "auth"."profile_views" add constraint "profile_views_page_fk"
  foreign key ("profile_id") references "auth"."public_profiles" ("id") on delete cascade;
--> statement-breakpoint
alter table "auth"."profile_view_days" add column "profile_id" uuid;
--> statement-breakpoint
update "auth"."profile_view_days" v set "profile_id" = p."id"
from "auth"."public_profiles" p
where p."user_id" = v."user_id" and p."workspace_id" = v."workspace_id" and v."profile_id" is null;
--> statement-breakpoint
delete from "auth"."profile_view_days" where "profile_id" is null;
--> statement-breakpoint
alter table "auth"."profile_view_days" alter column "profile_id" set not null;
--> statement-breakpoint
alter table "auth"."profile_view_days" drop constraint "profile_view_days_pkey";
--> statement-breakpoint
alter table "auth"."profile_view_days" add constraint "profile_view_days_pkey" primary key ("profile_id", "day");
--> statement-breakpoint
alter table "auth"."profile_view_days" add constraint "profile_view_days_page_fk"
  foreign key ("profile_id") references "auth"."public_profiles" ("id") on delete cascade;
--> statement-breakpoint
-- The two forced row security tables answer their policy's role alone, so the owner reads them only with the force
-- lifted, for this transaction's backfill.
alter table "auth"."profile_view_source_days" no force row level security;
--> statement-breakpoint
alter table "auth"."profile_booking_days" no force row level security;
--> statement-breakpoint
alter table "auth"."profile_view_source_days" add column "profile_id" uuid;
--> statement-breakpoint
update "auth"."profile_view_source_days" v set "profile_id" = p."id"
from "auth"."public_profiles" p
where p."user_id" = v."user_id" and p."workspace_id" = v."workspace_id" and v."profile_id" is null;
--> statement-breakpoint
delete from "auth"."profile_view_source_days" where "profile_id" is null;
--> statement-breakpoint
alter table "auth"."profile_view_source_days" alter column "profile_id" set not null;
--> statement-breakpoint
alter table "auth"."profile_view_source_days" drop constraint "profile_view_source_days_pkey";
--> statement-breakpoint
alter table "auth"."profile_view_source_days" add constraint "profile_view_source_days_pkey"
  primary key ("profile_id", "day", "fact", "value");
--> statement-breakpoint
alter table "auth"."profile_view_source_days" add constraint "profile_view_source_days_page_fk"
  foreign key ("profile_id") references "auth"."public_profiles" ("id") on delete cascade;
--> statement-breakpoint
alter table "auth"."profile_booking_days" add column "profile_id" uuid;
--> statement-breakpoint
update "auth"."profile_booking_days" v set "profile_id" = p."id"
from "auth"."public_profiles" p
where p."user_id" = v."user_id" and p."workspace_id" = v."workspace_id" and v."profile_id" is null;
--> statement-breakpoint
delete from "auth"."profile_booking_days" where "profile_id" is null;
--> statement-breakpoint
alter table "auth"."profile_booking_days" alter column "profile_id" set not null;
--> statement-breakpoint
alter table "auth"."profile_booking_days" drop constraint "profile_booking_days_pkey";
--> statement-breakpoint
alter table "auth"."profile_booking_days" add constraint "profile_booking_days_pkey" primary key ("profile_id", "day");
--> statement-breakpoint
alter table "auth"."profile_booking_days" add constraint "profile_booking_days_page_fk"
  foreign key ("profile_id") references "auth"."public_profiles" ("id") on delete cascade;
--> statement-breakpoint
alter table "auth"."profile_view_source_days" force row level security;
--> statement-breakpoint
alter table "auth"."profile_booking_days" force row level security;
--> statement-breakpoint
-- Handles. The key is checked at the commit: a new page and its first handle name each other.
alter table "auth"."public_handles" add column "profile_id" uuid;
--> statement-breakpoint
update "auth"."public_handles" h set "profile_id" = p."id"
from "auth"."public_profiles" p
where p."user_id" = h."user_id" and p."workspace_id" = h."workspace_id" and h."profile_id" is null;
--> statement-breakpoint
alter table "auth"."public_handles" add constraint "public_handles_page_fk"
  foreign key ("profile_id") references "auth"."public_profiles" ("id") on delete set null
  deferrable initially deferred;
--> statement-breakpoint
create index "public_handles_page" on "auth"."public_handles" using btree ("profile_id")
  where "profile_id" is not null;
--> statement-breakpoint
-- Who writes what: the page's new columns and the handle's page through crm_handle's definers, and a whole page
-- deleted by its owner.
grant update ("name", "is_primary", "position") on "auth"."public_profiles" to crm_handle;
--> statement-breakpoint
grant delete on "auth"."public_profiles" to crm_handle;
--> statement-breakpoint
grant update ("profile_id") on "auth"."public_handles" to crm_handle;
--> statement-breakpoint
grant update ("profile_id") on "auth"."profile_items" to crm_handle;
--> statement-breakpoint
-- A page's place and primacy as it is made, and the limit of 5 (AC-6413), for every way a page is made: the first
-- page of a person in a workspace is their primary page, every page goes last, and a sixth is refused. Then the
-- blocks that person kept there with no page are adopted by it. An invoker's trigger: it runs as whoever made the
-- page, crm_handle's definers in the app.
create function crm_public_profiles_place()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
declare
  held integer;
  last smallint;
begin
  select pg_catalog.count(*), max(p.position) into held, last
  from auth.public_profiles p where p.user_id = new.user_id and p.workspace_id = new.workspace_id;
  if held >= 5 then
    raise exception using errcode = '54000', message = 'PROFILE_PAGE_LIMIT', detail = 'pages';
  end if;
  if held = 0 then
    new.is_primary := true;
  end if;
  new.position := coalesce(last + 1, 0);
  return new;
end;
$$;
--> statement-breakpoint
create trigger "public_profiles_place" before insert on "auth"."public_profiles"
  for each row execute function crm_public_profiles_place();
--> statement-breakpoint
create function crm_public_profiles_adopt()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  if new.is_primary then
    update auth.profile_items i set profile_id = new.id
    where i.user_id = new.user_id and i.workspace_id = new.workspace_id and i.profile_id is null;
  end if;
  return null;
end;
$$;
--> statement-breakpoint
create trigger "public_profiles_adopt" after insert on "auth"."public_profiles"
  for each row execute function crm_public_profiles_adopt();
--> statement-breakpoint
-- A row written the old way, naming its person and workspace but no page (code that predates several pages, a
-- hand written fix), lands on that person's primary page there rather than nowhere. An invoker's trigger.
create function crm_profile_rows_page()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  if new.profile_id is null then
    select p.id into new.profile_id from auth.public_profiles p
    where p.user_id = new.user_id and p.workspace_id = new.workspace_id and p.is_primary;
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger "profile_items_page" before insert on "auth"."profile_items"
  for each row execute function crm_profile_rows_page();
--> statement-breakpoint
create trigger "profile_views_page" before insert on "auth"."profile_views"
  for each row execute function crm_profile_rows_page();
--> statement-breakpoint
create trigger "profile_view_days_page" before insert on "auth"."profile_view_days"
  for each row execute function crm_profile_rows_page();
--> statement-breakpoint
create trigger "profile_view_source_days_page" before insert on "auth"."profile_view_source_days"
  for each row execute function crm_profile_rows_page();
--> statement-breakpoint
create trigger "profile_booking_days_page" before insert on "auth"."profile_booking_days"
  for each row execute function crm_profile_rows_page();
--> statement-breakpoint
revoke all on function crm_public_profiles_place() from public;
--> statement-breakpoint
revoke all on function crm_public_profiles_adopt() from public;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- Which of `owner`'s pages in `workspace` a call means: `profile` when it is theirs there, their primary page when
-- `profile` is null, and null otherwise (a page of somebody else's, or of another workspace, is no page at all).
-- Not a definer: it runs only inside crm_handle's own functions, as crm_handle.
create function crm_profile_page_of(owner uuid, workspace uuid, profile uuid)
  returns uuid
  language sql
  stable
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.id from auth.public_profiles p
  where p.user_id = crm_profile_page_of.owner and p.workspace_id = crm_profile_page_of.workspace
    and case when crm_profile_page_of.profile is null then p.is_primary else p.id = crm_profile_page_of.profile end
  limit 1;
end;
--> statement-breakpoint
-- A person's pictures in a workspace go with their last page there, as they went with its one page before: the
-- purge, which deletes a workspace's pages, takes them too. A definer, since the pictures answer crm_handle's policy
-- alone and the purge runs as crm_purge. A trigger function, so nothing can call it but the trigger below.
create function crm_public_profiles_drop_images()
  returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
begin
  if not exists (select 1 from auth.public_profiles p
      where p.user_id = old.user_id and p.workspace_id = old.workspace_id) then
    delete from auth.profile_images m where m.user_id = old.user_id and m.workspace_id = old.workspace_id;
  end if;
  return null;
end;
$$;
--> statement-breakpoint
-- The functions whose argument list grows, dropped in the order their dependants need.
drop function crm_profile_image_public(uuid, uuid, uuid);
--> statement-breakpoint
drop function crm_profile_items_public(uuid, uuid, smallint, uuid, integer);
--> statement-breakpoint
drop function crm_profile_items(uuid, uuid);
--> statement-breakpoint
drop function crm_profile_items_archived(uuid, uuid);
--> statement-breakpoint
drop function crm_save_profile_item(uuid, uuid, uuid, text, jsonb, uuid, uuid);
--> statement-breakpoint
drop function crm_order_profile_items(uuid, uuid, uuid[]);
--> statement-breakpoint
drop function crm_archive_profile_item(uuid, uuid, uuid, boolean);
--> statement-breakpoint
drop function crm_delete_profile_item(uuid, uuid, uuid);
--> statement-breakpoint
drop function crm_import_profile_links(uuid, uuid, uuid, text, jsonb, jsonb);
--> statement-breakpoint
drop function crm_save_profile_share_image(uuid, uuid, bytea, text);
--> statement-breakpoint
drop function crm_profile_share_image(uuid, uuid);
--> statement-breakpoint
drop function crm_save_profile_theme(uuid, uuid, jsonb);
--> statement-breakpoint
drop function crm_save_profile_indexable(uuid, uuid, boolean);
--> statement-breakpoint
drop function crm_profile_counts(uuid, uuid, date, date);
--> statement-breakpoint
drop function crm_profile_insights(uuid, uuid, date, date);
--> statement-breakpoint
drop function crm_count_profile_view(uuid, uuid, text, text, text, text, text);
--> statement-breakpoint
drop function crm_save_profile_accent(uuid, uuid, text, text);
--> statement-breakpoint
drop function crm_save_profile_image(uuid, uuid, text, text, text, text);
--> statement-breakpoint
drop function crm_profile_look(uuid, uuid);
--> statement-breakpoint
drop function crm_save_profile_qr_style(uuid, uuid, jsonb);
--> statement-breakpoint
drop function crm_profile_qr_style(uuid, uuid);
--> statement-breakpoint
drop function crm_show_public_profile(uuid, uuid);
--> statement-breakpoint
drop function crm_set_public_profile_live(uuid, uuid, boolean);
--> statement-breakpoint
drop function crm_save_public_profile(uuid, uuid, text, text);
--> statement-breakpoint
drop function crm_handle_owner(text);
--> statement-breakpoint
drop function crm_pack_profile_items(uuid, uuid);
--> statement-breakpoint
-- Places one page's live blocks 0, 1, 2 … in the order they stand. Not a definer: it runs only inside crm_handle's
-- own functions, as crm_handle.
create function crm_pack_profile_items(profile uuid)
  returns void
  language sql
  set search_path = pg_catalog, pg_temp
begin atomic
  update auth.profile_items i
  set position = (r.n - 1)::smallint
  from (
    select p.id, pg_catalog.row_number() over (order by p.position, p.id) as n
    from auth.profile_items p
    where p.profile_id = crm_pack_profile_items.profile and p.archived_at is null
  ) r
  where i.id = r.id and i.position is distinct from (r.n - 1)::smallint;
end;
--> statement-breakpoint
-- The page a handle names, by its current or an old handle: the person and workspace, the page's id (never its
-- private name, which is its owner's alone), current handle, bio, look, search setting, share image and whether it is public, the person's name and picture
-- (unless hidden), never an email. A handle whose page was deleted still names its person, and finds their primary
-- page. No row for a handle that names nobody, or unless that person is still an active member of that workspace.
create function crm_handle_owner(wanted text)
  returns table (user_id uuid, workspace_id uuid, handle text, bio text, name text, image text, theme jsonb,
    indexable boolean, share_image_version text, shown boolean, profile_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.user_id, p.workspace_id, p.handle, p.bio, u.name,
    case when coalesce(k.picture_hidden, false) then null else u.image end,
    p.theme, p.indexable, p.share_image_version, p.shown_at is not null, p.id
  from auth.public_handles h
  join auth.public_profiles p on p.user_id = h.user_id and p.workspace_id = h.workspace_id
    and (p.id = h.profile_id or (h.profile_id is null and p.is_primary))
  join auth."user" u on u.id = h.user_id
  left join auth.user_prefs k on k.user_id = h.user_id
  where h.handle = crm_handle_owner.wanted and h.user_id is not null
    and public.crm_workspace_member(h.user_id, h.workspace_id)
  limit 1;
end;
--> statement-breakpoint
create function crm_profile_items(owner uuid, workspace uuid, profile uuid default null)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid, form_id uuid,
    archived_at timestamptz, updated_at timestamptz)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.form_id, i.archived_at, i.updated_at
  from auth.profile_items i
  where i.profile_id = public.crm_profile_page_of(crm_profile_items.owner, crm_profile_items.workspace,
      crm_profile_items.profile)
    and i.archived_at is null
    and public.crm_workspace_member(crm_profile_items.owner, crm_profile_items.workspace)
  order by i.position, i.id
  limit 1000;
end;
--> statement-breakpoint
create function crm_profile_items_archived(owner uuid, workspace uuid, profile uuid default null)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid, form_id uuid,
    archived_at timestamptz, updated_at timestamptz)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.form_id, i.archived_at, i.updated_at
  from auth.profile_items i
  where i.profile_id = public.crm_profile_page_of(crm_profile_items_archived.owner,
      crm_profile_items_archived.workspace, crm_profile_items_archived.profile)
    and i.archived_at is not null
    and public.crm_workspace_member(crm_profile_items_archived.owner, crm_profile_items_archived.workspace)
  order by i.archived_at desc, i.id
  limit 100;
end;
--> statement-breakpoint
-- The public read, as 0156's, of one page.
create function crm_profile_items_public(owner uuid, workspace uuid, after_position smallint, after_id uuid,
  max integer, profile uuid default null)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid, form_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.form_id
  from auth.profile_items i
  where i.profile_id = public.crm_profile_page_of(crm_profile_items_public.owner, crm_profile_items_public.workspace,
      crm_profile_items_public.profile)
    and i.archived_at is null
    and ((i.data ->> 'showFrom') is null or (i.data ->> 'showFrom') collate "C"
      <= pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') collate "C")
    and ((i.data ->> 'hideAfter') is null or (i.data ->> 'hideAfter') collate "C"
      > pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') collate "C")
    and (crm_profile_items_public.after_id is null
      or (i.position, i.id) > (crm_profile_items_public.after_position, crm_profile_items_public.after_id))
    and public.crm_workspace_member(crm_profile_items_public.owner, crm_profile_items_public.workspace)
  order by i.position, i.id
  limit least(greatest(crm_profile_items_public.max, 1), 61);
end;
--> statement-breakpoint
-- A picture a visitor may load, as 0156's: only while a live block of that page, inside its window, names it.
create function crm_profile_image_public(owner uuid, workspace uuid, image uuid, profile uuid default null)
  returns table (path text, content_type text, width integer, height integer)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select m.path, m.content_type, m.width, m.height
  from auth.profile_images m
  where m.id = crm_profile_image_public.image and m.user_id = crm_profile_image_public.owner
    and m.workspace_id = crm_profile_image_public.workspace
    and public.crm_workspace_member(crm_profile_image_public.owner, crm_profile_image_public.workspace)
    and exists (
      select 1 from public.crm_profile_items_public(crm_profile_image_public.owner, crm_profile_image_public.workspace,
        0::smallint, null::uuid, 61, crm_profile_image_public.profile) i
      where m.id in (select w.image from public.crm_profile_item_images(i.data) w(image))
    );
end;
--> statement-breakpoint
-- Adds or edits one block of one page, as 0156's.
create function crm_save_profile_item(owner uuid, workspace uuid, item uuid, wanted_kind text, given jsonb, page uuid,
  form uuid, profile uuid default null)
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
  the_page uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  the_page := public.crm_profile_page_of(owner, workspace, profile);
  perform public.crm_check_profile_item(wanted_kind, given,
    case when wanted_kind in ('page', 'form', 'times') then workspace end, page, form);
  if wanted_kind in ('page', 'times') and not exists (
    select 1 from public.crm_booking_owner_pages(owner, workspace, array[page]) o where o.page_id = page
  ) then
    raise exception using errcode = '42704', message = 'PROFILE_TARGET_MISSING';
  end if;
  if wanted_kind = 'form' and not exists (
    select 1 from public.crm_form_owner_forms(owner, workspace, array[form]) o where o.form_id = form
  ) then
    raise exception using errcode = '42704', message = 'PROFILE_TARGET_MISSING';
  end if;
  if exists (
    select 1 from public.crm_profile_item_images(given) w(image)
    where not exists (select 1 from auth.profile_images m
      where m.id = w.image and m.user_id = owner and m.workspace_id = workspace)
  ) then
    raise exception using errcode = '42704', message = 'PROFILE_IMAGE_MISSING', detail = 'image';
  end if;
  -- The block's own refusals first, as before several pages; then a page to put it on.
  if the_page is null then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  if wanted_kind = 'link' and given ->> 'style' = 'featured' and (
    select count(*) from auth.profile_items i
    where i.profile_id = the_page and i.archived_at is null and i.kind = 'link'
      and i.data ->> 'style' = 'featured' and i.id <> item
  ) >= 3 then
    raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'featured';
  end if;
  select * into held from auth.profile_items i where i.id = item for update;
  if found then
    if held.user_id <> owner or held.workspace_id <> workspace or held.profile_id is distinct from the_page then
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
    from auth.profile_items i where i.profile_id = the_page;
    if live >= 60 or kept >= 200 then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'items';
    end if;
    if live_kind >= public.crm_profile_kind_cap(wanted_kind) then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = wanted_kind;
    end if;
    insert into auth.profile_items (id, user_id, workspace_id, profile_id, kind, position, data, page_id, form_id)
    values (item, owner, workspace, the_page, wanted_kind,
      (select coalesce(max(i.position) + 1, 0) from auth.profile_items i
        where i.profile_id = the_page and i.archived_at is null),
      given, page, form);
  end if;
  return query
    select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.form_id, i.archived_at, i.updated_at
    from auth.profile_items i where i.id = item;
end;
$$;
--> statement-breakpoint
create function crm_order_profile_items(owner uuid, workspace uuid, ids uuid[], profile uuid default null)
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  the_page uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  the_page := public.crm_profile_page_of(owner, workspace, profile);
  if the_page is null
    or ids is null
    or (select count(distinct w.id) from pg_catalog.unnest(ids) w(id)) <> pg_catalog.cardinality(ids)
    or (select count(*) from auth.profile_items i where i.profile_id = the_page and i.archived_at is null)
      <> pg_catalog.cardinality(ids)
    or exists (
      select 1 from pg_catalog.unnest(ids) w(id)
      where not exists (
        select 1 from auth.profile_items i
        where i.id = w.id and i.profile_id = the_page and i.archived_at is null
      )
    ) then
    raise exception using errcode = '22023', message = 'PROFILE_ORDER_STALE';
  end if;
  update auth.profile_items i
  set position = (w.n - 1)::smallint, updated_at = pg_catalog.now()
  from pg_catalog.unnest(ids) with ordinality w(id, n)
  where i.id = w.id and i.profile_id = the_page
    and i.position is distinct from (w.n - 1)::smallint;
end;
$$;
--> statement-breakpoint
create function crm_archive_profile_item(owner uuid, workspace uuid, item uuid, archived boolean,
  profile uuid default null)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  held auth.profile_items%rowtype;
  live integer;
  live_kind integer;
  featured integer;
  the_page uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  the_page := public.crm_profile_page_of(owner, workspace, profile);
  select * into held from auth.profile_items i
  where i.id = item and i.profile_id = the_page for update;
  if not found then
    return false;
  end if;
  if archived and held.archived_at is null then
    update auth.profile_items i set archived_at = pg_catalog.now(), position = null, updated_at = pg_catalog.now()
    where i.id = item;
    perform public.crm_pack_profile_items(the_page);
  elsif not archived and held.archived_at is not null then
    select count(*), count(*) filter (where i.kind = held.kind),
      count(*) filter (where i.kind = 'link' and i.data ->> 'style' = 'featured')
    into live, live_kind, featured
    from auth.profile_items i where i.profile_id = the_page and i.archived_at is null;
    if live >= 60 then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'items';
    end if;
    if live_kind >= public.crm_profile_kind_cap(held.kind) then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = held.kind;
    end if;
    if held.kind = 'link' and held.data ->> 'style' = 'featured' and featured >= 3 then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'featured';
    end if;
    update auth.profile_items i
    set archived_at = null, updated_at = pg_catalog.now(),
      position = (select coalesce(max(p.position) + 1, 0) from auth.profile_items p
        where p.profile_id = the_page and p.archived_at is null)
    where i.id = item;
  end if;
  return true;
end;
$$;
--> statement-breakpoint
create function crm_delete_profile_item(owner uuid, workspace uuid, item uuid, profile uuid default null)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  the_page uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  the_page := public.crm_profile_page_of(owner, workspace, profile);
  delete from auth.profile_items i where i.id = item and i.profile_id = the_page;
  if not found then
    return false;
  end if;
  perform public.crm_pack_profile_items(the_page);
  return true;
end;
$$;
--> statement-breakpoint
-- Puts one booking page at the end of `owner`'s primary link page in `workspace`, once, as it is made Public, as
-- 0114's: nothing when the owner is not an active member there or has no page there, when a block of that page names
-- it already, or past a limit.
create or replace function crm_place_profile_page(owner uuid, workspace uuid, page uuid)
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  the_page uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  if workspace is null or page is null or not public.crm_workspace_member(owner, workspace) then
    return;
  end if;
  the_page := public.crm_profile_page_of(owner, workspace, null);
  if the_page is null
    or exists (select 1 from auth.profile_items i where i.profile_id = the_page and i.page_id = page)
    or (select count(*) from auth.profile_items i where i.profile_id = the_page and i.archived_at is null) >= 60
    or (select count(*) from auth.profile_items i where i.profile_id = the_page) >= 200 then
    return;
  end if;
  insert into auth.profile_items (id, user_id, workspace_id, profile_id, kind, position, data, page_id)
  values (public.uuidv7(), owner, workspace, the_page, 'page',
    (select coalesce(max(i.position) + 1, 0) from auth.profile_items i
      where i.profile_id = the_page and i.archived_at is null),
    '{}'::jsonb, page);
end;
$$;
--> statement-breakpoint
create function crm_import_profile_links(owner uuid, workspace uuid, import uuid, source text, blocks jsonb,
  skipped jsonb, profile uuid default null)
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
  the_page uuid;
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
  the_page := public.crm_profile_page_of(owner, workspace, profile);
  if the_page is null then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  if pg_catalog.jsonb_array_length(blocks) > 40 then
    raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'link';
  end if;
  select count(*) into recent from auth.link_imports i
  where i.user_id = owner and i.created_at > pg_catalog.now() - interval '1 hour';
  if recent >= 5 then
    raise exception using errcode = '54000', message = 'LINK_IMPORT_LIMIT', detail = 'imports';
  end if;
  select count(*) into kept from auth.profile_items i where i.profile_id = the_page;
  if kept + pg_catalog.jsonb_array_length(blocks) > 200 then
    raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'items';
  end if;
  for block in select * from pg_catalog.jsonb_array_elements(blocks) loop
    perform public.crm_check_profile_item('link', block -> 'data', null, null, null);
    insert into auth.profile_items (id, user_id, workspace_id, profile_id, kind, position, data, archived_at)
    values ((block ->> 'id')::uuid, owner, workspace, the_page, 'link', null, block -> 'data', pg_catalog.now());
    ids := ids || (block ->> 'id')::uuid;
  end loop;
  insert into auth.link_imports (id, user_id, source, item_ids, skipped)
  values (import, owner, source, ids, skipped);
  return query select false, coalesce(pg_catalog.array_length(ids, 1), 0);
end;
$$;
--> statement-breakpoint
create function crm_save_profile_share_image(owner uuid, workspace uuid, bytes bytea, kind text,
  profile uuid default null)
  returns text
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  kept text;
begin
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  update auth.public_profiles p
  set share_image = crm_save_profile_share_image.bytes,
      share_image_type = case when crm_save_profile_share_image.bytes is null then null
        else crm_save_profile_share_image.kind end,
      share_image_version = case when crm_save_profile_share_image.bytes is null then null
        else substr(md5(crm_save_profile_share_image.bytes), 1, 12) end,
      updated_at = pg_catalog.now()
  where p.id = public.crm_profile_page_of(owner, workspace, profile)
  returning p.share_image_version into kept;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  return kept;
end;
$$;
--> statement-breakpoint
create function crm_profile_share_image(owner uuid, workspace uuid, profile uuid default null)
  returns table (bytes bytea, kind text, version text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.share_image, p.share_image_type, p.share_image_version
  from auth.public_profiles p
  where p.id = public.crm_profile_page_of(crm_profile_share_image.owner, crm_profile_share_image.workspace,
      crm_profile_share_image.profile)
    and p.share_image is not null
    and public.crm_workspace_member(p.user_id, p.workspace_id);
end;
--> statement-breakpoint
create function crm_save_profile_theme(owner uuid, workspace uuid, theme jsonb, profile uuid default null)
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
  where p.id = public.crm_profile_page_of(owner, workspace, profile)
  returning p.theme into kept;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  return kept;
end;
$$;
--> statement-breakpoint
create function crm_save_profile_indexable(owner uuid, workspace uuid, wanted boolean, profile uuid default null)
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
  where p.id = public.crm_profile_page_of(owner, workspace, profile)
  returning p.indexable into kept;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  return kept;
end;
$$;
--> statement-breakpoint
create function crm_profile_counts(owner uuid, workspace uuid, from_day date, to_day date, profile uuid default null)
  returns table (item_id uuid, presses bigint, views bigint, visitors bigint)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.item_id, sum(p.presses), null::bigint, null::bigint
  from auth.profile_item_press_days p
  join auth.profile_items i on i.id = p.item_id
  where i.profile_id = public.crm_profile_page_of(crm_profile_counts.owner, crm_profile_counts.workspace,
      crm_profile_counts.profile)
    and i.archived_at is null
    and p.day between crm_profile_counts.from_day and crm_profile_counts.to_day
    and crm_profile_counts.to_day - crm_profile_counts.from_day between 0 and 400
    and public.crm_workspace_member(crm_profile_counts.owner, crm_profile_counts.workspace)
  group by p.item_id
  union all
  select null::uuid, null::bigint, coalesce(sum(v.views), 0), coalesce(sum(v.visitors), 0)
  from auth.profile_view_days v
  where v.profile_id = public.crm_profile_page_of(crm_profile_counts.owner, crm_profile_counts.workspace,
      crm_profile_counts.profile)
    and v.day between crm_profile_counts.from_day and crm_profile_counts.to_day
    and crm_profile_counts.to_day - crm_profile_counts.from_day between 0 and 400
    and public.crm_workspace_member(crm_profile_counts.owner, crm_profile_counts.workspace);
end;
--> statement-breakpoint
-- The editor's Insights and its CSV, as 0156's, for one page (AC-6417).
create function crm_profile_insights(owner uuid, workspace uuid, from_day date, to_day date,
  profile uuid default null)
  returns table (day date, metric text, key text, views bigint, visitors bigint)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select v.day, 'traffic', null::text, v.views::bigint, v.visitors::bigint
  from auth.profile_view_days v
  where v.profile_id = public.crm_profile_page_of(crm_profile_insights.owner, crm_profile_insights.workspace,
      crm_profile_insights.profile)
    and v.day between crm_profile_insights.from_day and crm_profile_insights.to_day
    and crm_profile_insights.to_day - crm_profile_insights.from_day between 0 and 400
    and public.crm_workspace_member(crm_profile_insights.owner, crm_profile_insights.workspace)
  union all
  select s.day, s.fact, s.value, s.views::bigint, s.visitors::bigint
  from auth.profile_view_source_days s
  where s.profile_id = public.crm_profile_page_of(crm_profile_insights.owner, crm_profile_insights.workspace,
      crm_profile_insights.profile)
    and s.day between crm_profile_insights.from_day and crm_profile_insights.to_day
    and crm_profile_insights.to_day - crm_profile_insights.from_day between 0 and 400
    and public.crm_workspace_member(crm_profile_insights.owner, crm_profile_insights.workspace)
  union all
  select b.day, 'bookings', null::text, b.bookings::bigint, null::bigint
  from auth.profile_booking_days b
  where b.profile_id = public.crm_profile_page_of(crm_profile_insights.owner, crm_profile_insights.workspace,
      crm_profile_insights.profile)
    and b.day between crm_profile_insights.from_day and crm_profile_insights.to_day
    and crm_profile_insights.to_day - crm_profile_insights.from_day between 0 and 400
    and public.crm_workspace_member(crm_profile_insights.owner, crm_profile_insights.workspace)
  union all
  select p.day, 'press', p.item_id::text, p.presses::bigint, null::bigint
  from auth.profile_item_press_days p
  join auth.profile_items i on i.id = p.item_id
  where i.profile_id = public.crm_profile_page_of(crm_profile_insights.owner, crm_profile_insights.workspace,
      crm_profile_insights.profile)
    and i.archived_at is null
    and p.day between crm_profile_insights.from_day and crm_profile_insights.to_day
    and crm_profile_insights.to_day - crm_profile_insights.from_day between 0 and 400
    and public.crm_workspace_member(crm_profile_insights.owner, crm_profile_insights.workspace);
end;
--> statement-breakpoint
-- A view of one page with its four facts, as 0156's. Nothing for a person who is not an active member there, or for
-- a page that is not theirs there.
create function crm_count_profile_view(owner uuid, workspace uuid, visitor text, referrer text, source text,
  country text, device text, profile uuid default null)
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  today date := (pg_catalog.now() at time zone 'UTC')::date;
  is_new boolean;
  the_fact text;
  the_value text;
  kept text;
  the_page uuid;
begin
  if not public.crm_workspace_member(owner, workspace) then
    return;
  end if;
  the_page := public.crm_profile_page_of(owner, workspace, profile);
  if the_page is null then
    return;
  end if;
  -- One page's facts are folded one view at a time, so a day never passes its 50 values under a burst.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_facts:' || the_page::text, 0));
  insert into auth.profile_views as v (user_id, workspace_id, profile_id, day, visitor)
  values (owner, workspace, the_page, today, crm_count_profile_view.visitor)
  on conflict (profile_id, day, visitor)
    do update set views = v.views + 1, last_at = pg_catalog.now()
  returning (v.xmax = 0) into is_new;
  insert into auth.profile_view_days as d (user_id, workspace_id, profile_id, day, views, visitors)
  values (owner, workspace, the_page, today, 1, case when is_new then 1 else 0 end)
  on conflict (profile_id, day)
    do update set views = d.views + 1, visitors = d.visitors + excluded.visitors;
  for the_fact, the_value in
    select f.fact, f.value
    from (values ('referrer', referrer), ('source', source), ('country', country), ('device', device)) f(fact, value)
    where f.value is not null and pg_catalog.char_length(f.value) between 1 and 120
      and f.value !~ '[[:cntrl:][:space:]]'
  loop
    kept := the_value;
    if not exists (select 1 from auth.profile_view_source_days s
        where s.profile_id = the_page and s.day = today and s.fact = the_fact and s.value = the_value)
      and (select count(*) from auth.profile_view_source_days s
        where s.profile_id = the_page and s.day = today and s.fact = the_fact and s.value <> 'Other') >= 50 then
      kept := 'Other';
    end if;
    insert into auth.profile_view_source_days as s (user_id, workspace_id, profile_id, day, fact, value, views,
      visitors)
    values (owner, workspace, the_page, today, the_fact, kept, 1, case when is_new then 1 else 0 end)
    on conflict (profile_id, day, fact, value)
      do update set views = s.views + 1, visitors = s.visitors + excluded.visitors;
  end loop;
end;
$$;
--> statement-breakpoint
-- A booking made from a link page, as 0156's: `wanted` names the page by a current or old handle, and the booking
-- page must be a live block on that page now.
create or replace function crm_count_profile_booking(wanted text, page uuid)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  owner uuid;
  workspace uuid;
  the_page uuid;
  stamp text := pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select h.user_id, h.workspace_id, p.id into owner, workspace, the_page
  from auth.public_handles h
  join auth.public_profiles p on p.user_id = h.user_id and p.workspace_id = h.workspace_id
    and (p.id = h.profile_id or (h.profile_id is null and p.is_primary))
  where h.handle = wanted and h.user_id is not null and p.shown_at is not null;
  if owner is null or page is null or not public.crm_workspace_member(owner, workspace) then
    return false;
  end if;
  if not exists (
    select 1 from auth.profile_items i
    where i.profile_id = the_page and i.archived_at is null
      and i.kind in ('page', 'times') and i.page_id = crm_count_profile_booking.page
      and ((i.data ->> 'showFrom') is null or (i.data ->> 'showFrom') collate "C" <= stamp collate "C")
      and ((i.data ->> 'hideAfter') is null or (i.data ->> 'hideAfter') collate "C" > stamp collate "C")
  ) then
    return false;
  end if;
  insert into auth.profile_booking_days as b (user_id, workspace_id, profile_id, day, bookings)
  values (owner, workspace, the_page, (pg_catalog.now() at time zone 'UTC')::date, 1)
  on conflict (profile_id, day) do update set bookings = b.bookings + 1;
  return true;
end;
$$;
--> statement-breakpoint
create function crm_save_profile_accent(owner uuid, workspace uuid, wanted text, wanted_dark text,
  profile uuid default null)
  returns table (accent text, accent_dark text)
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
begin
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_THIS_WORKSPACE';
  end if;
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  return query
  update auth.public_profiles p
  set accent = wanted,
      accent_dark = wanted_dark,
      updated_at = pg_catalog.now()
  where p.id = public.crm_profile_page_of(owner, workspace, profile)
  returning p.accent, p.accent_dark;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
end;
$$;
--> statement-breakpoint
create function crm_save_profile_image(owner uuid, workspace uuid, slot text, path text, kind text, version text,
  profile uuid default null)
  returns text
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  previous text;
  the_page uuid;
begin
  if slot is null or slot not in ('cover', 'ground') then
    raise exception using errcode = '22023', message = 'PROFILE_IMAGE_SLOT';
  end if;
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_THIS_WORKSPACE';
  end if;
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  the_page := public.crm_profile_page_of(owner, workspace, profile);
  select case when slot = 'cover' then p.cover_path else p.ground_path end into previous
  from auth.public_profiles p
  where p.id = the_page
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  if slot = 'cover' then
    update auth.public_profiles p
    set cover_path = path,
        cover_type = case when path is null then null else kind end,
        cover_version = case when path is null then null else version end,
        updated_at = pg_catalog.now()
    where p.id = the_page;
  else
    update auth.public_profiles p
    set ground_path = path,
        ground_type = case when path is null then null else kind end,
        ground_version = case when path is null then null else version end,
        updated_at = pg_catalog.now()
    where p.id = the_page;
  end if;
  return previous;
end;
$$;
--> statement-breakpoint
create function crm_profile_look(owner uuid, workspace uuid, profile uuid default null)
  returns table (accent text, accent_dark text, cover_path text, cover_type text, cover_version text,
    ground_path text, ground_type text, ground_version text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.accent, p.accent_dark, p.cover_path, p.cover_type, p.cover_version,
    p.ground_path, p.ground_type, p.ground_version
  from auth.public_profiles p
  where p.id = public.crm_profile_page_of(crm_profile_look.owner, crm_profile_look.workspace, crm_profile_look.profile)
    and p.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    and public.crm_workspace_member(p.user_id, p.workspace_id);
end;
--> statement-breakpoint
create function crm_save_profile_qr_style(owner uuid, workspace uuid, style jsonb, profile uuid default null)
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
  if style is not null and (
    pg_catalog.jsonb_typeof(style) <> 'object'
    or exists (select 1 from pg_catalog.jsonb_each(style) e where e.key <> all (array['colour', 'picture', 'label']))
    or (style ? 'colour' and (pg_catalog.jsonb_typeof(style -> 'colour') <> 'string'
      or style ->> 'colour' !~ '^#[0-9a-f]{6}$'))
    or (style ? 'label' and (pg_catalog.jsonb_typeof(style -> 'label') <> 'string'
      or style ->> 'label' ~ '[[:cntrl:]]' or style ->> 'label' <> pg_catalog.btrim(style ->> 'label')
      or pg_catalog.char_length(style ->> 'label') not between 1 and 20))
    or (style ? 'picture' and (pg_catalog.jsonb_typeof(style -> 'picture') <> 'object'
      or not (style -> 'picture' = '{"from":"person"}'::jsonb
        or (style -> 'picture' ->> 'from' = 'upload'
          and (select pg_catalog.count(*) from pg_catalog.jsonb_each(style -> 'picture')) = 2
          and exists (select 1 from auth.profile_images m
            where m.id::text = style -> 'picture' ->> 'image' and m.user_id = owner and m.workspace_id = workspace)))))
  ) then
    raise exception using errcode = '22023', message = 'PROFILE_QR_STYLE';
  end if;
  update auth.public_profiles p
  set qr_style = crm_save_profile_qr_style.style, updated_at = pg_catalog.now()
  where p.id = public.crm_profile_page_of(owner, workspace, profile)
  returning p.qr_style into kept;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  return kept;
end;
$$;
--> statement-breakpoint
create function crm_profile_qr_style(owner uuid, workspace uuid, profile uuid default null)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.qr_style from auth.public_profiles p
  where p.id = public.crm_profile_page_of(crm_profile_qr_style.owner, crm_profile_qr_style.workspace,
      crm_profile_qr_style.profile)
    and public.crm_workspace_member(p.user_id, p.workspace_id);
end;
--> statement-breakpoint
-- As 0154's, for one page.
create function crm_show_public_profile(owner uuid, workspace uuid, profile uuid default null)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  is_shown boolean;
  the_page uuid;
begin
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    return false;
  end if;
  if not public.crm_workspace_member(owner, workspace) then
    return false;
  end if;
  the_page := public.crm_profile_page_of(owner, workspace, profile);
  update auth.public_profiles p
  set shown_at = coalesce(p.shown_at, pg_catalog.now()), claimed_at = pg_catalog.now()
  where p.id = the_page and p.claimed_at is null;
  select p.shown_at is not null into is_shown from auth.public_profiles p where p.id = the_page;
  return coalesce(is_shown, false);
end;
$$;
--> statement-breakpoint
create function crm_set_public_profile_live(owner uuid, workspace uuid, live boolean, profile uuid default null)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  is_shown boolean;
begin
  if live is null then
    raise exception using errcode = '22004', message = 'PROFILE_LIVE_NULL';
  end if;
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    return false;
  end if;
  if not public.crm_workspace_member(owner, workspace) then
    return false;
  end if;
  update auth.public_profiles p
  set shown_at = case when live then coalesce(p.shown_at, pg_catalog.now()) end,
      claimed_at = coalesce(p.claimed_at, pg_catalog.now())
  where p.id = public.crm_profile_page_of(owner, workspace, profile)
  returning p.shown_at is not null into is_shown;
  return coalesce(is_shown, false);
end;
$$;
--> statement-breakpoint
-- Sets the handle and bio of one of `owner`'s pages in `workspace` (their primary page when `profile` is null), and
-- makes their first page there when they have none, as 0124's. The handle names that page from now on; an old one
-- keeps naming it, so its address moves to the new one. A handle another of their own pages uses now is taken.
create function crm_save_public_profile(owner uuid, workspace uuid, wanted text, about text, profile uuid default null)
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  holder uuid;
  held_in uuid;
  the_page uuid;
  made uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_public_handle:' || owner::text, 0));
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  the_page := public.crm_profile_page_of(owner, workspace, profile);
  if the_page is null and profile is not null then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  made := coalesce(the_page, public.uuidv7());
  if not exists (select 1 from auth.public_handles h
      where h.handle = wanted and h.user_id = owner and h.workspace_id = workspace)
    and not public.crm_make_handle_room(owner) then
    raise exception using errcode = '54000', message = 'PUBLIC_HANDLE_LIMIT';
  end if;
  insert into auth.public_handles (handle, user_id, workspace_id, profile_id) values (wanted, owner, workspace, made)
  on conflict (handle) do nothing;
  select h.user_id, h.workspace_id into holder, held_in from auth.public_handles h where h.handle = wanted;
  if holder is distinct from owner or held_in is distinct from workspace
    or exists (select 1 from auth.public_profiles p where p.handle = wanted and p.id <> made) then
    raise exception using errcode = '23505', constraint = 'public_handles_pkey',
      message = 'That handle is taken.';
  end if;
  update auth.public_handles h set profile_id = made where h.handle = wanted and h.profile_id is distinct from made;
  if the_page is null then
    insert into auth.public_profiles (id, user_id, workspace_id, handle, bio) values (made, owner, workspace, wanted, about);
  else
    update auth.public_profiles p
    set handle = wanted, bio = about, updated_at = pg_catalog.now()
    where p.id = the_page and (p.handle, p.bio) is distinct from (wanted, about);
  end if;
end;
$$;
--> statement-breakpoint
-- As 0154's: the person's primary page's handle in `workspace`, made (private and unlisted) when they have no page
-- there.
create or replace function crm_ensure_public_profile(owner uuid, workspace uuid, base text)
  returns text
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  held text;
  suffix text;
  candidate text;
  try integer;
  made integer;
  roomy boolean := false;
  page uuid := public.uuidv7();
begin
  if base is null or base !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or pg_catalog.char_length(base) not between 3 and 40 then
    raise exception using errcode = '22023', message = 'PROFILE_HANDLE_BASE';
  end if;
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    return null;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_public_handle:' || owner::text, 0));
  if not public.crm_workspace_member(owner, workspace) then
    return null;
  end if;
  select p.handle into held from auth.public_profiles p
  where p.user_id = owner and p.workspace_id = workspace and p.is_primary;
  if held is not null then
    return held;
  end if;
  for try in 1..60 loop
    suffix := case
      when try = 1 then ''
      when try <= 30 then '-' || try::text
      else '-' || (1000 + pg_catalog.floor(pg_catalog.random() * 9000))::integer::text
    end;
    candidate := pg_catalog.rtrim(pg_catalog.left(base, 40 - pg_catalog.char_length(suffix)), '-') || suffix;
    if exists (select 1 from auth.public_handles h where h.handle = candidate) then
      continue;
    end if;
    if not roomy then
      if not public.crm_make_handle_room(owner) then
        return null;
      end if;
      roomy := true;
    end if;
    insert into auth.public_handles (handle, user_id, workspace_id, profile_id)
    values (candidate, owner, workspace, page)
    on conflict (handle) do nothing;
    get diagnostics made = row_count;
    if made = 1 then
      insert into auth.public_profiles (id, user_id, workspace_id, handle, indexable)
      values (page, owner, workspace, candidate, false);
      return candidate;
    end if;
  end loop;
  return null;
end;
$$;
--> statement-breakpoint
-- One handle per workspace for the line that says they have a page elsewhere (AC-5618), as 0114's: the primary
-- page's.
create or replace function crm_profile_handles_of(owner uuid)
  returns table (workspace_id uuid, handle text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.workspace_id, p.handle
  from auth.public_profiles p
  where p.user_id = crm_profile_handles_of.owner and p.is_primary
    and public.crm_workspace_member(p.user_id, p.workspace_id)
  order by p.updated_at, p.workspace_id
  limit 20;
end;
--> statement-breakpoint
-- Each person's primary page in ONE workspace, as 0116's: the handle their booking pages live under.
create or replace function crm_public_profiles_of(owners uuid[], workspace uuid)
  returns table (user_id uuid, handle text, bio text, theme jsonb, indexable boolean, share_image_version text,
    shown boolean)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.user_id, p.handle, p.bio, p.theme, p.indexable, p.share_image_version, p.shown_at is not null
  from auth.public_profiles p
  where p.user_id = any (crm_public_profiles_of.owners)
    and p.workspace_id = crm_public_profiles_of.workspace
    and p.is_primary
    and public.crm_workspace_member(p.user_id, p.workspace_id);
end;
--> statement-breakpoint
-- As 0156's, each page's own blocks.
create or replace function crm_sitemap_handles(after text, max integer)
  returns table (handle text, changed_at timestamptz)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.handle, greatest(p.updated_at, max(i.updated_at))
  from auth.public_profiles p
  join auth.profile_items i on i.profile_id = p.id and i.archived_at is null
    and ((i.data ->> 'showFrom') is null or (i.data ->> 'showFrom') collate "C"
      <= pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') collate "C")
    and ((i.data ->> 'hideAfter') is null or (i.data ->> 'hideAfter') collate "C"
      > pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') collate "C")
  where p.shown_at is not null and p.indexable
    and (crm_sitemap_handles.after is null or p.handle collate "C" > crm_sitemap_handles.after collate "C")
    and public.crm_workspace_member(p.user_id, p.workspace_id)
  group by p.id, p.handle, p.updated_at
  order by p.handle collate "C"
  limit least(greatest(crm_sitemap_handles.max, 1), 50000);
end;
--> statement-breakpoint
-- The year's sweep, as 0156's, by the new keys.
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
  delete from auth.profile_views v where (v.profile_id, v.day, v.visitor) in (
    select o.profile_id, o.day, o.visitor from auth.profile_views o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  most := greatest(most, gone);
  delete from auth.profile_item_presses p where (p.item_id, p.day, p.visitor) in (
    select o.item_id, o.day, o.visitor from auth.profile_item_presses o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  most := greatest(most, gone);
  delete from auth.profile_view_days v where (v.profile_id, v.day) in (
    select o.profile_id, o.day from auth.profile_view_days o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  most := greatest(most, gone);
  delete from auth.profile_item_press_days p where (p.item_id, p.day) in (
    select o.item_id, o.day from auth.profile_item_press_days o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  most := greatest(most, gone);
  delete from auth.profile_view_source_days s where (s.profile_id, s.day, s.fact, s.value) in (
    select o.profile_id, o.day, o.fact, o.value from auth.profile_view_source_days o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  most := greatest(most, gone);
  delete from auth.profile_booking_days b where (b.profile_id, b.day) in (
    select o.profile_id, o.day from auth.profile_booking_days o
    where o.day < cutoff order by o.day limit batch for update skip locked);
  get diagnostics gone = row_count;
  return greatest(most, gone);
end;
$$;
--> statement-breakpoint
-- The switcher (AC-6414): `owner`'s pages in `workspace`, the primary first and then in their order, with what a
-- tile draws. None outside the transaction's own workspace, or unless they are an active member there.
create function crm_profile_pages(owner uuid, workspace uuid)
  returns table (id uuid, handle text, name text, is_primary boolean, "position" smallint, shown boolean,
    theme jsonb, bio text, indexable boolean, share_image_version text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.id, p.handle, p.name, p.is_primary, p.position, p.shown_at is not null, p.theme, p.bio, p.indexable,
    p.share_image_version
  from auth.public_profiles p
  where p.user_id = crm_profile_pages.owner and p.workspace_id = crm_profile_pages.workspace
    and p.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    and public.crm_workspace_member(p.user_id, p.workspace_id)
  order by p.is_primary desc, p.position, p.id
  limit 5;
end;
--> statement-breakpoint
-- A new link page (AC-6413, AC-6414): its handle (under spec 0056's rules: unique everywhere, at most 20 per person)
-- and private name, live at once, since its owner made it on purpose (spec 0058, AC-23). Idempotent on `page`, the id
-- the browser minted: a retry answers the page already made. Refused 54000 `PROFILE_PAGE_LIMIT` at 5 (the trigger),
-- 54000 `PUBLIC_HANDLE_LIMIT` at the handle cap, and 23505 when the handle is anyone else's or another page's.
create function crm_create_profile_page(owner uuid, workspace uuid, page uuid, wanted text, page_name text)
  returns text
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  holder uuid;
  held_in uuid;
  done text;
begin
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_THIS_WORKSPACE';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_public_handle:' || owner::text, 0));
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  select p.handle into done from auth.public_profiles p
  where p.id = page and p.user_id = owner and p.workspace_id = workspace;
  if done is not null then
    return done;
  end if;
  if exists (select 1 from auth.public_profiles p where p.id = page) then
    raise exception using errcode = '23505', constraint = 'public_profiles_pkey', message = 'PROFILE_PAGE_ID';
  end if;
  if (select pg_catalog.count(*) from auth.public_profiles p
      where p.user_id = owner and p.workspace_id = workspace) >= 5 then
    raise exception using errcode = '54000', message = 'PROFILE_PAGE_LIMIT', detail = 'pages';
  end if;
  if not exists (select 1 from auth.public_handles h
      where h.handle = wanted and h.user_id = owner and h.workspace_id = workspace)
    and not public.crm_make_handle_room(owner) then
    raise exception using errcode = '54000', message = 'PUBLIC_HANDLE_LIMIT';
  end if;
  insert into auth.public_handles (handle, user_id, workspace_id, profile_id) values (wanted, owner, workspace, page)
  on conflict (handle) do nothing;
  select h.user_id, h.workspace_id into holder, held_in from auth.public_handles h where h.handle = wanted;
  if holder is distinct from owner or held_in is distinct from workspace
    or exists (select 1 from auth.public_profiles p where p.handle = wanted) then
    raise exception using errcode = '23505', constraint = 'public_handles_pkey',
      message = 'That handle is taken.';
  end if;
  update auth.public_handles h set profile_id = page where h.handle = wanted and h.profile_id is distinct from page;
  insert into auth.public_profiles (id, user_id, workspace_id, handle, name, shown_at, claimed_at)
  values (page, owner, workspace, wanted, page_name, pg_catalog.now(), pg_catalog.now());
  return wanted;
end;
$$;
--> statement-breakpoint
-- A page's private name (AC-6413): at most 40, one line, trimmed (the column's check). False when the page is not
-- the caller's there.
create function crm_rename_profile_page(owner uuid, workspace uuid, profile uuid, page_name text)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
begin
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    or profile is null or not public.crm_workspace_member(owner, workspace) then
    return false;
  end if;
  update auth.public_profiles p set name = page_name, updated_at = pg_catalog.now()
  where p.id = profile and p.user_id = owner and p.workspace_id = workspace;
  return found;
end;
$$;
--> statement-breakpoint
-- Makes one of the caller's pages their primary page (AC-6415): Home's card and their booking pages' handle follow
-- it. False when the page is not theirs there.
create function crm_set_primary_profile_page(owner uuid, workspace uuid, profile uuid)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
begin
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    or profile is null or not public.crm_workspace_member(owner, workspace) then
    return false;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_public_handle:' || owner::text, 0));
  if not exists (select 1 from auth.public_profiles p
      where p.id = profile and p.user_id = owner and p.workspace_id = workspace) then
    return false;
  end if;
  update auth.public_profiles p set is_primary = false
  where p.user_id = owner and p.workspace_id = workspace and p.is_primary and p.id <> profile;
  update auth.public_profiles p set is_primary = true where p.id = profile and not p.is_primary;
  return true;
end;
$$;
--> statement-breakpoint
-- Deletes one of the caller's pages for good (AC-6416), its blocks and numbers with it. Its handles stay theirs,
-- held against their 20 as every old handle is, and find their primary page. Never their only page there (55000
-- `PROFILE_PAGE_LAST`); deleting the primary page makes the next in order primary. Answers the deleted page's
-- handle, so the caller can drop the edge's copies, and the store paths of its cover and photo ground, so it can
-- delete those files once this commits; no row when the page is not theirs there.
create function crm_delete_profile_page(owner uuid, workspace uuid, profile uuid)
  returns table (handle text, cover_path text, ground_path text)
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  gone auth.public_profiles%rowtype;
  next_page uuid;
begin
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    or profile is null or not public.crm_workspace_member(owner, workspace) then
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_public_handle:' || owner::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  select * into gone from auth.public_profiles p
  where p.id = profile and p.user_id = owner and p.workspace_id = workspace for update;
  if not found then
    return;
  end if;
  select p.id into next_page from auth.public_profiles p
  where p.user_id = owner and p.workspace_id = workspace and p.id <> profile
  order by p.position, p.id limit 1;
  if next_page is null then
    raise exception using errcode = '55000', message = 'PROFILE_PAGE_LAST';
  end if;
  delete from auth.public_profiles p where p.id = profile;
  if gone.is_primary then
    update auth.public_profiles p set is_primary = true where p.id = next_page;
  end if;
  return query select gone.handle, gone.cover_path, gone.ground_path;
end;
$$;
--> statement-breakpoint
revoke all on function crm_profile_page_of(uuid, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_pack_profile_items(uuid) from public;
--> statement-breakpoint
revoke all on function crm_handle_owner(text) from public;
--> statement-breakpoint
revoke all on function crm_profile_items(uuid, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_items_archived(uuid, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_items_public(uuid, uuid, smallint, uuid, integer, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_image_public(uuid, uuid, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_save_profile_item(uuid, uuid, uuid, text, jsonb, uuid, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_order_profile_items(uuid, uuid, uuid[], uuid) from public;
--> statement-breakpoint
revoke all on function crm_archive_profile_item(uuid, uuid, uuid, boolean, uuid) from public;
--> statement-breakpoint
revoke all on function crm_delete_profile_item(uuid, uuid, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_import_profile_links(uuid, uuid, uuid, text, jsonb, jsonb, uuid) from public;
--> statement-breakpoint
revoke all on function crm_save_profile_share_image(uuid, uuid, bytea, text, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_share_image(uuid, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_save_profile_theme(uuid, uuid, jsonb, uuid) from public;
--> statement-breakpoint
revoke all on function crm_save_profile_indexable(uuid, uuid, boolean, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_counts(uuid, uuid, date, date, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_insights(uuid, uuid, date, date, uuid) from public;
--> statement-breakpoint
revoke all on function crm_count_profile_view(uuid, uuid, text, text, text, text, text, uuid) from public;
--> statement-breakpoint
revoke all on function crm_save_profile_accent(uuid, uuid, text, text, uuid) from public;
--> statement-breakpoint
revoke all on function crm_save_profile_image(uuid, uuid, text, text, text, text, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_look(uuid, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_save_profile_qr_style(uuid, uuid, jsonb, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_qr_style(uuid, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_show_public_profile(uuid, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_set_public_profile_live(uuid, uuid, boolean, uuid) from public;
--> statement-breakpoint
revoke all on function crm_save_public_profile(uuid, uuid, text, text, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_pages(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_create_profile_page(uuid, uuid, uuid, text, text) from public;
--> statement-breakpoint
revoke all on function crm_rename_profile_page(uuid, uuid, uuid, text) from public;
--> statement-breakpoint
revoke all on function crm_set_primary_profile_page(uuid, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_delete_profile_page(uuid, uuid, uuid) from public;
--> statement-breakpoint
grant execute on function crm_handle_owner(text) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_items(uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_items_archived(uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_items_public(uuid, uuid, smallint, uuid, integer, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_image_public(uuid, uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_save_profile_item(uuid, uuid, uuid, text, jsonb, uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_order_profile_items(uuid, uuid, uuid[], uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_archive_profile_item(uuid, uuid, uuid, boolean, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_delete_profile_item(uuid, uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_import_profile_links(uuid, uuid, uuid, text, jsonb, jsonb, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_save_profile_share_image(uuid, uuid, bytea, text, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_share_image(uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_save_profile_theme(uuid, uuid, jsonb, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_save_profile_indexable(uuid, uuid, boolean, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_counts(uuid, uuid, date, date, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_insights(uuid, uuid, date, date, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_count_profile_view(uuid, uuid, text, text, text, text, text, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_save_profile_accent(uuid, uuid, text, text, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_save_profile_image(uuid, uuid, text, text, text, text, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_look(uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_save_profile_qr_style(uuid, uuid, jsonb, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_qr_style(uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_show_public_profile(uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_set_public_profile_live(uuid, uuid, boolean, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_save_public_profile(uuid, uuid, text, text, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_pages(uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_create_profile_page(uuid, uuid, uuid, text, text) to crm_app;
--> statement-breakpoint
grant execute on function crm_rename_profile_page(uuid, uuid, uuid, text) to crm_app;
--> statement-breakpoint
grant execute on function crm_set_primary_profile_page(uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_delete_profile_page(uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
reset role;
--> statement-breakpoint
create trigger "public_profiles_drop_images" after delete on "auth"."public_profiles"
  for each row execute function crm_public_profiles_drop_images();
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
-- Refuse to finish unless every page definer is as narrow as it reads, and the helpers are crm_handle's alone.
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.crm_handle_owner(text)'::regprocedure,
    'public.crm_profile_items(uuid, uuid, uuid)'::regprocedure,
    'public.crm_profile_items_archived(uuid, uuid, uuid)'::regprocedure,
    'public.crm_profile_items_public(uuid, uuid, smallint, uuid, integer, uuid)'::regprocedure,
    'public.crm_profile_image_public(uuid, uuid, uuid, uuid)'::regprocedure,
    'public.crm_save_profile_item(uuid, uuid, uuid, text, jsonb, uuid, uuid, uuid)'::regprocedure,
    'public.crm_order_profile_items(uuid, uuid, uuid[], uuid)'::regprocedure,
    'public.crm_archive_profile_item(uuid, uuid, uuid, boolean, uuid)'::regprocedure,
    'public.crm_delete_profile_item(uuid, uuid, uuid, uuid)'::regprocedure,
    'public.crm_place_profile_page(uuid, uuid, uuid)'::regprocedure,
    'public.crm_import_profile_links(uuid, uuid, uuid, text, jsonb, jsonb, uuid)'::regprocedure,
    'public.crm_save_profile_share_image(uuid, uuid, bytea, text, uuid)'::regprocedure,
    'public.crm_profile_share_image(uuid, uuid, uuid)'::regprocedure,
    'public.crm_save_profile_theme(uuid, uuid, jsonb, uuid)'::regprocedure,
    'public.crm_save_profile_indexable(uuid, uuid, boolean, uuid)'::regprocedure,
    'public.crm_profile_counts(uuid, uuid, date, date, uuid)'::regprocedure,
    'public.crm_profile_insights(uuid, uuid, date, date, uuid)'::regprocedure,
    'public.crm_count_profile_view(uuid, uuid, text, text, text, text, text, uuid)'::regprocedure,
    'public.crm_count_profile_booking(text, uuid)'::regprocedure,
    'public.crm_save_profile_accent(uuid, uuid, text, text, uuid)'::regprocedure,
    'public.crm_save_profile_image(uuid, uuid, text, text, text, text, uuid)'::regprocedure,
    'public.crm_profile_look(uuid, uuid, uuid)'::regprocedure,
    'public.crm_save_profile_qr_style(uuid, uuid, jsonb, uuid)'::regprocedure,
    'public.crm_profile_qr_style(uuid, uuid, uuid)'::regprocedure,
    'public.crm_show_public_profile(uuid, uuid, uuid)'::regprocedure,
    'public.crm_set_public_profile_live(uuid, uuid, boolean, uuid)'::regprocedure,
    'public.crm_save_public_profile(uuid, uuid, text, text, uuid)'::regprocedure,
    'public.crm_ensure_public_profile(uuid, uuid, text)'::regprocedure,
    'public.crm_profile_handles_of(uuid)'::regprocedure,
    'public.crm_public_profiles_of(uuid[], uuid)'::regprocedure,
    'public.crm_sitemap_handles(text, integer)'::regprocedure,
    'public.crm_profile_pages(uuid, uuid)'::regprocedure,
    'public.crm_create_profile_page(uuid, uuid, uuid, text, text)'::regprocedure,
    'public.crm_rename_profile_page(uuid, uuid, uuid, text)'::regprocedure,
    'public.crm_set_primary_profile_page(uuid, uuid, uuid)'::regprocedure,
    'public.crm_delete_profile_page(uuid, uuid, uuid)'::regprocedure
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
  foreach fn in array array[
    'public.crm_profile_page_of(uuid, uuid, uuid)'::regprocedure,
    'public.crm_pack_profile_items(uuid)'::regprocedure
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = fn) <> 'crm_handle'
      or has_function_privilege('crm_app', fn, 'EXECUTE')
      or has_function_privilege('crm_identity', fn, 'EXECUTE') then
      raise exception '% must be crm_handle''s and reachable only from its own functions', fn;
    end if;
  end loop;
end
$$;
