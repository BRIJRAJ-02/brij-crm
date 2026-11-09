-- The business apps open to every workspace (spec 0065, 6 Nov 2026, the owner: "those business apps should be active
-- directly ... without going and manually active"). Menu, Menu QR, Table seating and Appointments are on with nothing
-- to activate; Events stays off until it is built. `workspace_apps` now stores only what differs from that: a row with
-- `removed_at` is an owner's or admin's switch-off and keeps it off through every release (`appsOn` in
-- `@crm/contracts`, the same rule).
--
-- What changes: the two public doors stop asking `workspaces.early_access` and read the rule above. The menu door
-- answers only while Menu isn't switched off, and the table door's `installed` says the same of Table seating. Both
-- still answer only for a place that exists, and a place exists only after someone fills in the business card.
--
-- What doesn't: no row is written, so no workspace gains a place, a key, a handle, a page or an email; a workspace that
-- had switched an app off keeps it off. `workspaces.early_access`, `crm_set_early_access`, and the two lookup roles'
-- read of that column stay for a later clean up (contract after expand): no running code reads them any more.
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
grant crm_menu_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_menu_lookup;
--> statement-breakpoint
set local role crm_menu_lookup;
--> statement-breakpoint
create or replace function crm_menu_by_key(key text)
  returns table (workspace_id uuid, place_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.workspace_id, p.id
  from public.places p
  join public.workspaces w on w.id = p.workspace_id
  where p.menu_key = crm_menu_by_key.key
    and w.deleted_at is null
    and not exists (
      select 1 from public.workspace_apps a
      where a.workspace_id = p.workspace_id and a.app = 'menu' and a.removed_at is not null
    )
  limit 1;
end;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_menu_lookup;
--> statement-breakpoint
revoke crm_menu_lookup from current_user;
--> statement-breakpoint
grant crm_table_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_table_lookup;
--> statement-breakpoint
set local role crm_table_lookup;
--> statement-breakpoint
create or replace function crm_table_place_by_key(key text)
  returns table (workspace_id uuid, place_id uuid, installed boolean)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.workspace_id, p.id, not exists (
      select 1 from public.workspace_apps a
      where a.workspace_id = p.workspace_id and a.app = 'table_seating' and a.removed_at is not null
    )
  from public.places p
  join public.workspaces w on w.id = p.workspace_id
  where p.public_key = crm_table_place_by_key.key
    and w.deleted_at is null
  limit 1;
end;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_table_lookup;
--> statement-breakpoint
revoke crm_table_lookup from current_user;
--> statement-breakpoint
-- Refuse to finish unless the doors stayed as narrow as they read: each its role's, a definer, executable by that
-- role and crm_app alone.
do $$
declare
  menu_door constant regprocedure := 'public.crm_menu_by_key(text)'::regprocedure;
  table_door constant regprocedure := 'public.crm_table_place_by_key(text)'::regprocedure;
begin
  if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = menu_door) <> 'crm_menu_lookup'
    or (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = table_door) <> 'crm_table_lookup'
    or not (select p.prosecdef from pg_proc p where p.oid = menu_door)
    or not (select p.prosecdef from pg_proc p where p.oid = table_door)
    or exists (
      select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid in (menu_door, table_door) and a.privilege_type = 'EXECUTE'
        and a.grantee not in ('crm_menu_lookup'::regrole, 'crm_table_lookup'::regrole, 'crm_app'::regrole)
    )
    or has_function_privilege('crm_identity', menu_door, 'EXECUTE')
    or has_function_privilege('crm_identity', table_door, 'EXECUTE') then
    raise exception '0195_business_apps_on: the two doors must stay narrow';
  end if;
end
$$;
