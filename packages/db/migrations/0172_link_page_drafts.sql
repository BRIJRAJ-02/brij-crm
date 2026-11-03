-- Publish for link pages (spec 0068, AC-6810 to AC-6813; 4 November 2026). Numbered 0172, after 0171's page versions.
--
-- A link page's editor keeps writing the rows it always wrote (the profile's bio, look, accent, photos and identity,
-- and its blocks): those are now the page's draft. What guests see is the page's published snapshot, kept on its
-- profile row (`published`), which only Publish writes. Every reader a guest reaches reads the snapshot; the
-- editor's readers keep reading the rows. Pausing (the Live or Private switch), the handle, the share picture, the
-- QR's style and whether search engines may list the page stay instant (AC-6813), so they are not in the snapshot.
--
-- What changes:
-- * `auth.public_profiles` gains `published` (the snapshot, an object: the drafted columns by name and `items`, the
--   live blocks in order) and `published_at`. Every page that exists now is published as it is (AC-6814's rule for
--   link pages), so nothing changes for guests. A page made after this has none until its owner publishes it, and
--   guests see the page with nothing on it until then (never the draft).
-- * Definers, every one crm_handle's, executable by crm_app alone, each refusing a workspace other than the
--   transaction's own and a person who isn't an active member there:
--   * `crm_link_page_state(owner, workspace)`: the draft and the published snapshot side by side, for the editor's
--     Changes list and for Publish's version.
--   * `crm_publish_link_page(owner, workspace)`: the rows become the published snapshot; answers it.
--   * `crm_restore_link_page(owner, workspace, wanted)`: the rows become `wanted` (a version, as page_versions kept
--     it): the profile's drafted columns, and each block in it that still exists, checked as a save checks it, put
--     back in its place; a live block not in it is archived (never deleted). A block's target never changes, a block
--     naming a picture no longer kept stays as it is, and a photo is put back only while the store still holds it
--     (the published one or the draft's own).
--   * `crm_discard_link_draft(owner, workspace)`: the same, back to the published snapshot.
--   * `crm_profile_identity_public` and `crm_profile_look_public`: the published job title switch, site and foot
--     line, and accent and photos, for the public link page and the personal booking pages that wear them.
-- * Guest readers move to the snapshot: `crm_handle_owner` (bio and look), `crm_profile_items_public` (the blocks,
--   and through it a block's pictures, its contact card and its next times), and `crm_count_item_press` (a press
--   counts on a published block). The pictures sweep keeps every picture the snapshot names.
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
set local row_security = on;
--> statement-breakpoint
alter table auth.public_profiles
  add column published jsonb,
  add column published_at timestamp (6) with time zone;
--> statement-breakpoint
alter table auth.public_profiles add constraint public_profiles_published check (
  (published is null) = (published_at is null)
  and (published is null or (jsonb_typeof(published) = 'object' and jsonb_typeof(published -> 'items') = 'array'))
);
--> statement-breakpoint
-- Written only by the definers below.
grant update (published, published_at, bio, theme, accent, accent_dark, cover_path, cover_type, cover_version,
  ground_path, ground_type, ground_version, show_job_title, site_url, foot_line, updated_at)
  on auth.public_profiles to crm_handle;
--> statement-breakpoint
-- The workspace's template waits for Publish too (owner, 4 Nov 2026): Settings › Brand writes the pick here, and
-- Publish moves it into `template`, which every public page wears. Null when nothing waits.
alter table workspace_brands add column template_draft text;
--> statement-breakpoint
alter table workspace_brands add constraint workspace_brands_template_draft
  check (template_draft is null or template_draft in ('classic', 'studio', 'night', 'split'));
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- The page as its rows hold it now, in the snapshot's shape: the drafted columns by name, and the live blocks in
-- order. Not granted to anyone: the definers below call it.
create function crm_link_page_rows(owner uuid, workspace uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select pg_catalog.jsonb_build_object(
    'bio', p.bio, 'theme', p.theme, 'accent', p.accent, 'accent_dark', p.accent_dark,
    'cover_path', p.cover_path, 'cover_type', p.cover_type, 'cover_version', p.cover_version,
    'ground_path', p.ground_path, 'ground_type', p.ground_type, 'ground_version', p.ground_version,
    'show_job_title', p.show_job_title, 'site_url', p.site_url, 'foot_line', p.foot_line,
    'items', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', i.id, 'kind', i.kind, 'position', i.position, 'data', i.data, 'workspace_id', i.workspace_id,
          'page_id', i.page_id, 'form_id', i.form_id)
        order by i.position, i.id)
      from auth.profile_items i
      where i.user_id = p.user_id and i.workspace_id = p.workspace_id and i.archived_at is null
    ), '[]'::jsonb))
  from auth.public_profiles p
  where p.user_id = crm_link_page_rows.owner and p.workspace_id = crm_link_page_rows.workspace;
end;
--> statement-breakpoint
revoke all on function crm_link_page_rows(uuid, uuid) from public;
--> statement-breakpoint
-- Every page that exists now, published as it is.
update auth.public_profiles p
set published = public.crm_link_page_rows(p.user_id, p.workspace_id), published_at = pg_catalog.now();
--> statement-breakpoint
-- The draft (the rows) and the published snapshot, for the owner's own editor. No row outside the transaction's
-- workspace or for someone who isn't an active member there.
create function crm_link_page_state(owner uuid, workspace uuid)
  returns table (draft jsonb, published jsonb, published_at timestamptz)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select public.crm_link_page_rows(p.user_id, p.workspace_id), p.published, p.published_at
  from auth.public_profiles p
  where p.user_id = crm_link_page_state.owner
    and p.workspace_id = crm_link_page_state.workspace
    and p.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    and public.crm_workspace_member(p.user_id, p.workspace_id);
end;
--> statement-breakpoint
-- Publishes `owner`'s page in `workspace`: its rows become what guests see. Answers the snapshot. Refused (42501)
-- outside the transaction's workspace or for someone not an active member there; P0002 with no page there.
create function crm_publish_link_page(owner uuid, workspace uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  snapshot jsonb;
begin
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_THIS_WORKSPACE';
  end if;
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  snapshot := public.crm_link_page_rows(owner, workspace);
  if snapshot is null then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  update auth.public_profiles p
  set published = snapshot, published_at = pg_catalog.now()
  where p.user_id = owner and p.workspace_id = workspace;
  return snapshot;
end;
$$;
--> statement-breakpoint
-- Puts `owner`'s page rows back to `wanted`, a snapshot in crm_link_page_rows' shape. Every block is checked as a
-- save checks it; one that no longer exists is left out, one whose kind differs or that names a picture no longer
-- kept stays as it is. A live block `wanted` doesn't hold is archived. The column checks refuse a bad bio, look,
-- accent, address or line (23514).
create function crm_restore_link_page(owner uuid, workspace uuid, wanted jsonb)
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  held auth.public_profiles%rowtype;
  block record;
  kept uuid[] := '{}';
  next_position smallint := 0;
  chosen jsonb;
begin
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_THIS_WORKSPACE';
  end if;
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  if wanted is null or pg_catalog.jsonb_typeof(wanted) <> 'object'
    or pg_catalog.jsonb_typeof(wanted -> 'items') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'PROFILE_VERSION_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_profile_items:' || owner::text, 0));
  select * into held from auth.public_profiles p where p.user_id = owner and p.workspace_id = workspace for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  update auth.public_profiles p
  set bio = coalesce(wanted ->> 'bio', ''),
    -- A page always has a look: a version without one keeps the draft's.
    theme = coalesce(nullif(wanted -> 'theme', 'null'::jsonb), p.theme),
    accent = wanted ->> 'accent',
    accent_dark = wanted ->> 'accent_dark',
    show_job_title = coalesce((wanted ->> 'show_job_title')::boolean, false),
    site_url = wanted ->> 'site_url',
    foot_line = wanted ->> 'foot_line',
    -- A photo only while the store holds it: the published one or the draft's own; else the draft's stays.
    cover_path = case when (wanted ->> 'cover_path') is null
        or (wanted ->> 'cover_path') in (held.cover_path, held.published ->> 'cover_path')
      then wanted ->> 'cover_path' else held.cover_path end,
    cover_type = case when (wanted ->> 'cover_path') is null
        or (wanted ->> 'cover_path') in (held.cover_path, held.published ->> 'cover_path')
      then wanted ->> 'cover_type' else held.cover_type end,
    cover_version = case when (wanted ->> 'cover_path') is null
        or (wanted ->> 'cover_path') in (held.cover_path, held.published ->> 'cover_path')
      then wanted ->> 'cover_version' else held.cover_version end,
    ground_path = case when (wanted ->> 'ground_path') is null
        or (wanted ->> 'ground_path') in (held.ground_path, held.published ->> 'ground_path')
      then wanted ->> 'ground_path' else held.ground_path end,
    ground_type = case when (wanted ->> 'ground_path') is null
        or (wanted ->> 'ground_path') in (held.ground_path, held.published ->> 'ground_path')
      then wanted ->> 'ground_type' else held.ground_type end,
    ground_version = case when (wanted ->> 'ground_path') is null
        or (wanted ->> 'ground_path') in (held.ground_path, held.published ->> 'ground_path')
      then wanted ->> 'ground_version' else held.ground_version end,
    updated_at = pg_catalog.now()
  where p.user_id = owner and p.workspace_id = workspace;
  -- Places are unique per person only at commit, so blocks may pass through each other's on the way.
  for block in
    select i.id, i.kind, i.page_id, i.form_id, w.data, i.data as held_data
    from pg_catalog.jsonb_array_elements(wanted -> 'items') with ordinality e(item, at)
    cross join lateral (select (e.item ->> 'id')::uuid as id, e.item -> 'data' as data, e.item ->> 'kind' as kind) w
    join auth.profile_items i on i.id = w.id and i.user_id = owner and i.workspace_id = workspace and i.kind = w.kind
    order by e.at
  loop
    if next_position > 999 then
      exit;
    end if;
    -- The version's fields, unless they name a picture no longer kept: then the block's own. Either way the block
    -- is checked as a save checks it, target included, before it is put back on the page.
    chosen := case when pg_catalog.jsonb_typeof(block.data) = 'object' and not exists (
        select 1 from public.crm_profile_item_images(block.data) w(image)
        where not exists (select 1 from auth.profile_images m
          where m.id = w.image and m.user_id = owner and m.workspace_id = workspace)
      ) then block.data else block.held_data end;
    perform public.crm_check_profile_item(block.kind, chosen,
      case when block.kind in ('page', 'form', 'times') then workspace end, block.page_id, block.form_id);
    if block.kind in ('page', 'times') and not exists (
      select 1 from public.crm_booking_owner_pages(owner, workspace, array[block.page_id]) o where o.page_id = block.page_id
    ) then
      raise exception using errcode = '42704', message = 'PROFILE_TARGET_MISSING';
    end if;
    if block.kind = 'form' and not exists (
      select 1 from public.crm_form_owner_forms(owner, workspace, array[block.form_id]) o where o.form_id = block.form_id
    ) then
      raise exception using errcode = '42704', message = 'PROFILE_TARGET_MISSING';
    end if;
    update auth.profile_items i set data = chosen, archived_at = null, position = next_position where i.id = block.id;
    kept := kept || block.id;
    next_position := next_position + 1;
  end loop;
  update auth.profile_items i
  set archived_at = pg_catalog.now(), position = null
  where i.user_id = owner and i.workspace_id = workspace and i.archived_at is null and not (i.id = any (kept));
end;
$$;
--> statement-breakpoint
-- Drops `owner`'s draft: the rows go back to the published snapshot. A page never published has nothing to go back
-- to (P0002).
create function crm_discard_link_draft(owner uuid, workspace uuid)
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  snapshot jsonb;
begin
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_THIS_WORKSPACE';
  end if;
  select p.published into snapshot from auth.public_profiles p where p.user_id = owner and p.workspace_id = workspace;
  if snapshot is null then
    raise exception using errcode = 'P0002', message = 'PROFILE_NOT_PUBLISHED';
  end if;
  perform public.crm_restore_link_page(owner, workspace, snapshot);
end;
$$;
--> statement-breakpoint
-- The published job title switch, site and foot line (0164's three, as guests see them).
create function crm_profile_identity_public(owner uuid, workspace uuid)
  returns table (show_job_title boolean, site_url text, foot_line text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select coalesce((p.published ->> 'show_job_title')::boolean, false), p.published ->> 'site_url',
    p.published ->> 'foot_line'
  from auth.public_profiles p
  where p.user_id = crm_profile_identity_public.owner
    and p.workspace_id = crm_profile_identity_public.workspace
    and p.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    and public.crm_workspace_member(p.user_id, p.workspace_id);
end;
--> statement-breakpoint
-- The published accent pair and photos (0155's, as guests see them).
create function crm_profile_look_public(owner uuid, workspace uuid)
  returns table (accent text, accent_dark text, cover_path text, cover_type text, cover_version text,
    ground_path text, ground_type text, ground_version text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.published ->> 'accent', p.published ->> 'accent_dark', p.published ->> 'cover_path',
    p.published ->> 'cover_type', p.published ->> 'cover_version', p.published ->> 'ground_path',
    p.published ->> 'ground_type', p.published ->> 'ground_version'
  from auth.public_profiles p
  where p.user_id = crm_profile_look_public.owner
    and p.workspace_id = crm_profile_look_public.workspace
    and p.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    and public.crm_workspace_member(p.user_id, p.workspace_id);
end;
--> statement-breakpoint
-- 0116's, with the bio and the look as published: a page never published shows neither.
create or replace function crm_handle_owner(wanted text)
  returns table (user_id uuid, workspace_id uuid, handle text, bio text, name text, image text, theme jsonb,
    indexable boolean, share_image_version text, shown boolean)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.user_id, p.workspace_id, p.handle, coalesce(p.published ->> 'bio', ''), u.name,
    case when coalesce(k.picture_hidden, false) then null else u.image end,
    nullif(p.published -> 'theme', 'null'::jsonb), p.indexable, p.share_image_version, p.shown_at is not null
  from auth.public_handles h
  join auth.public_profiles p on p.user_id = h.user_id and p.workspace_id = h.workspace_id
  join auth."user" u on u.id = h.user_id
  left join auth.user_prefs k on k.user_id = h.user_id
  where h.handle = crm_handle_owner.wanted
    and public.crm_workspace_member(h.user_id, h.workspace_id)
  limit 1;
end;
--> statement-breakpoint
-- 0156's, from the published snapshot: the blocks guests see, in their published order and window. A block id in the
-- snapshot is a row of this person's still (a deleted block leaves it), so a press or a picture checks against it.
create or replace function crm_profile_items_public(owner uuid, workspace uuid, after_position smallint, after_id uuid, max integer)
  returns table (id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid, form_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select i.id, i.kind, i.position, i.data, i.workspace_id, i.page_id, i.form_id
  from auth.public_profiles p
  cross join lateral pg_catalog.jsonb_to_recordset(p.published -> 'items')
    as i(id uuid, kind text, "position" smallint, data jsonb, workspace_id uuid, page_id uuid, form_id uuid)
  where p.user_id = crm_profile_items_public.owner and p.workspace_id = crm_profile_items_public.workspace
    and p.published is not null
    and i.workspace_id = crm_profile_items_public.workspace
    and exists (select 1 from auth.profile_items r where r.id = i.id and r.user_id = p.user_id
      and r.workspace_id = p.workspace_id and r.kind = i.kind)
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
-- 0156's, on a published block a visitor can press (it may be archived in the draft since).
create or replace function crm_count_item_press(owner uuid, workspace uuid, item uuid, visitor text)
  returns void
  language sql
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  with press as (
    insert into auth.profile_item_presses (item_id, day, visitor)
    select i.id, (pg_catalog.now() at time zone 'UTC')::date, crm_count_item_press.visitor
    from auth.profile_items i
    join auth.public_profiles p on p.user_id = i.user_id and p.workspace_id = i.workspace_id
    where i.id = crm_count_item_press.item and i.user_id = crm_count_item_press.owner
      and i.workspace_id = crm_count_item_press.workspace
      and exists (select 1 from pg_catalog.jsonb_array_elements(p.published -> 'items') e
        where e ->> 'id' = i.id::text)
      and i.kind = any (array['link', 'page', 'contact', 'media', 'image', 'banner', 'times'])
    on conflict (item_id, day, visitor)
      do update set presses = auth.profile_item_presses.presses + 1, last_at = pg_catalog.now()
    returning auth.profile_item_presses.item_id, auth.profile_item_presses.day
  )
  insert into auth.profile_item_press_days (item_id, day, presses)
  select press.item_id, press.day, 1 from press
  on conflict (item_id, day) do update set presses = auth.profile_item_press_days.presses + 1;
end;
--> statement-breakpoint
-- 0156's, keeping too every picture a published block names.
create or replace function crm_profile_images_unused(max integer)
  returns table (id uuid, path text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select m.id, m.path
  from auth.profile_images m
  where m.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    and m.created_at < pg_catalog.now() - interval '24 hours'
    and not exists (
      select 1 from auth.profile_items i
      where i.user_id = m.user_id and i.workspace_id = m.workspace_id
        and m.id in (select w.image from public.crm_profile_item_images(i.data) w(image)))
    and not exists (
      select 1 from auth.public_profiles p
      cross join lateral pg_catalog.jsonb_array_elements(coalesce(p.published -> 'items', '[]'::jsonb)) e
      where p.user_id = m.user_id and p.workspace_id = m.workspace_id
        and m.id in (select w.image from public.crm_profile_item_images(e -> 'data') w(image)))
    and not exists (
      select 1 from auth.public_profiles p
      where p.user_id = m.user_id and p.workspace_id = m.workspace_id
        and p.qr_style -> 'picture' ->> 'image' = m.id::text)
  order by m.created_at
  limit least(greatest(crm_profile_images_unused.max, 0), 1000);
end;
--> statement-breakpoint
create or replace function crm_drop_profile_images(ids uuid[])
  returns integer
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  gone integer;
begin
  delete from auth.profile_images m
  where m.id = any (ids)
    and m.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    and m.created_at < pg_catalog.now() - interval '24 hours'
    and not exists (
      select 1 from auth.profile_items i
      where i.user_id = m.user_id and i.workspace_id = m.workspace_id
        and m.id in (select w.image from public.crm_profile_item_images(i.data) w(image)))
    and not exists (
      select 1 from auth.public_profiles p
      cross join lateral pg_catalog.jsonb_array_elements(coalesce(p.published -> 'items', '[]'::jsonb)) e
      where p.user_id = m.user_id and p.workspace_id = m.workspace_id
        and m.id in (select w.image from public.crm_profile_item_images(e -> 'data') w(image)))
    and not exists (
      select 1 from auth.public_profiles p
      where p.user_id = m.user_id and p.workspace_id = m.workspace_id
        and p.qr_style -> 'picture' ->> 'image' = m.id::text);
  get diagnostics gone = row_count;
  return gone;
end;
$$;
--> statement-breakpoint
revoke all on function crm_link_page_state(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_publish_link_page(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_restore_link_page(uuid, uuid, jsonb) from public;
--> statement-breakpoint
revoke all on function crm_discard_link_draft(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_identity_public(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_look_public(uuid, uuid) from public;
--> statement-breakpoint
grant execute on function crm_link_page_state(uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_publish_link_page(uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_restore_link_page(uuid, uuid, jsonb) to crm_app;
--> statement-breakpoint
grant execute on function crm_discard_link_draft(uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_identity_public(uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_look_public(uuid, uuid) to crm_app;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
-- Refuse to finish unless every new function is crm_handle's definer, the rows reader is executable by nobody else,
-- the rest by crm_app alone, and the app still reaches the profile row only through the definers.
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.crm_link_page_rows(uuid, uuid)'::regprocedure,
    'public.crm_link_page_state(uuid, uuid)'::regprocedure,
    'public.crm_publish_link_page(uuid, uuid)'::regprocedure,
    'public.crm_restore_link_page(uuid, uuid, jsonb)'::regprocedure,
    'public.crm_discard_link_draft(uuid, uuid)'::regprocedure,
    'public.crm_profile_identity_public(uuid, uuid)'::regprocedure,
    'public.crm_profile_look_public(uuid, uuid)'::regprocedure
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = fn) <> 'crm_handle'
      or not (select p.prosecdef from pg_proc p where p.oid = fn)
      or exists (
        select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
        where p.oid = fn and a.privilege_type = 'EXECUTE'
          and a.grantee not in ('crm_handle'::regrole, 'crm_app'::regrole)
      )
      or has_function_privilege('crm_identity', fn, 'EXECUTE')
      or has_function_privilege('public', fn, 'EXECUTE') then
      raise exception '% must be crm_handle''s definer, for crm_app alone', fn;
    end if;
  end loop;
  if has_function_privilege('crm_app', 'public.crm_link_page_rows(uuid, uuid)', 'EXECUTE') then
    raise exception 'crm_link_page_rows is for the definers alone';
  end if;
  if has_any_column_privilege('crm_app', 'auth.public_profiles', 'SELECT, INSERT, UPDATE, REFERENCES') then
    raise exception 'crm_app must hold nothing on auth.public_profiles';
  end if;
end
$$;
