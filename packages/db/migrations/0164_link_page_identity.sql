-- Who the link page belongs to (3 Nov 2026, the owner's reference page): three choices of the page's owner.
--
-- What changes:
-- * `auth.public_profiles` gains `show_job_title` (false: a job title is the team's until its owner shows it on
--   their link page and booking pages), `site_url` (an https address the workspace's logo and name at the top of the
--   page link to; null draws no lockup) and `foot_line` (one line of their own, drawn above "Powered by Timefix" and
--   never in its place). Every default draws exactly what a page drew before.
-- * Two definers, both crm_handle's, executable by crm_app alone: `crm_profile_identity` reads the three for an
--   active member's own page in the transaction's own workspace, and `crm_save_profile_identity` writes them, whole.
--   Each refuses a person who isn't an active member of that workspace, as the look's do (0155).
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
alter table auth.public_profiles
  add column show_job_title boolean default false not null,
  add column site_url text,
  add column foot_line text;
--> statement-breakpoint
-- An https address with a host, at most 200 characters, no spaces or control characters; the server checks it the
-- same way first (`checkProfileSite`), so this only ever refuses a write that skipped it.
alter table auth.public_profiles add constraint public_profiles_site check (
  site_url is null
  or (char_length(site_url) between 12 and 200 and site_url ~ '^https://[^/?#@[:space:][:cntrl:]]+[.][^/?#@[:space:][:cntrl:]]+([/?#][^[:space:][:cntrl:]]*)?$')
);
--> statement-breakpoint
alter table auth.public_profiles add constraint public_profiles_foot_line check (
  foot_line is null
  or (char_length(foot_line) between 1 and 80 and foot_line !~ '[[:cntrl:]]' and foot_line = btrim(foot_line))
);
--> statement-breakpoint
-- Written only by the definer below.
grant update (show_job_title, site_url, foot_line) on auth.public_profiles to crm_handle;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
-- One membership's three choices: for its owner's editor, its public link page and its personal booking pages. No
-- row unless that person is an active member of that workspace, and none outside the transaction's own workspace.
create function crm_profile_identity(owner uuid, workspace uuid)
  returns table (show_job_title boolean, site_url text, foot_line text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.show_job_title, p.site_url, p.foot_line
  from auth.public_profiles p
  where p.user_id = crm_profile_identity.owner
    and p.workspace_id = crm_profile_identity.workspace
    and p.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    and public.crm_workspace_member(p.user_id, p.workspace_id);
end;
--> statement-breakpoint
-- Sets `owner`'s three choices in `workspace`, whole (null clears the address or the line). Refused (42501) unless
-- `workspace` is the transaction's own and they are an active member there; P0002 when they have no page there.
-- The column checks refuse a malformed address or line (23514).
create function crm_save_profile_identity(owner uuid, workspace uuid, wanted_show boolean, wanted_site text,
  wanted_foot text)
  returns void
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
  update auth.public_profiles p
  set show_job_title = coalesce(wanted_show, false), site_url = wanted_site, foot_line = wanted_foot,
    updated_at = pg_catalog.now()
  where p.user_id = owner and p.workspace_id = workspace;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_MISSING';
  end if;
end;
$$;
--> statement-breakpoint
revoke all on function crm_profile_identity(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function crm_save_profile_identity(uuid, uuid, boolean, text, text) from public;
--> statement-breakpoint
grant execute on function crm_profile_identity(uuid, uuid) to crm_app;
--> statement-breakpoint
grant execute on function crm_save_profile_identity(uuid, uuid, boolean, text, text) to crm_app;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
-- Refuse to finish unless both functions are as narrow as they read, and the app still writes no column itself.
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.crm_profile_identity(uuid, uuid)'::regprocedure,
    'public.crm_save_profile_identity(uuid, uuid, boolean, text, text)'::regprocedure
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
  if has_table_privilege('crm_app', 'auth.public_profiles', 'UPDATE')
    or has_column_privilege('crm_app', 'auth.public_profiles', 'site_url', 'UPDATE')
    or has_column_privilege('crm_app', 'auth.public_profiles', 'foot_line', 'UPDATE')
    or has_column_privilege('crm_app', 'auth.public_profiles', 'show_job_title', 'UPDATE') then
    raise exception 'crm_app must not write auth.public_profiles directly';
  end if;
end
$$;
