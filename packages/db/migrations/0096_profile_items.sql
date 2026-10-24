-- The link page at `/<handle>` (spec 0051, built as blocks, 25 Oct 2026): a person's one ordered list of blocks, kept
-- with their account in schema `auth` and never with a workspace, so leaving a workspace never takes their LinkedIn
-- with it. `auth.profile_items` keeps the columns every kind shares (id, owner, kind, place, archived, made, changed)
-- and, for a block that names a booking page, its workspace and page as real columns; everything else a kind holds is
-- `data`, checked by its Zod schema before every write and again by crm_save_profile_item here. So a new kind is a
-- schema, a renderer and an editor, and at most one word in `profile_items_kind`. `position` is null while archived,
-- so only live blocks hold places, and `profile_items_place` (unique per person, deferred to the commit) lets a
-- reorder set every place in one statement.
--
-- crm_handle (0086's role for a person's public facts) is the only way there from the app, inside the caller's
-- workspace transaction: it gains select, insert, update and delete on this one table, and crm_app holds no grant on
-- it. Every function takes the owner, and the api passes only the session's own id:
-- * crm_profile_items(owner) and crm_profile_items_archived(owner): the editor's reads;
-- * crm_profile_items_public(owner, after, after_id, max): one page of live blocks for the public read;
-- * crm_save_profile_item(owner, item, kind, data, workspace, page): adds (at the end) or edits one block,
--   idempotent on its id; 54000 PROFILE_ITEM_LIMIT past a limit, 23505 on a repeated heading or page, 22023
--   PROFILE_ITEM_DATA for data its kind can't hold, P0002 PROFILE_ITEM_MISSING for another person's id;
-- * crm_order_profile_items(owner, ids): the whole order at once, 22023 PROFILE_ORDER_STALE unless it names exactly
--   the live blocks;
-- * crm_archive_profile_item(owner, item, archived): archives one block, or restores it to the end;
-- * crm_delete_profile_item(owner, item): deletes one block;
-- * crm_place_profile_page(owner, workspace, page): puts a page made Public at the end, once, never refusing.
-- And crm_booking_lookup (0041's) gains crm_booking_owner_pages(owner, pages): which of the person's booking pages may
-- sit on their link page (Public, not deleted, theirs in a workspace that exists where they are still an active
-- member) and which of those are live, ids only. The services then read each page inside withWorkspace() as its
-- read only `booking` actor, as the profile does today.
--
-- The backfill (AC-5129): every Public page of every person becomes a `page` block in the order their profile showed
-- it, under its section as a heading; a person with pages in several workspaces gets each workspace's pages with no
-- section under a heading named after that workspace. `booking_pages.profile_section` and `profile_position` stay in
-- place, unread, for one release. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "auth"."profile_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" smallint,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"workspace_id" uuid,
	"page_id" uuid,
	"archived_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_items_kind" CHECK ("auth"."profile_items"."kind" in ('link', 'page', 'heading', 'contact')),
	CONSTRAINT "profile_items_position" CHECK ("auth"."profile_items"."position" between 0 and 999),
	CONSTRAINT "profile_items_placed" CHECK (("auth"."profile_items"."archived_at" is null) = ("auth"."profile_items"."position" is not null)),
	CONSTRAINT "profile_items_data" CHECK (jsonb_typeof("auth"."profile_items"."data") = 'object' and pg_column_size("auth"."profile_items"."data") <= 4096),
	CONSTRAINT "profile_items_target" CHECK (("auth"."profile_items"."workspace_id" is null) = ("auth"."profile_items"."page_id" is null)),
	CONSTRAINT "profile_items_page" CHECK ("auth"."profile_items"."kind" <> 'page' or "auth"."profile_items"."page_id" is not null),
	CONSTRAINT "profile_items_plain" CHECK ("auth"."profile_items"."kind" not in ('link', 'heading', 'contact') or "auth"."profile_items"."page_id" is null)
);
--> statement-breakpoint
ALTER TABLE "auth"."profile_items" ADD CONSTRAINT "profile_items_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_items_page_once" ON "auth"."profile_items" USING btree ("user_id","workspace_id","page_id") WHERE "auth"."profile_items"."kind" = 'page' and "auth"."profile_items"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_items_contact_once" ON "auth"."profile_items" USING btree ("user_id") WHERE "auth"."profile_items"."kind" = 'contact' and "auth"."profile_items"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_items_heading_once" ON "auth"."profile_items" USING btree ("user_id",lower(btrim("data" ->> 'title'))) WHERE "auth"."profile_items"."kind" = 'heading' and "auth"."profile_items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "profile_items_archived" ON "auth"."profile_items" USING btree ("user_id","archived_at") WHERE "auth"."profile_items"."archived_at" is not null;--> statement-breakpoint
ALTER TABLE "auth"."profile_items" ADD CONSTRAINT "profile_items_place" UNIQUE ("user_id", "position") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
grant select, insert, update, delete on auth.profile_items to crm_handle;
--> statement-breakpoint
-- The live blocks of one person, in order. The editor's read, for the owner's own session only.
create function crm_profile_items(owner uuid)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid,
    archived_at timestamptz, updated_at timestamptz)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.archived_at, i.updated_at
  from auth.profile_items i
  where i.user_id = crm_profile_items.owner and i.archived_at is null
  order by i.position, i.id
  limit 1000;
end;
--> statement-breakpoint
-- The archived blocks of one person, newest first, at most 100.
create function crm_profile_items_archived(owner uuid)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid,
    archived_at timestamptz, updated_at timestamptz)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.archived_at, i.updated_at
  from auth.profile_items i
  where i.user_id = crm_profile_items_archived.owner and i.archived_at is not null
  order by i.archived_at desc, i.id
  limit 100;
end;
--> statement-breakpoint
-- One page of a person's live blocks in order, after the cursor (`after_id` null: from the start), at most `max`
-- and never more than 61. The public read, which resolves each booking page block through the booking lookup.
create function crm_profile_items_public(owner uuid, after_position smallint, after_id uuid, max integer)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id
  from auth.profile_items i
  where i.user_id = crm_profile_items_public.owner and i.archived_at is null
    and (crm_profile_items_public.after_id is null
      or (i.position, i.id) > (crm_profile_items_public.after_position, crm_profile_items_public.after_id))
  order by i.position, i.id
  limit least(greatest(crm_profile_items_public.max, 1), 61);
end;
--> statement-breakpoint
-- Refuses data a kind can't hold (22023 PROFILE_ITEM_DATA): the definer's own check behind the Zod one, so a caller
-- that skipped the contract still stores only what a renderer can draw. Only the kinds this build writes.
create function crm_check_profile_item(wanted_kind text, given jsonb, workspace uuid, page uuid)
  returns void
  language plpgsql
  immutable
  set search_path = pg_catalog, pg_temp
as $$
declare
  title text := given ->> 'title';
  link text := given ->> 'url';
  note text := given ->> 'note';
  allowed text[];
begin
  if wanted_kind is null or wanted_kind not in ('link', 'page', 'heading') then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_KIND';
  end if;
  if given is null or pg_catalog.jsonb_typeof(given) <> 'object' then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
  allowed := case wanted_kind
    when 'link' then array['title', 'url', 'note', 'icon', 'hue']
    when 'heading' then array['title']
    else array[]::text[] end;
  if exists (select 1 from pg_catalog.jsonb_each(given) e where e.key <> all (allowed)
      or pg_catalog.jsonb_typeof(e.value) <> 'string') then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
  if wanted_kind = 'page' then
    if workspace is null or page is null then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    return;
  end if;
  if workspace is not null or page is not null or title is null or title ~ '[[:cntrl:]]'
    or pg_catalog.char_length(pg_catalog.btrim(title)) < 1
    or pg_catalog.char_length(title) > (case wanted_kind when 'link' then 60 else 40 end) then
    raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
  end if;
  if wanted_kind = 'link' then
    -- The schemes AC-5103 allows, no credentials, no control characters or spaces, at most 2,000 characters.
    if link is null or pg_catalog.char_length(link) > 2000 or link ~ '[[:cntrl:][:space:]]'
      or link !~* '^(https?://[^/?#@]+([/?#].*)?|mailto:.+|tel:.+|sms:.+)$'
      or (note is not null and (pg_catalog.char_length(note) > 120 or note ~ '[[:cntrl:]]')) then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
  end if;
end;
$$;
--> statement-breakpoint
-- Adds or edits one block of `owner`'s link page, and answers it. Idempotent on `item`: the same add again changes
-- nothing; another person's id is P0002 PROFILE_ITEM_MISSING, as an unknown one would be, and a kind never changes.
-- A new block goes at the end, refused with 54000 PROFILE_ITEM_LIMIT (its detail the kind that is full, or `items`)
-- past 60 live blocks, 40 links, 12 headings or 200 kept in all; a repeated heading or page is 23505 on its index.
-- One person's writes queue on an advisory lock, so two at once can't both pass a limit or take one place.
create function crm_save_profile_item(owner uuid, item uuid, wanted_kind text, given jsonb, workspace uuid, page uuid)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid,
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
  perform public.crm_check_profile_item(wanted_kind, given, workspace, page);
  select * into held from auth.profile_items i where i.id = item for update;
  if found then
    if held.user_id <> owner then
      raise exception using errcode = 'P0002', message = 'PROFILE_ITEM_MISSING';
    end if;
    if held.kind <> wanted_kind then
      raise exception using errcode = '22023', message = 'PROFILE_ITEM_DATA';
    end if;
    update auth.profile_items i
    set data = given, workspace_id = workspace, page_id = page, updated_at = pg_catalog.now()
    where i.id = item and (i.data, i.workspace_id, i.page_id) is distinct from (given, workspace, page);
  else
    select count(*) filter (where i.archived_at is null),
      count(*) filter (where i.archived_at is null and i.kind = wanted_kind),
      count(*)
    into live, live_kind, kept
    from auth.profile_items i where i.user_id = owner;
    cap := case wanted_kind when 'link' then 40 when 'heading' then 12 else 60 end;
    if live >= 60 or kept >= 200 then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'items';
    end if;
    if live_kind >= cap then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = wanted_kind;
    end if;
    insert into auth.profile_items (id, user_id, kind, position, data, workspace_id, page_id)
    values (item, owner, wanted_kind,
      (select coalesce(max(i.position) + 1, 0) from auth.profile_items i where i.user_id = owner and i.archived_at is null),
      given, workspace, page);
  end if;
  return query
    select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.archived_at, i.updated_at
    from auth.profile_items i where i.id = item;
end;
$$;
--> statement-breakpoint
-- Places `owner`'s live blocks 0, 1, 2 … in the order given, in one statement. Refused with 22023
-- PROFILE_ORDER_STALE unless `ids` names exactly their live blocks, each once: an order from a tab that missed an
-- add, an archive or a delete never lands.
create function crm_order_profile_items(owner uuid, ids uuid[])
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  if ids is null
    or (select count(distinct w.id) from pg_catalog.unnest(ids) w(id)) <> pg_catalog.cardinality(ids)
    or (select count(*) from auth.profile_items i where i.user_id = owner and i.archived_at is null)
      <> pg_catalog.cardinality(ids)
    or exists (
      select 1 from pg_catalog.unnest(ids) w(id)
      where not exists (
        select 1 from auth.profile_items i where i.id = w.id and i.user_id = owner and i.archived_at is null
      )
    ) then
    raise exception using errcode = '22023', message = 'PROFILE_ORDER_STALE';
  end if;
  update auth.profile_items i
  set position = (w.n - 1)::smallint, updated_at = pg_catalog.now()
  from pg_catalog.unnest(ids) with ordinality w(id, n)
  where i.id = w.id and i.user_id = owner and i.position is distinct from (w.n - 1)::smallint;
end;
$$;
--> statement-breakpoint
-- Places `owner`'s live blocks 0, 1, 2 … in the order they stand, closing the gap an archive or a delete left. Not a
-- definer: it runs only inside crm_handle's own functions, as crm_handle, and nothing else may run it.
create function crm_pack_profile_items(owner uuid)
  returns void
  language sql
  set search_path = pg_catalog, pg_temp
begin atomic
  update auth.profile_items i
  set position = (r.n - 1)::smallint
  from (
    select p.id, pg_catalog.row_number() over (order by p.position, p.id) as n
    from auth.profile_items p
    where p.user_id = crm_pack_profile_items.owner and p.archived_at is null
  ) r
  where i.id = r.id and i.position is distinct from (r.n - 1)::smallint;
end;
--> statement-breakpoint
-- Archives one of `owner`'s blocks (it leaves the page and its place), or restores it to the end, under the same
-- limits as an add (54000 PROFILE_ITEM_LIMIT) and the same one heading, one page rules (23505). Answers whether
-- `owner` has that block; nothing changes when it already is as asked.
create function crm_archive_profile_item(owner uuid, item uuid, archived boolean)
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
  select * into held from auth.profile_items i where i.id = item and i.user_id = owner for update;
  if not found then
    return false;
  end if;
  if archived and held.archived_at is null then
    update auth.profile_items i set archived_at = pg_catalog.now(), position = null, updated_at = pg_catalog.now()
    where i.id = item;
    perform public.crm_pack_profile_items(owner);
  elsif not archived and held.archived_at is not null then
    select count(*), count(*) filter (where i.kind = held.kind) into live, live_kind
    from auth.profile_items i where i.user_id = owner and i.archived_at is null;
    if live >= 60 then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = 'items';
    end if;
    if live_kind >= (case held.kind when 'link' then 40 when 'heading' then 12 when 'contact' then 1 else 60 end) then
      raise exception using errcode = '54000', message = 'PROFILE_ITEM_LIMIT', detail = held.kind;
    end if;
    update auth.profile_items i
    set archived_at = null, updated_at = pg_catalog.now(),
      position = (select coalesce(max(p.position) + 1, 0) from auth.profile_items p
        where p.user_id = owner and p.archived_at is null)
    where i.id = item;
  end if;
  return true;
end;
$$;
--> statement-breakpoint
-- Deletes one of `owner`'s blocks for good. Answers whether they had it.
create function crm_delete_profile_item(owner uuid, item uuid)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  delete from auth.profile_items i where i.id = item and i.user_id = owner;
  if not found then
    return false;
  end if;
  perform public.crm_pack_profile_items(owner);
  return true;
end;
$$;
--> statement-breakpoint
-- Puts one booking page at the end of `owner`'s link page, once, as it is made Public (created so, or changed from
-- Link only): what the profile always did with a new page. Nothing when any block of theirs, live or archived, names
-- it already (they took it off on purpose), or past a limit: a booking page is never refused for its link page.
create function crm_place_profile_page(owner uuid, workspace uuid, page uuid)
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  if workspace is null or page is null
    or exists (select 1 from auth.profile_items i where i.user_id = owner and i.page_id = page)
    or (select count(*) from auth.profile_items i where i.user_id = owner and i.archived_at is null) >= 60
    or (select count(*) from auth.profile_items i where i.user_id = owner) >= 200 then
    return;
  end if;
  insert into auth.profile_items (id, user_id, kind, position, data, workspace_id, page_id)
  values (pg_catalog.uuidv7(), owner, 'page',
    (select coalesce(max(i.position) + 1, 0) from auth.profile_items i where i.user_id = owner and i.archived_at is null),
    '{}'::jsonb, workspace, page);
end;
$$;
--> statement-breakpoint
revoke all on function crm_profile_items(uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_items_archived(uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_items_public(uuid, smallint, uuid, integer) from public;
--> statement-breakpoint
revoke all on function crm_check_profile_item(text, jsonb, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_save_profile_item(uuid, uuid, text, jsonb, uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_order_profile_items(uuid, uuid[]) from public;
--> statement-breakpoint
revoke all on function crm_pack_profile_items(uuid) from public;
--> statement-breakpoint
revoke all on function crm_archive_profile_item(uuid, uuid, boolean) from public;
--> statement-breakpoint
revoke all on function crm_delete_profile_item(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_place_profile_page(uuid, uuid, uuid) from public;
--> statement-breakpoint
grant execute on function crm_profile_items(uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_items_archived(uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_items_public(uuid, smallint, uuid, integer) to crm_app;
--> statement-breakpoint
grant execute on function crm_save_profile_item(uuid, uuid, text, jsonb, uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_order_profile_items(uuid, uuid[]) to crm_app;
--> statement-breakpoint
grant execute on function crm_archive_profile_item(uuid, uuid, boolean) to crm_app;
--> statement-breakpoint
grant execute on function crm_delete_profile_item(uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_place_profile_page(uuid, uuid, uuid) to crm_app;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
alter function crm_profile_items(uuid) owner to crm_handle;
--> statement-breakpoint
alter function crm_profile_items_archived(uuid) owner to crm_handle;
--> statement-breakpoint
alter function crm_profile_items_public(uuid, smallint, uuid, integer) owner to crm_handle;
--> statement-breakpoint
alter function crm_check_profile_item(text, jsonb, uuid, uuid) owner to crm_handle;
--> statement-breakpoint
alter function crm_save_profile_item(uuid, uuid, text, jsonb, uuid, uuid) owner to crm_handle;
--> statement-breakpoint
alter function crm_order_profile_items(uuid, uuid[]) owner to crm_handle;
--> statement-breakpoint
alter function crm_pack_profile_items(uuid) owner to crm_handle;
--> statement-breakpoint
alter function crm_archive_profile_item(uuid, uuid, boolean) owner to crm_handle;
--> statement-breakpoint
alter function crm_delete_profile_item(uuid, uuid) owner to crm_handle;
--> statement-breakpoint
alter function crm_place_profile_page(uuid, uuid, uuid) owner to crm_handle;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
-- Which of `owner`'s booking pages may sit on their link page, and which of those visitors see now (`is_live`):
-- Public (never Link only: its address can't be guessed), not deleted, and theirs, still an active member with this
-- very identity, in a workspace that exists; only those `pages` names when it is not null. Ids only, at most 200.
create function crm_booking_owner_pages(owner uuid, pages uuid[])
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
revoke all on function crm_booking_owner_pages(uuid, uuid[]) from public;
--> statement-breakpoint
grant execute on function crm_booking_owner_pages(uuid, uuid[]) to crm_app;
--> statement-breakpoint
grant crm_booking_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_booking_lookup;
--> statement-breakpoint
alter function crm_booking_owner_pages(uuid, uuid[]) owner to crm_booking_lookup;
--> statement-breakpoint
revoke create on schema public from crm_booking_lookup;
--> statement-breakpoint
revoke crm_booking_lookup from current_user;
--> statement-breakpoint
-- The backfill (AC-5129), as the owner, past row level security: a role it would filter fails here rather than
-- backfilling nothing, like 0082 and 0086. Every Public page, live or paused (a paused one keeps its place and
-- shows again when it is resumed), of a person still its active owner in a workspace that exists, in their profile's
-- order (position, then id). A person whose pages sit in one workspace: the pages with no section first, then each
-- section where its first page is, as a heading. In several workspaces: each workspace's pages with no section under
-- a heading named after it, in the order their first page stood, then each section. Headings are one per text,
-- ignoring case and surrounding spaces (the first spelling wins), at most 40 characters.
set local row_security = off;
--> statement-breakpoint
create temporary table profile_backfill on commit drop as
with listed as (
  select p.owner_user_id as user_id, p.workspace_id, p.id as page_id, p.profile_position,
    nullif(pg_catalog.btrim(pg_catalog.left(pg_catalog.btrim(p.profile_section), 40)), '') as section,
    nullif(pg_catalog.btrim(pg_catalog.left(pg_catalog.btrim(w.name), 40)), '') as workspace_name
  from booking_pages p
  join workspaces w on w.id = p.workspace_id and w.deleted_at is null
  join members m on m.workspace_id = p.workspace_id and m.id = p.owner_member_id
    and m.user_id = p.owner_user_id and m.status = 'active'
  join auth."user" u on u.id = p.owner_user_id
  where p.deleted_at is null and p.is_private = false and p.owner_user_id is not null
),
spread as (
  select l.user_id, count(distinct l.workspace_id) > 1 as is_split from listed l group by l.user_id
),
named as (
  select l.*,
    case when s.is_split then coalesce(l.section, l.workspace_name) else l.section end as heading,
    s.is_split and l.section is null and l.workspace_name is not null as is_workspace,
    pg_catalog.row_number() over (partition by l.user_id order by l.profile_position, l.page_id) as seen
  from listed l join spread s on s.user_id = l.user_id
),
headings as (
  select n.user_id, pg_catalog.lower(n.heading) as heading_key,
    (pg_catalog.array_agg(n.heading order by n.seen))[1] as title,
    pg_catalog.bool_or(n.is_workspace) as is_workspace,
    min(n.seen) as first_seen
  from named n where n.heading is not null
  group by n.user_id, pg_catalog.lower(n.heading)
),
ranked as (
  select h.*, pg_catalog.row_number() over (partition by h.user_id order by h.is_workspace desc, h.first_seen) as rank
  from headings h
),
blocks as (
  select n.user_id, 'page'::text as kind, coalesce(r.rank, 0) as rank, 1 as within, n.seen,
    '{}'::jsonb as data, n.workspace_id, n.page_id
  from named n left join ranked r on r.user_id = n.user_id and r.heading_key = pg_catalog.lower(n.heading)
  union all
  select r.user_id, 'heading', r.rank, 0, 0, pg_catalog.jsonb_build_object('title', r.title), null::uuid, null::uuid
  from ranked r
)
select b.*, pg_catalog.row_number() over (partition by b.user_id order by b.rank, b.within, b.seen) - 1 as place
from blocks b;
--> statement-breakpoint
insert into auth.profile_items (id, user_id, kind, position, data, workspace_id, page_id)
select uuidv7(), b.user_id, b.kind, b.place::smallint, b.data, b.workspace_id, b.page_id
from profile_backfill b
where b.place <= 999
order by b.user_id, b.place;
--> statement-breakpoint
-- Refuse to finish unless the new functions are as narrow as they read: each owned by its role, a definer (the
-- check and the pack are not: they run as their caller, inside the definers), executable by crm_app alone and out of the identity
-- login's reach; and crm_app holds nothing on the table itself.
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.crm_profile_items(uuid)'::regprocedure,
    'public.crm_profile_items_archived(uuid)'::regprocedure,
    'public.crm_profile_items_public(uuid, smallint, uuid, integer)'::regprocedure,
    'public.crm_save_profile_item(uuid, uuid, text, jsonb, uuid, uuid)'::regprocedure,
    'public.crm_order_profile_items(uuid, uuid[])'::regprocedure,
    'public.crm_archive_profile_item(uuid, uuid, boolean)'::regprocedure,
    'public.crm_delete_profile_item(uuid, uuid)'::regprocedure,
    'public.crm_place_profile_page(uuid, uuid, uuid)'::regprocedure
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = fn) <> 'crm_handle'
      or not (select p.prosecdef from pg_proc p where p.oid = fn)
      or exists (
        select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
        where p.oid = fn and a.privilege_type = 'EXECUTE'
          and a.grantee not in ('crm_handle'::regrole, 'crm_app'::regrole)
      )
      or has_function_privilege('crm_identity', fn, 'EXECUTE') then
      raise exception '% must be owned by crm_handle and executable by crm_app alone', fn;
    end if;
  end loop;
  foreach fn in array array[
    'public.crm_check_profile_item(text, jsonb, uuid, uuid)'::regprocedure,
    'public.crm_pack_profile_items(uuid)'::regprocedure
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = fn) <> 'crm_handle'
      or has_function_privilege('crm_app', fn, 'EXECUTE')
      or has_function_privilege('crm_identity', fn, 'EXECUTE') then
      raise exception '% must be owned by crm_handle and reachable only from its own functions', fn;
    end if;
  end loop;
  if (select pg_get_userbyid(p.proowner) from pg_proc p
      where p.oid = 'public.crm_booking_owner_pages(uuid, uuid[])'::regprocedure) <> 'crm_booking_lookup'
    or has_function_privilege('crm_identity', 'public.crm_booking_owner_pages(uuid, uuid[])', 'EXECUTE') then
    raise exception 'crm_booking_owner_pages must be owned by crm_booking_lookup and out of the identity login''s reach';
  end if;
  if has_table_privilege('crm_app', 'auth.profile_items', 'SELECT')
    or has_table_privilege('crm_app', 'auth.profile_items', 'INSERT')
    or has_table_privilege('crm_app', 'auth.profile_items', 'UPDATE')
    or has_table_privilege('crm_app', 'auth.profile_items', 'DELETE') then
    raise exception 'crm_app must reach auth.profile_items only through crm_handle''s functions';
  end if;
end
$$;
