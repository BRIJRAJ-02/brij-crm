-- See the header of 0116: the definer belongs to crm_handle, so this changes it as that role.
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
-- 0116 took this away at its end; replacing the function needs it back for the length of this migration.
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- Every link page is live, and unlisted (the owner, 27 October 2026: "Make the link page live. and non indexable
-- by default"). Spec 0056 made a page per membership, and this morning's 0116 kept each one private until its owner
-- edited or shared it. That left a page nobody could open behind an address its owner was being told about, so the
-- default flips: a page made with a membership is live at once, and `indexable` stays false, so it is reachable by
-- its address and not listed by a search engine. Settings › Sharing still turns listing on.
--
-- `shown_at` stays: it still records when a page first went public, every reader still asks for it, and
-- `crm_show_public_profile` still sets it, so a page made before this migration and never shown goes live here.
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
  if (select pg_catalog.count(*) from auth.public_handles h where h.user_id = owner) >= 20 then
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
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
-- The pages 0116 left private, as the owner (auth is outside row level security): their people were told the
-- address, so they go live with the rest.
update auth.public_profiles set shown_at = pg_catalog.now() where shown_at is null;
--> statement-breakpoint
do $$
begin
  if pg_catalog.pg_get_userbyid((select p.proowner from pg_proc p
       where p.oid = 'public.crm_ensure_public_profile(uuid, uuid, text)'::regprocedure)) <> 'crm_handle'
    or not has_function_privilege('crm_app', 'public.crm_ensure_public_profile(uuid, uuid, text)', 'EXECUTE') then
    raise exception '0119_link_page_live: crm_ensure_public_profile is not crm_handle''s definer for crm_app';
  end if;
end
$$;
