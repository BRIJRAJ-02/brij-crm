-- Letting search engines show a link page (spec 0055, AC-5506). One column, `indexable`, true for everybody who
-- already has a page, because that is what the shell says today. The shell function reads it with the profile it
-- already reads, so a page costs no extra statement for it, and the editor's switch writes it through one definer
-- owned by crm_handle, crm_save_profile_indexable. Any change to these roles or functions goes through
-- security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "auth"."public_profiles" ADD COLUMN "indexable" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
grant update (indexable) on auth.public_profiles to crm_handle;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- Writes one person's choice and answers what was kept. A person with no profile row has no handle either, so
-- there is no page for a search engine to show and nothing is written.
create function crm_save_profile_indexable(owner uuid, wanted boolean)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  kept boolean;
begin
  update auth.public_profiles p
  set indexable = crm_save_profile_indexable.wanted, updated_at = pg_catalog.now()
  where p.user_id = crm_save_profile_indexable.owner
  returning p.indexable into kept;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
  return kept;
end;
$$;
--> statement-breakpoint
-- Both readers gain the column. Dropped and made again rather than replaced: `create or replace` cannot change a
-- `returns table` row type, which is why 0104 and 0105 do the same. The grants go with the old function.
drop function crm_public_profiles_of(uuid[]);
--> statement-breakpoint
create function crm_public_profiles_of(owners uuid[])
  returns table (user_id uuid, handle text, bio text, theme jsonb, indexable boolean)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.user_id, p.handle, p.bio, p.theme, p.indexable
  from auth.public_profiles p
  where p.user_id = any (crm_public_profiles_of.owners);
end;
--> statement-breakpoint
revoke all on function crm_public_profiles_of(uuid[]) from public;
--> statement-breakpoint
grant execute on function crm_public_profiles_of(uuid[]) to crm_app;
--> statement-breakpoint
drop function crm_handle_owner(text);
--> statement-breakpoint
create function crm_handle_owner(wanted text)
  returns table (user_id uuid, handle text, bio text, name text, image text, theme jsonb, indexable boolean)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.user_id, p.handle, p.bio, u.name,
    case when coalesce(k.picture_hidden, false) then null else u.image end,
    p.theme, p.indexable
  from auth.public_handles h
  join auth.public_profiles p on p.user_id = h.user_id
  join auth."user" u on u.id = h.user_id
  left join auth.user_prefs k on k.user_id = h.user_id
  where h.handle = crm_handle_owner.wanted
  limit 1;
end;
--> statement-breakpoint
revoke all on function crm_handle_owner(text) from public;
--> statement-breakpoint
grant execute on function crm_handle_owner(text) to crm_app;
--> statement-breakpoint
revoke all on function crm_save_profile_indexable(uuid, boolean) from public;
--> statement-breakpoint
grant execute on function crm_save_profile_indexable(uuid, boolean) to crm_app;
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
      where p.oid = 'public.crm_save_profile_indexable(uuid, boolean)'::regprocedure)) <> 'crm_handle'
    or not (select p.prosecdef from pg_proc p
      where p.oid = 'public.crm_save_profile_indexable(uuid, boolean)'::regprocedure)
    or not has_function_privilege('crm_app', 'public.crm_save_profile_indexable(uuid, boolean)', 'EXECUTE')
    or has_function_privilege('crm_identity', 'public.crm_save_profile_indexable(uuid, boolean)', 'EXECUTE') then
    raise exception 'crm_save_profile_indexable must be crm_handle''s own definer, executable by crm_app alone';
  end if;
  -- The app reaches the column only through that definer: never the table itself.
  if has_table_privilege('crm_app', 'auth.public_profiles', 'UPDATE')
    or has_column_privilege('crm_app', 'auth.public_profiles', 'indexable', 'UPDATE') then
    raise exception 'crm_app must not write auth.public_profiles directly';
  end if;
end
$$;
