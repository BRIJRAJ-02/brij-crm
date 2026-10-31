-- The link page's Live or Private switch (spec 0058, AC-23, 31 Oct 2026; the owner: "rest take industry standard
-- decisions"). Numbered 0142 after main's 0141.
--
-- What changes:
-- * A handle its owner claims (first run or Settings › Profile) is live at once, as on Linktree. The app calls
--   `crm_show_public_profile` on every claim, the one they were given included, which before this did nothing.
-- * A page made for someone else's sake (a membership of a workspace they were invited to, the daily cleanup's
--   `link_pages` phase) starts private and goes live the first time its owner opens it: privacy first, since an
--   address made from their name, with their name and photo on it, is not one they asked for.
-- * The owner can turn it Private again, and Live again, with one switch (`crm_set_public_profile_live`). A choice
--   they made is never overruled: opening, claiming or editing the page later leaves a Private page private.
--
-- `auth.public_profiles.claimed_at` is when the page became its owner's own choice: claimed, opened or switched.
-- Null for a page made for them that they haven't touched. `crm_show_public_profile` now acts only while it is null
-- (shows the page and stamps it), so the app's existing calls (opening, claiming, every edit) are all the first
-- touch, and none of them can undo a Private choice. `shown_at` keeps its meaning for every reader (null while the
-- page is private), so `crm_public_profiles_of` and `crm_handle_owner` are untouched; it now goes back to null when
-- the owner switches the page off. Pages that exist today are live and stay so, with `claimed_at` null.
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
alter table auth.public_profiles add column if not exists claimed_at timestamptz;
--> statement-breakpoint
-- Written only by the two definers below; `shown_at` already has its grant (0116).
grant update (claimed_at) on auth.public_profiles to crm_handle;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- The owner opened, claimed or edited their page in `workspace`: a page nobody has chosen for goes live, once, and is
-- theirs from then on. True when it is public after the call, false when it is private (made so by its owner), when
-- there is no page, they aren't an active member there, or `workspace` isn't the transaction's own
-- (`app.workspace_id`), so code in one workspace can never publish a page in another.
create or replace function crm_show_public_profile(owner uuid, workspace uuid)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  is_shown boolean;
begin
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    return false;
  end if;
  if not public.crm_workspace_member(owner, workspace) then
    return false;
  end if;
  update auth.public_profiles p
  set shown_at = coalesce(p.shown_at, pg_catalog.now()), claimed_at = pg_catalog.now()
  where p.user_id = owner and p.workspace_id = workspace and p.claimed_at is null;
  select p.shown_at is not null into is_shown
  from auth.public_profiles p where p.user_id = owner and p.workspace_id = workspace;
  return coalesce(is_shown, false);
end;
$$;
--> statement-breakpoint
-- The Live or Private switch: `owner`'s page in `workspace` is public when `live`, private otherwise, and their own
-- choice from now on. Answers whether it is public after the call; false, writing nothing, when there is no page,
-- they aren't an active member there, or `workspace` isn't the transaction's own.
create function crm_set_public_profile_live(owner uuid, workspace uuid, live boolean)
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
  where p.user_id = owner and p.workspace_id = workspace
  returning p.shown_at is not null into is_shown;
  return coalesce(is_shown, false);
end;
$$;
--> statement-breakpoint
-- As 0124 left it, but a page made for a membership starts private (`shown_at` null) and unlisted: it goes live when
-- its owner claims its handle or opens it.
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
  for try in 1..60 loop
    suffix := case
      when try = 1 then ''
      when try <= 30 then '-' || try::text
      else '-' || (1000 + pg_catalog.floor(pg_catalog.random() * 9000))::integer::text
    end;
    candidate := pg_catalog.rtrim(pg_catalog.left(base, 40 - pg_catalog.char_length(suffix)), '-') || suffix;
    -- Room is made only once a free candidate is in hand, so a person whose every try is taken loses no old
    -- handle for a page they don't get (security review). The insert still checks: the candidate isn't locked.
    if exists (select 1 from auth.public_handles h where h.handle = candidate) then
      continue;
    end if;
    if not roomy then
      if not public.crm_make_handle_room(owner) then
        return null;
      end if;
      roomy := true;
    end if;
    insert into auth.public_handles (handle, user_id, workspace_id) values (candidate, owner, workspace)
    on conflict (handle) do nothing;
    get diagnostics made = row_count;
    if made = 1 then
      -- Private and unlisted until its owner claims it or opens it (spec 0058, AC-23).
      insert into auth.public_profiles (user_id, workspace_id, handle, indexable)
      values (owner, workspace, candidate, false);
      return candidate;
    end if;
  end loop;
  return null;
end;
$$;
--> statement-breakpoint
revoke all on function crm_set_public_profile_live(uuid, uuid, boolean) from public;
--> statement-breakpoint
grant execute on function crm_set_public_profile_live(uuid, uuid, boolean) to crm_app;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
do $$
declare
  one text;
begin
  foreach one in array array[
    'public.crm_show_public_profile(uuid, uuid)',
    'public.crm_set_public_profile_live(uuid, uuid, boolean)',
    'public.crm_ensure_public_profile(uuid, uuid, text)'
  ] loop
    if pg_catalog.pg_get_userbyid((select p.proowner from pg_proc p where p.oid = one::regprocedure)) <> 'crm_handle'
      or not (select p.prosecdef from pg_proc p where p.oid = one::regprocedure)
      or not has_function_privilege('crm_app', one, 'EXECUTE')
      or has_function_privilege('crm_identity', one, 'EXECUTE')
      or has_function_privilege('public', one, 'EXECUTE') then
      raise exception '0135_link_page_switch: % is not crm_handle''s definer for crm_app alone', one;
    end if;
  end loop;
end
$$;
