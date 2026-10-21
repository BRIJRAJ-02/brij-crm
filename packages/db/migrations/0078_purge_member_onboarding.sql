-- The purge clears member_onboarding too. The app may only insert into it (0069), so the worker's own pass can't
-- delete its rows: crm_purge_workspace_begin removes them, beside the memberships, before the worker deletes members.
-- crm_purge gets delete, and select of workspace_id, on the table; the function is replaced as crm_purge, its owner,
-- so its owner, grants and settings stay as 0067 left them.
grant select (workspace_id), delete on member_onboarding to crm_purge;
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

-- Refuse to finish unless the function is still crm_purge's, and member_onboarding reaches crm_purge for the purge only.
do $$
begin
  if (select pg_get_userbyid(p.proowner) from pg_proc p
      where p.oid = 'public.crm_purge_workspace_begin(uuid)'::regprocedure) <> 'crm_purge'
    or has_table_privilege('crm_purge', 'public.member_onboarding', 'SELECT')
    or has_table_privilege('crm_purge', 'public.member_onboarding', 'INSERT')
    or has_table_privilege('crm_purge', 'public.member_onboarding', 'UPDATE')
    or not has_table_privilege('crm_purge', 'public.member_onboarding', 'DELETE') then
    raise exception 'the purge reaches member_onboarding through crm_purge_workspace_begin alone';
  end if;
end
$$;
