-- Team link pages (spec 0070, slice 1, AC-7001): each member's link page views in one workspace, read in one
-- statement for the Team pages list, rather than one `crm_profile_counts` call per member.
--
-- Numbered 0191, straight after main's 0190: this lands first. The unlanded branches for apps-open and properties-1,
-- which had claimed 0191 and 0192, renumber after it. Nothing here depends on either.
--
-- `crm_team_profile_views(owners, workspace, from_day, to_day)` answers, for each of `owners` who is an active member
-- of `workspace`, the views their page in `workspace` had between the two days (UTC, at most 400 days apart). It reads
-- nothing when `workspace` isn't the transaction's own (`app.workspace_id`), so code in one workspace can never count
-- another's. Counts only: no visitor, no item, no page content. Who may ask is the app's check
-- (`link_pages.manage_team`, `listTeamLinkPages`); the definer keeps the workspace.
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
create function crm_team_profile_views(owners uuid[], workspace uuid, from_day date, to_day date)
  returns table (user_id uuid, views bigint)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select v.user_id, coalesce(sum(v.views), 0)
  from auth.profile_view_days v
  where v.user_id = any (crm_team_profile_views.owners)
    and pg_catalog.cardinality(crm_team_profile_views.owners) <= 1000
    and v.workspace_id = crm_team_profile_views.workspace
    and crm_team_profile_views.workspace
      = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
    and v.day between crm_team_profile_views.from_day and crm_team_profile_views.to_day
    and crm_team_profile_views.to_day - crm_team_profile_views.from_day between 0 and 400
    and public.crm_workspace_member(v.user_id, crm_team_profile_views.workspace)
  group by v.user_id;
end;
--> statement-breakpoint
revoke all on function crm_team_profile_views(uuid[], uuid, date, date) from public;
--> statement-breakpoint
grant execute on function crm_team_profile_views(uuid[], uuid, date, date) to crm_app;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
do $$
declare
  one text := 'public.crm_team_profile_views(uuid[], uuid, date, date)';
begin
  if pg_catalog.pg_get_userbyid((select p.proowner from pg_proc p where p.oid = one::regprocedure)) <> 'crm_handle'
    or not (select p.prosecdef from pg_proc p where p.oid = one::regprocedure)
    or not has_function_privilege('crm_app', one, 'EXECUTE')
    or has_function_privilege('crm_identity', one, 'EXECUTE')
    or has_function_privilege('public', one, 'EXECUTE') then
    raise exception '0191_team_link_pages: % is not crm_handle''s definer for crm_app alone', one;
  end if;
end
$$;
