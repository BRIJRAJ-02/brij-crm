-- The 20 handle cap stops counting a person's retired handles against them (late trap #76, 29 Oct 2026). A person
-- keeps every handle they ever had, so an old link still finds them, and at 20 in all `crm_ensure_public_profile`
-- answered NULL: a new membership then had no link page and nobody was told (the daily cleanup tried again, and
-- failed, every day), and `crm_save_public_profile` refused a rename with PUBLIC_HANDLE_LIMIT. Twenty was reachable
-- by renaming alone.
--
-- Now, as GitHub does with a renamed account's old name, the oldest retired handle makes room: one no page uses as
-- its current handle is let go into the same 90 day hold a deleted account's handles get (0126: `user_id` cleared,
-- `released_at` stamped by its trigger, swept after 90 days), so its old links stop finding them and nobody else can
-- take it for 90 days. The cap still holds: a person never holds more than 20, and with 20 current handles (20 live
-- pages) a new one is still refused, as before.
--
-- * crm_make_handle_room(owner), crm_handle's own invoker, executable by nobody else: only the two definers below,
--   which run as crm_handle, call it (as crm_pack_profile_items is called). It answers whether the person may take
--   one more handle, letting go of their oldest retired one when they are at the cap.
-- * crm_handle gets update on `auth.public_handles.user_id` only, the one column a release clears.
-- * crm_save_public_profile and crm_ensure_public_profile call it instead of counting. Nothing else changes in them.
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
grant update (user_id) on auth.public_handles to crm_handle;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- Whether `owner` may take one more handle: yes under 20; at 20, yes once their oldest handle no page uses is let go
-- into the 90 day hold; no when all 20 are some page's current handle. The caller holds the person's advisory lock.
create function crm_make_handle_room(owner uuid)
  returns boolean
  language plpgsql
  volatile
  set search_path = pg_catalog, pg_temp
as $$
declare
  retired text;
begin
  if (select pg_catalog.count(*) from auth.public_handles h where h.user_id = owner) < 20 then
    return true;
  end if;
  select h.handle into retired from auth.public_handles h
  where h.user_id = owner
    and not exists (select 1 from auth.public_profiles p where p.handle = h.handle)
  order by h.created_at, h.handle
  limit 1;
  if retired is null then
    return false;
  end if;
  update auth.public_handles set user_id = null where handle = retired and user_id = owner;
  return true;
end;
$$;
--> statement-breakpoint
create or replace function crm_save_public_profile(owner uuid, workspace uuid, wanted text, about text)
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
    and not public.crm_make_handle_room(owner) then
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
  select p.handle into held from auth.public_profiles p where p.user_id = owner and p.workspace_id = workspace;
  if held is not null then
    return held;
  end if;
  if not public.crm_make_handle_room(owner) then
    return null;
  end if;
  for try in 1..60 loop
    suffix := case
      when try = 1 then ''
      when try <= 30 then '-' || try::text
      else '-' || (1000 + pg_catalog.floor(pg_catalog.random() * 9000))::integer::text
    end;
    candidate := pg_catalog.rtrim(pg_catalog.left(base, 40 - pg_catalog.char_length(suffix)), '-') || suffix;
    insert into auth.public_handles (handle, user_id, workspace_id) values (candidate, owner, workspace)
    on conflict (handle) do nothing;
    get diagnostics made = row_count;
    if made = 1 then
      -- Live from the moment it exists, and unlisted: `indexable` false keeps it out of search engines until
      -- its owner says otherwise (the owner, 27 October 2026).
      insert into auth.public_profiles (user_id, workspace_id, handle, indexable, shown_at)
      values (owner, workspace, candidate, false, pg_catalog.now());
      return candidate;
    end if;
  end loop;
  return null;
end;
$$;
--> statement-breakpoint
-- As its owner: only crm_handle's own functions call it.
revoke all on function crm_make_handle_room(uuid) from public;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
do $$
begin
  if pg_catalog.pg_get_userbyid((select p.proowner from pg_proc p
       where p.oid = 'public.crm_make_handle_room(uuid)'::regprocedure)) <> 'crm_handle'
    or has_function_privilege('crm_app', 'public.crm_make_handle_room(uuid)', 'EXECUTE')
    or pg_catalog.pg_get_userbyid((select p.proowner from pg_proc p
       where p.oid = 'public.crm_save_public_profile(uuid, uuid, text, text)'::regprocedure)) <> 'crm_handle'
    or not has_function_privilege('crm_app', 'public.crm_save_public_profile(uuid, uuid, text, text)', 'EXECUTE')
    or pg_catalog.pg_get_userbyid((select p.proowner from pg_proc p
       where p.oid = 'public.crm_ensure_public_profile(uuid, uuid, text)'::regprocedure)) <> 'crm_handle'
    or not has_function_privilege('crm_app', 'public.crm_ensure_public_profile(uuid, uuid, text)', 'EXECUTE') then
    raise exception '0128_handle_cap: the handle functions are not crm_handle''s, or crm_app reaches the room maker';
  end if;
end
$$;
