-- Name and title go live at once (owner, 10 November 2026: "as per industry standard and in favour of Timefix").
-- Numbered 0205, after main's 0203 and the unsubscribe lane's 0204.
--
-- A link page's name and job title were always read live (the account's name, the member's job title), but whether
-- the title shows under the name (`show_job_title`, 0164) was drafted with the page (0172): a title typed in the
-- editor, or by a team page manager for a page only person, waited for Publish. Name, title and that choice are
-- profile data now, live on save, as on Linktree; the blocks, the design, the photos, the site and the closing line
-- keep the Publish model.
--
-- What changes, every function crm_handle's definer as before:
-- * `crm_profile_identity_public` answers the row's own `show_job_title`, not the snapshot's, so the link page, its
--   share card and the personal booking pages show the title the moment the switch (or a first title) is saved.
-- * `crm_link_page_rows` leaves `show_job_title` out of a snapshot, so the editor's Changes list (core's
--   `diffLinkPage`) never counts it as unpublished; snapshots already kept still hold it, and nothing reads it there.
-- * `crm_restore_link_page` (and through it Discard) no longer writes `show_job_title`: putting back a version or
--   dropping a draft never takes back a title its owner has since shown or hidden.
--
-- A page whose owner switched the title since their last Publish shows that choice once this runs: the change they
-- made is the one they now see.
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
set local row_security = on;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- 0172's, with the switch as the row holds it: live on save.
create or replace function crm_profile_identity_public(owner uuid, workspace uuid)
  returns table (show_job_title boolean, site_url text, foot_line text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.show_job_title, p.published ->> 'site_url', p.published ->> 'foot_line'
  from auth.public_profiles p
  where p.user_id = crm_profile_identity_public.owner
    and p.workspace_id = crm_profile_identity_public.workspace
    and p.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    and public.crm_workspace_member(p.user_id, p.workspace_id);
end;
--> statement-breakpoint
-- 0197's, without the title switch: it is profile data, never drafted.
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
    'site_url', p.site_url, 'foot_line', p.foot_line,
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
-- 0197's, leaving the title switch as it stands.
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
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
-- Refuse to finish unless every function changed here is still crm_handle's definer, the rows reader executable by
-- nobody else, the rest by crm_app alone.
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.crm_profile_identity_public(uuid, uuid)'::regprocedure,
    'public.crm_link_page_rows(uuid, uuid)'::regprocedure,
    'public.crm_restore_link_page(uuid, uuid, jsonb)'::regprocedure
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
