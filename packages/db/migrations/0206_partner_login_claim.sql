-- A partner's person claims their own Timefix login (spec 0070, AC-7023; owner, 10 Nov 2026: "as per industry
-- standard and in favour of Timefix").
--
-- Their managed identity becomes a login at a verified address in place, as a page only person's does on a hand over
-- (0203), so it is the same member, page, handle and history; no identity is ever merged (AC-7021). Unlike a hand over,
-- the partner keeps managing them: their `managed_members` row and their `auth.managed_users` row both stay, so the
-- partner's PUT, DELETE, list and launch still find the same person, and each is marked claimed instead. The claim is
-- only ever started in Timefix, by a member holding both Team pages' and Members' invite permissions (coordinator, 10
-- Nov 2026: never from inside the partner's frame, so a partner can't mint logins at addresses it controls).
--
-- - `managed_members.claimed_at`: when the person took their login. Only a partner's person is ever claimed (a page
--   only person's row goes on a hand over). The app reads it: a claimed person gets Timefix's email like any member,
--   the partner no longer changes their address (it is their login's), a partner's DELETE ends only the partner's hold
--   on them (they stay a member), and the 30 day purge never touches them.
-- - `auth.managed_users.claimed_at`: the identity login's mark of the same. A claimed identity is a login: the session
--   hook lets it sign in, and the console counts it as signed up. The row stays, so the partner's next PUT keyed by its
--   external id finds the same identity, never a new one.
-- - `crm_purge_managed_page` (0203) made again, the same but for one more refusal: a person whose `managed_members`
--   row here is claimed is a login's page, never purged as a managed one, whatever the caller asked (defence in depth
--   beside the daily cleanup's own selection). crm_handle gets select on `managed_members.claimed_at` for it, nothing
--   more; 0203's closing check is run again, with that column.
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "managed_members" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "managed_members" ADD CONSTRAINT "managed_members_claimed" CHECK ("claimed_at" IS NULL OR "partner_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "auth"."managed_users" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."managed_users" ADD CONSTRAINT "managed_users_claimed" CHECK ("claimed_at" IS NULL OR "partner_id" IS NOT NULL);
--> statement-breakpoint
grant select (claimed_at) on public.managed_members to crm_handle;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set role crm_handle;
--> statement-breakpoint
create or replace function crm_purge_managed_page(person uuid)
  returns table (path text)
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  workspace uuid := nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid;
begin
  if workspace is null or person is null then
    return;
  end if;
  -- Only an identity a partner or Team pages made for this workspace, removed from it more than 30 days ago, and no
  -- member here in any other way (a guest, made a member again, a workspace in its restore window); and never one who
  -- claimed their own login here (0206): that page is a login's.
  if not exists (
    select 1 from auth.managed_users mu where mu.user_id = person and mu.workspace_id = workspace
  ) or not exists (
    select 1 from public.managed_members mm
    where mm.workspace_id = workspace and mm.user_id = person
      and mm.removed_at < pg_catalog.now() - interval '30 days'
  ) or exists (
    select 1 from public.managed_members mm
    where mm.workspace_id = workspace and mm.user_id = person and mm.claimed_at is not null
  ) or exists (
    select 1 from public.members m where m.workspace_id = workspace and m.user_id = person and m.status <> 'removed'
  ) or public.crm_workspace_member(person, workspace) then
    return;
  end if;
  -- It passed: one row with no path says so, then the files its rows name, read before the rows go, for the caller to
  -- remove from the store before it commits.
  return query select null::text;
  return query
    select m.path from auth.profile_images m where m.user_id = person and m.workspace_id = workspace
    union
    select f.path from auth.public_profiles p
      cross join lateral (values (p.avatar_path), (p.cover_path), (p.ground_path)) as f(path)
    where p.user_id = person and p.workspace_id = workspace and f.path is not null;
  delete from auth.profile_items i where i.user_id = person and i.workspace_id = workspace;
  delete from auth.profile_views v where v.user_id = person and v.workspace_id = workspace;
  delete from auth.profile_view_days d where d.user_id = person and d.workspace_id = workspace;
  delete from auth.public_profiles p where p.user_id = person and p.workspace_id = workspace;
  delete from auth.social_links s where s.user_id = person;
  -- Held 90 days, then free (0122): never handed to the next person with the same name at once.
  update auth.public_handles h set user_id = null
  where h.user_id = person and h.workspace_id = workspace;
end;
$$;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
do $$
begin
  if exists (
    select 1 from pg_proc p
    where p.oid = 'public.crm_purge_managed_page(uuid)'::regprocedure
      and (pg_catalog.pg_get_userbyid(p.proowner) <> 'crm_handle' or not p.prosecdef
        or not ('search_path=pg_catalog, pg_temp' = any (coalesce(p.proconfig, array[]::text[]))))
  )
    or exists (
      select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid = 'public.crm_purge_managed_page(uuid)'::regprocedure
        and a.grantee not in ('crm_handle'::regrole, 'crm_app'::regrole)
    )
    or has_table_privilege('crm_handle', 'auth.managed_users', 'INSERT')
    or has_table_privilege('crm_handle', 'auth.managed_users', 'UPDATE')
    or has_table_privilege('crm_handle', 'auth.managed_users', 'DELETE')
    or has_column_privilege('crm_handle', 'auth.managed_users', 'partner_id', 'SELECT')
    or has_column_privilege('crm_handle', 'auth.managed_users', 'external_id', 'SELECT')
    or has_column_privilege('crm_handle', 'auth.managed_users', 'claimed_at', 'SELECT')
    or has_table_privilege('crm_handle', 'public.managed_members', 'INSERT')
    or has_table_privilege('crm_handle', 'public.managed_members', 'UPDATE')
    or has_table_privilege('crm_handle', 'public.managed_members', 'DELETE')
    or has_column_privilege('crm_handle', 'public.managed_members', 'partner_id', 'SELECT')
    or not has_column_privilege('crm_handle', 'public.managed_members', 'claimed_at', 'SELECT')
    or has_table_privilege('crm_handle', 'public.members', 'INSERT')
    or has_table_privilege('crm_handle', 'public.members', 'UPDATE')
    or has_table_privilege('crm_handle', 'public.members', 'DELETE')
    or has_table_privilege('crm_app', 'auth.public_profiles', 'DELETE') then
    raise exception 'the managed page purge must be crm_handle''s definer, reaching only what it needs';
  end if;
end
$$;
