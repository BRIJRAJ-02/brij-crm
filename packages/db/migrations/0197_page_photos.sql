-- A link page's own profile photo (owner, 9 November 2026: "no option to add profile photo or background photo").
-- Numbered 0197, after main's 0196 page only people.
--
-- A page only person (0196) has no account picture, so their page had no face at all. The page now keeps a photo of
-- its own beside the cover and the photo ground (0155): `avatar_path`, `avatar_type` and `avatar_version`, held to
-- the same folder, types and version shape. It is drafted like the other two (0172): the editor writes the row,
-- Publish copies it into the snapshot, and only the snapshot reaches guests.
--
-- What changes, every function crm_handle's definer as before, each executable by crm_app alone:
-- * `crm_save_profile_image` takes the slot `avatar` too.
-- * `crm_profile_look` and `crm_profile_look_public` answer the avatar's three columns as well (their result
--   changes, so each is dropped and made again; no other function's body names them).
-- * `crm_link_page_rows` puts the avatar in a snapshot, and `crm_restore_link_page` puts it back, by the photos'
--   rule: only while the store still holds it (the published one or the draft's own).
-- * `crm_handle_owner` answers the published page photo as `image` (`page:<path>`), ahead of the account picture
--   and whatever the "show my photo" switch says: the page's editor chose it for this page. Without one it answers
--   as before. Core reads `page:` only for this page's own folder (`readProfilePicture`), so every guest reader of the
--   picture (the page, its contact card, its share card) serves it through the routes it already has.
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
set local row_security = on;
--> statement-breakpoint
alter table auth.public_profiles
  add column avatar_path text,
  add column avatar_type text,
  add column avatar_version text;
--> statement-breakpoint
alter table auth.public_profiles add constraint public_profiles_avatar check (
  (avatar_path is null and avatar_type is null and avatar_version is null)
  or (avatar_path ~ ('^profile-images/' || user_id::text || '/' || workspace_id::text || '/[0-9a-f-]{36}[.](png|jpg|webp)$')
    and avatar_type in ('image/png', 'image/jpeg', 'image/webp')
    and avatar_version ~ '^[0-9a-f]{12}$')
);
--> statement-breakpoint
-- Written only by the definers below.
grant update (avatar_path, avatar_type, avatar_version) on auth.public_profiles to crm_handle;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
drop function crm_profile_look(uuid, uuid);
--> statement-breakpoint
-- 0155's, with the page's own photo.
create function crm_profile_look(owner uuid, workspace uuid)
  returns table (accent text, accent_dark text, cover_path text, cover_type text, cover_version text,
    ground_path text, ground_type text, ground_version text, avatar_path text, avatar_type text, avatar_version text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.accent, p.accent_dark, p.cover_path, p.cover_type, p.cover_version,
    p.ground_path, p.ground_type, p.ground_version, p.avatar_path, p.avatar_type, p.avatar_version
  from auth.public_profiles p
  where p.user_id = crm_profile_look.owner
    and p.workspace_id = crm_profile_look.workspace
    and p.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    and public.crm_workspace_member(p.user_id, p.workspace_id);
end;
--> statement-breakpoint
drop function crm_profile_look_public(uuid, uuid);
--> statement-breakpoint
-- 0172's, with the page's own photo as guests see it.
create function crm_profile_look_public(owner uuid, workspace uuid)
  returns table (accent text, accent_dark text, cover_path text, cover_type text, cover_version text,
    ground_path text, ground_type text, ground_version text, avatar_path text, avatar_type text, avatar_version text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.published ->> 'accent', p.published ->> 'accent_dark', p.published ->> 'cover_path',
    p.published ->> 'cover_type', p.published ->> 'cover_version', p.published ->> 'ground_path',
    p.published ->> 'ground_type', p.published ->> 'ground_version', p.published ->> 'avatar_path',
    p.published ->> 'avatar_type', p.published ->> 'avatar_version'
  from auth.public_profiles p
  where p.user_id = crm_profile_look_public.owner
    and p.workspace_id = crm_profile_look_public.workspace
    and p.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    and public.crm_workspace_member(p.user_id, p.workspace_id);
end;
--> statement-breakpoint
-- 0155's, with the `avatar` slot.
create or replace function crm_save_profile_image(owner uuid, workspace uuid, slot text, path text, kind text, version text)
  returns text
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  previous text;
begin
  if slot is null or slot not in ('cover', 'ground', 'avatar') then
    raise exception using errcode = '22023', message = 'PROFILE_IMAGE_SLOT';
  end if;
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_THIS_WORKSPACE';
  end if;
  if not public.crm_workspace_member(owner, workspace) then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_MEMBER';
  end if;
  select case slot when 'cover' then p.cover_path when 'ground' then p.ground_path else p.avatar_path end
  into previous
  from auth.public_profiles p
  where p.user_id = owner and p.workspace_id = workspace
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
    where p.user_id = owner and p.workspace_id = workspace;
  elsif slot = 'ground' then
    update auth.public_profiles p
    set ground_path = path,
        ground_type = case when path is null then null else kind end,
        ground_version = case when path is null then null else version end,
        updated_at = pg_catalog.now()
    where p.user_id = owner and p.workspace_id = workspace;
  else
    update auth.public_profiles p
    set avatar_path = path,
        avatar_type = case when path is null then null else kind end,
        avatar_version = case when path is null then null else version end,
        updated_at = pg_catalog.now()
    where p.user_id = owner and p.workspace_id = workspace;
  end if;
  return previous;
end;
$$;
--> statement-breakpoint
-- 0172's, with the page's own photo in the snapshot.
create or replace function crm_link_page_rows(owner uuid, workspace uuid)
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
    'avatar_path', p.avatar_path, 'avatar_type', p.avatar_type, 'avatar_version', p.avatar_version,
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
-- 0172's, putting the page's own photo back by the photos' rule.
create or replace function crm_restore_link_page(owner uuid, workspace uuid, wanted jsonb)
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
    avatar_path = case when (wanted ->> 'avatar_path') is null
        or (wanted ->> 'avatar_path') in (held.avatar_path, held.published ->> 'avatar_path')
      then wanted ->> 'avatar_path' else held.avatar_path end,
    avatar_type = case when (wanted ->> 'avatar_path') is null
        or (wanted ->> 'avatar_path') in (held.avatar_path, held.published ->> 'avatar_path')
      then wanted ->> 'avatar_type' else held.avatar_type end,
    avatar_version = case when (wanted ->> 'avatar_path') is null
        or (wanted ->> 'avatar_path') in (held.avatar_path, held.published ->> 'avatar_path')
      then wanted ->> 'avatar_version' else held.avatar_version end,
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
-- 0172's, with the published page photo as the page's picture: it wins over the account picture and the "show my
-- photo" switch, since the page's editor chose it for this page. A path the check above no longer holds to this
-- person's folder never gets here (the column check), and core reads `page:` for this page's folder alone.
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
    case
      when (p.published ->> 'avatar_path') is not null then 'page:' || (p.published ->> 'avatar_path')
      when coalesce(k.picture_hidden, false) then null
      else u.image
    end,
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
revoke all on function crm_profile_look(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_profile_look_public(uuid, uuid) from public;
--> statement-breakpoint
grant execute on function crm_profile_look(uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_profile_look_public(uuid, uuid) to crm_app;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
-- Refuse to finish unless every function changed here is still crm_handle's definer, the rows reader executable by
-- nobody else, the rest by crm_app alone, and the app still reaches the profile row only through the definers.
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.crm_profile_look(uuid, uuid)'::regprocedure,
    'public.crm_profile_look_public(uuid, uuid)'::regprocedure,
    'public.crm_save_profile_image(uuid, uuid, text, text, text, text)'::regprocedure,
    'public.crm_link_page_rows(uuid, uuid)'::regprocedure,
    'public.crm_restore_link_page(uuid, uuid, jsonb)'::regprocedure,
    'public.crm_handle_owner(text)'::regprocedure
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
