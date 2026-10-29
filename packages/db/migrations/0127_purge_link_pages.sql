-- A purged workspace's link pages go with it (late trap #86, 29 Oct 2026). Since 0114 each membership's link page
-- (`auth.public_profiles`, its blocks in `auth.profile_items`, its counts in `auth.profile_views` and
-- `auth.profile_view_days`) and its handles (`auth.public_handles`) carry the workspace's id, with no foreign key to
-- it, and the purge touched none of them. So a purged workspace's pages stayed stored for good (third parties'
-- testimonials and contact details among them), and its handles stayed bound to a workspace that no longer exists:
-- counted against their person's 20, and refused to them and everyone else in any other workspace, for ever.
--
-- crm_purge_workspace_begin now removes the pages, blocks and counts, and releases the handles: the person cleared,
-- so 0126's trigger stamps `released_at` and its daily sweep frees them 90 days on. Each statement keeps the begin's
-- guard (deleted and an hour past `purge_after`). crm_purge gets delete and select of the columns it reads on those
-- tables, and update of `user_id` alone on the handles. Replaced as crm_purge, its owner, so its grants and settings
-- stay as 0067 left them. Postgres 17 compatible. Any change to the role or the function goes through
-- security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
grant select (workspace_id), delete on auth.profile_items, auth.profile_views, auth.profile_view_days,
  auth.public_profiles to crm_purge;
--> statement-breakpoint
grant select (workspace_id, user_id), update (user_id) on auth.public_handles to crm_purge;
--> statement-breakpoint
grant crm_purge to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_purge;
--> statement-breakpoint
set role crm_purge;
--> statement-breakpoint
create or replace function crm_purge_workspace_begin(workspace_id uuid)
  returns boolean
  language sql
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  delete from public.audit_events a
  where a.workspace_id = crm_purge_workspace_begin.workspace_id
    and exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
      and w.deleted_at is not null and w.purge_after <= pg_catalog.now() - interval '1 hour');
  delete from public.outbox o
  where o.workspace_id = crm_purge_workspace_begin.workspace_id
    and exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
      and w.deleted_at is not null and w.purge_after <= pg_catalog.now() - interval '1 hour');
  delete from public.workspace_milestones m
  where m.workspace_id = crm_purge_workspace_begin.workspace_id
    and exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
      and w.deleted_at is not null and w.purge_after <= pg_catalog.now() - interval '1 hour');
  delete from public.member_onboarding o
  where o.workspace_id = crm_purge_workspace_begin.workspace_id
    and exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
      and w.deleted_at is not null and w.purge_after <= pg_catalog.now() - interval '1 hour');
  delete from auth.workspace_membership m
  where m.workspace_id = crm_purge_workspace_begin.workspace_id
    and exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
      and w.deleted_at is not null and w.purge_after <= pg_catalog.now() - interval '1 hour');
  update auth.user_prefs p set last_workspace_id = null
  where p.last_workspace_id = crm_purge_workspace_begin.workspace_id
    and exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
      and w.deleted_at is not null and w.purge_after <= pg_catalog.now() - interval '1 hour');
  -- Its members' link pages here (late trap #86): the page, its blocks (their presses go with them) and its counts.
  delete from auth.profile_items i
  where i.workspace_id = crm_purge_workspace_begin.workspace_id
    and exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
      and w.deleted_at is not null and w.purge_after <= pg_catalog.now() - interval '1 hour');
  delete from auth.profile_views v
  where v.workspace_id = crm_purge_workspace_begin.workspace_id
    and exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
      and w.deleted_at is not null and w.purge_after <= pg_catalog.now() - interval '1 hour');
  delete from auth.profile_view_days d
  where d.workspace_id = crm_purge_workspace_begin.workspace_id
    and exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
      and w.deleted_at is not null and w.purge_after <= pg_catalog.now() - interval '1 hour');
  delete from auth.public_profiles p
  where p.workspace_id = crm_purge_workspace_begin.workspace_id
    and exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
      and w.deleted_at is not null and w.purge_after <= pg_catalog.now() - interval '1 hour');
  -- Their handles here name nobody from now: held 90 days, then free, as a deleted account's are (0126).
  update auth.public_handles h set user_id = null
  where h.workspace_id = crm_purge_workspace_begin.workspace_id and h.user_id is not null
    and exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
      and w.deleted_at is not null and w.purge_after <= pg_catalog.now() - interval '1 hour');
  select exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
    and w.deleted_at is not null and w.purge_after <= pg_catalog.now() - interval '1 hour');
end;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_purge;
--> statement-breakpoint
revoke crm_purge from current_user;
--> statement-breakpoint
do $$
begin
  if (select pg_get_userbyid(p.proowner) from pg_proc p
      where p.oid = 'public.crm_purge_workspace_begin(uuid)'::regprocedure) <> 'crm_purge'
    or has_table_privilege('crm_purge', 'auth.public_handles', 'DELETE')
    or has_table_privilege('crm_purge', 'auth.public_handles', 'INSERT')
    or has_column_privilege('crm_purge', 'auth.public_handles', 'handle', 'UPDATE')
    or has_column_privilege('crm_purge', 'auth.public_handles', 'workspace_id', 'UPDATE')
    or has_column_privilege('crm_purge', 'auth.public_handles', 'released_at', 'UPDATE')
    or not has_column_privilege('crm_purge', 'auth.public_handles', 'user_id', 'UPDATE')
    or exists (
      select 1 from unnest(array['auth.profile_items', 'auth.profile_views', 'auth.profile_view_days',
        'auth.public_profiles']) as t(name)
      where not has_table_privilege('crm_purge', t.name, 'DELETE')
        or has_table_privilege('crm_purge', t.name, 'INSERT')
        or has_table_privilege('crm_purge', t.name, 'UPDATE')
    ) then
    raise exception 'the purge releases a workspace''s handles through crm_purge_workspace_begin alone';
  end if;
end
$$;
