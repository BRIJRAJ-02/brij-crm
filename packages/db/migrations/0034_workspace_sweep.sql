-- The daily cleanup (spec 0008, milestone 3, AC-112, AC-115). First drizzle-kit's three partial indexes, so each
-- cleanup batch reads in order what it removes instead of scanning: records and list entries in the trash by
-- (workspace, deleted_at, id) for the purge's oldest-first pick, and unfinished jobs by id for the expiry and requeue
-- phases. Then, hand written, the workspace listing: crm_workspace_ids(after, max) names the workspaces that aren't
-- deleted, in id order, so the worker's daily cleanup starts one maintenance job in each. Listing every workspace
-- reaches across all of them, so it is the worker's alone (crm_worker), never the app's: the function is owned by
-- crm_sweep, a role that can't log in, reads two columns of one table and nothing else, and bypasses row level
-- security only for that read.
--
-- The indexes take a share lock on records, list_entries and jobs while they build (a migration runs in a
-- transaction, so not concurrently): small tables today. Give up after 5 seconds rather than queue behind traffic,
-- like 0020 and 0031. Any change to the role or the function goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE INDEX "jobs_unfinished" ON "jobs" USING btree ("workspace_id","id") WHERE "jobs"."finished_at" is null;--> statement-breakpoint
CREATE INDEX "list_entries_trashed_at" ON "list_entries" USING btree ("workspace_id","deleted_at","id") WHERE "list_entries"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "records_trashed_at" ON "records" USING btree ("workspace_id","deleted_at","id") WHERE "records"."deleted_at" is not null;
--> statement-breakpoint
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_sweep') then
    create role crm_sweep nologin nosuperuser bypassrls nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$$;
--> statement-breakpoint
-- Roles are shared by the whole cluster: one made earlier gets exactly these attributes (the ones only a superuser
-- may change are checked at the end).
alter role crm_sweep nologin bypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant usage on schema public to crm_sweep;
--> statement-breakpoint
grant select (id, deleted_at) on workspaces to crm_sweep;
--> statement-breakpoint

-- The ids of workspaces that aren't deleted, after `after` (from the start when null), in id order, at most `max`
-- (clamped to 1 to 500). Ids only: no name, no address, no row of tenant data. Fewer than `max` means the walk is
-- done. It reads the primary key in order, so a page costs one index range scan however many workspaces there are.
--
-- Hardened as crm_search_text in 0012: a standard SQL body (begin atomic), parsed once, here, and bound to its table
-- by OID, so no session setting can change what it reads; a fixed search_path; every name qualified, and the
-- parameters by the function's name, so no column can shadow them.
create function crm_workspace_ids(after uuid, max integer)
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 500
begin atomic
  select w.id
  from public.workspaces w
  where w.deleted_at is null
    and w.id > coalesce(crm_workspace_ids.after, '00000000-0000-0000-0000-000000000000'::uuid)
  order by w.id
  limit least(greatest(crm_workspace_ids.max, 1), 500);
end;
--> statement-breakpoint
revoke all on function crm_workspace_ids(uuid, integer) from public;
--> statement-breakpoint
grant execute on function crm_workspace_ids(uuid, integer) to crm_worker;
--> statement-breakpoint

-- Hand the function to crm_sweep. Postgres 16 and later don't give the creator SET on a role it creates, and a new
-- owner needs CREATE on the schema, so both are granted for the change, then taken back.
grant crm_sweep to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_sweep;
--> statement-breakpoint
alter function crm_workspace_ids(uuid, integer) owner to crm_sweep;
--> statement-breakpoint
revoke create on schema public from crm_sweep;
--> statement-breakpoint
revoke crm_sweep from current_user;
--> statement-breakpoint

-- Refuse to finish unless the listing is the worker's alone and crm_sweep is as narrow as it reads: the function
-- owned by crm_sweep, executable by crm_sweep and crm_worker and nobody else by a grant of its own (PUBLIC included),
-- out of the app's and the identity login's reach by any route; crm_sweep a plain role (no login, no power but
-- bypassing row level security) that nothing but the database owner can reach (Neon's platform roles skipped by
-- name, as in 0020), in no role itself, and holding no table privilege but reading workspaces' id and deleted_at.
do $$
declare
  listing constant regprocedure := 'public.crm_workspace_ids(uuid, integer)'::regprocedure;
begin
  if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = listing) <> 'crm_sweep'
    or exists (
      select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid = listing and a.privilege_type = 'EXECUTE'
        and a.grantee not in ('crm_sweep'::regrole, 'crm_worker'::regrole)
    )
    or exists (
      select 1 from pg_proc p where p.proname = 'crm_workspace_ids' and p.oid <> listing
    )
    or has_function_privilege('crm_app', listing, 'EXECUTE')
    or has_function_privilege('crm_identity', listing, 'EXECUTE')
    -- has_function_privilege follows INHERIT only: a login could still SET ROLE crm_worker and call it.
    or pg_has_role('crm_app', 'crm_worker', 'MEMBER')
    or pg_has_role('crm_identity', 'crm_worker', 'MEMBER')
    or not has_function_privilege('crm_worker', listing, 'EXECUTE') then
    raise exception 'crm_workspace_ids must be owned by crm_sweep and executable by crm_worker alone';
  end if;
  if exists (
    select 1 from pg_auth_members m
    where m.roleid = 'crm_sweep'::regrole
      and m.member <> (select datdba from pg_database where datname = current_database())
      and pg_get_userbyid(m.member) not in ('neon_service', 'cloud_admin')
  ) or exists (
    select 1 from pg_auth_members m
    where m.roleid = 'crm_sweep'::regrole and (m.set_option or m.inherit_option)
      and pg_get_userbyid(m.member) not in ('neon_service', 'cloud_admin')
  ) or exists (
    select 1 from pg_auth_members m where m.member = 'crm_sweep'::regrole
  ) or pg_has_role('crm_app', 'crm_sweep', 'MEMBER')
    or pg_has_role('crm_worker', 'crm_sweep', 'MEMBER')
    or pg_has_role('crm_identity', 'crm_sweep', 'MEMBER')
    or exists (
      select 1 from pg_roles
      where rolname = 'crm_sweep' and (rolsuper or rolreplication or rolcreatedb or rolcreaterole or rolcanlogin
        or not rolbypassrls)
    ) then
    raise exception 'crm_sweep must be a plain role with no member but the database owner, with ADMIN only';
  end if;
  -- From the catalog, every table privilege by any route (a column grant shows as no table privilege), and every
  -- column grant: select on workspaces' id and deleted_at, and nothing else.
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(privilege)
    where c.relkind in ('r', 'p', 'v', 'm', 'f')
      and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_toast%'
      and has_table_privilege('crm_sweep', c.oid, p.privilege)
  ) or exists (
    select 1
    from pg_attribute att
    cross join lateral aclexplode(att.attacl) a
    where a.grantee = 'crm_sweep'::regrole
      and not (att.attrelid = 'public.workspaces'::regclass and att.attname in ('id', 'deleted_at')
        and a.privilege_type = 'SELECT')
  ) or not has_column_privilege('crm_sweep', 'public.workspaces', 'id', 'SELECT')
    or not has_column_privilege('crm_sweep', 'public.workspaces', 'deleted_at', 'SELECT') then
    raise exception 'crm_sweep may only read workspaces.id and workspaces.deleted_at';
  end if;
end
$$;
