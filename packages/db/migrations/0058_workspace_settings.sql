-- Workspace settings and delete (spec 0031, slice 7, AC-822, AC-823): a logo (initials until #32), a default time
-- zone, and `purge_after`, set with `deleted_at` when an owner deletes the workspace and cleared with it on restore.
-- The directory gains `deleted_at` too, so "my workspaces" leaves a deleted one out; the identity login writes it
-- once the tenant change commits (crm_app may only insert into the directory, migration 0016).
--
-- Then the purge, hand written: crm_purge, a role that can't log in, owns the three functions the worker's daily
-- cleanup calls for a workspace past its window. crm_workspaces_to_purge names them (ids only); the worker deletes
-- every tenant table's rows itself inside withWorkspace, children first; crm_purge_workspace_begin removes first
-- what the worker can't and what points at its members (the audit rows, the outbox, the milestones, the
-- directory's memberships and last workspace pointers), and crm_purge_workspace_end the directory row and the
-- workspace last. Each acts only on a workspace deleted and past purge_after, so no call can reach a live one.
-- Any change to the role or the functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "time_zone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "purge_after" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "auth"."workspace_directory" ADD COLUMN "deleted_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_purge_after" CHECK ("workspaces"."purge_after" is null or "workspaces"."deleted_at" is not null);--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_time_zone" CHECK (char_length("workspaces"."time_zone") between 1 and 64);
--> statement-breakpoint
-- A workspace deleted before this column existed gets its window from when it was deleted. Row security off: the
-- owner bypasses it, and a role it would filter fails here rather than backfilling nothing.
set local row_security = off;
--> statement-breakpoint
update workspaces set purge_after = deleted_at + interval '30 days' where deleted_at is not null and purge_after is null;
--> statement-breakpoint
update auth.workspace_directory d set deleted_at = w.deleted_at
from workspaces w where w.id = d.workspace_id and w.deleted_at is not null and d.deleted_at is null;
--> statement-breakpoint
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_purge') then
    create role crm_purge nologin nosuperuser bypassrls nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$$;
--> statement-breakpoint
alter role crm_purge nologin bypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant usage on schema public, auth to crm_purge;
--> statement-breakpoint
grant select (id, deleted_at, purge_after) on workspaces to crm_purge;
--> statement-breakpoint
grant delete on workspaces, audit_events, outbox, workspace_milestones to crm_purge;
--> statement-breakpoint
grant select (workspace_id) on audit_events, outbox, workspace_milestones to crm_purge;
--> statement-breakpoint
grant delete on auth.workspace_membership, auth.workspace_directory to crm_purge;
--> statement-breakpoint
grant select (workspace_id) on auth.workspace_membership, auth.workspace_directory to crm_purge;
--> statement-breakpoint
grant select (last_workspace_id), update (last_workspace_id) on auth.user_prefs to crm_purge;
--> statement-breakpoint

-- The workspaces past their window, oldest first, ids only, at most `max` (clamped to 1 to 50).
create function crm_workspaces_to_purge(max integer)
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 50
begin atomic
  select w.id
  from public.workspaces w
  where w.deleted_at is not null and w.purge_after <= pg_catalog.now()
  order by w.purge_after, w.id
  limit least(greatest(crm_workspaces_to_purge.max, 1), 50);
end;
--> statement-breakpoint
-- Before the worker's deletes: what it can't remove, and what points at the rows it will. True when the workspace
-- is past its window (and so was cleared), false for any other id, which it leaves alone.
create function crm_purge_workspace_begin(workspace_id uuid)
  returns boolean
  language sql
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  delete from public.audit_events a
  where a.workspace_id = crm_purge_workspace_begin.workspace_id
    and exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
      and w.deleted_at is not null and w.purge_after <= pg_catalog.now());
  delete from public.outbox o
  where o.workspace_id = crm_purge_workspace_begin.workspace_id
    and exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
      and w.deleted_at is not null and w.purge_after <= pg_catalog.now());
  delete from public.workspace_milestones m
  where m.workspace_id = crm_purge_workspace_begin.workspace_id
    and exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
      and w.deleted_at is not null and w.purge_after <= pg_catalog.now());
  delete from auth.workspace_membership m
  where m.workspace_id = crm_purge_workspace_begin.workspace_id
    and exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
      and w.deleted_at is not null and w.purge_after <= pg_catalog.now());
  update auth.user_prefs p set last_workspace_id = null
  where p.last_workspace_id = crm_purge_workspace_begin.workspace_id
    and exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
      and w.deleted_at is not null and w.purge_after <= pg_catalog.now());
  select exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_begin.workspace_id
    and w.deleted_at is not null and w.purge_after <= pg_catalog.now());
end;
--> statement-breakpoint
-- After the worker's deletes: the directory row and the workspace. A tenant row left behind fails its foreign key
-- here, loudly. True once the workspace is gone.
create function crm_purge_workspace_end(workspace_id uuid)
  returns boolean
  language sql
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  delete from auth.workspace_directory d
  where d.workspace_id = crm_purge_workspace_end.workspace_id
    and exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_end.workspace_id
      and w.deleted_at is not null and w.purge_after <= pg_catalog.now());
  delete from public.workspaces w
  where w.id = crm_purge_workspace_end.workspace_id
    and w.deleted_at is not null and w.purge_after <= pg_catalog.now();
  select not exists (select 1 from public.workspaces w where w.id = crm_purge_workspace_end.workspace_id);
end;
--> statement-breakpoint
revoke all on function crm_workspaces_to_purge(integer) from public;
--> statement-breakpoint
revoke all on function crm_purge_workspace_begin(uuid) from public;
--> statement-breakpoint
revoke all on function crm_purge_workspace_end(uuid) from public;
--> statement-breakpoint
grant execute on function crm_workspaces_to_purge(integer) to crm_worker;
--> statement-breakpoint
grant execute on function crm_purge_workspace_begin(uuid) to crm_worker;
--> statement-breakpoint
grant execute on function crm_purge_workspace_end(uuid) to crm_worker;
--> statement-breakpoint
grant crm_purge to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_purge;
--> statement-breakpoint
alter function crm_workspaces_to_purge(integer) owner to crm_purge;
--> statement-breakpoint
alter function crm_purge_workspace_begin(uuid) owner to crm_purge;
--> statement-breakpoint
alter function crm_purge_workspace_end(uuid) owner to crm_purge;
--> statement-breakpoint
revoke create on schema public from crm_purge;
--> statement-breakpoint
revoke crm_purge from current_user;
--> statement-breakpoint

-- The audit log stays append only (AC-830), with one way past it: a purge function, run as crm_purge, removing a
-- purged workspace's rows. Nobody can become crm_purge, so no session can borrow it.
create or replace function crm_audit_events_append_only()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'DELETE' and current_user = 'crm_purge' then
    return old;
  end if;
  raise exception using errcode = 'CRM02', message = 'AUDIT_APPEND_ONLY',
    detail = 'audit_events rows are never changed or removed.';
end;
$$;
--> statement-breakpoint

-- Refuse to finish unless the purge is as narrow as it reads: its functions owned by crm_purge and executable by
-- crm_worker alone, out of the app's and the identity login's reach; crm_purge a plain role in no role.
do $$
declare
  fns constant regprocedure[] := array[
    'public.crm_workspaces_to_purge(integer)'::regprocedure,
    'public.crm_purge_workspace_begin(uuid)'::regprocedure,
    'public.crm_purge_workspace_end(uuid)'::regprocedure
  ];
begin
  if exists (select 1 from pg_proc p where p.oid = any(fns) and pg_get_userbyid(p.proowner) <> 'crm_purge')
    or exists (
      select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid = any(fns) and a.privilege_type = 'EXECUTE'
        and a.grantee not in ('crm_purge'::regrole, 'crm_worker'::regrole)
    )
    or exists (select 1 from unnest(fns) f where has_function_privilege('crm_app', f, 'EXECUTE')
      or has_function_privilege('crm_identity', f, 'EXECUTE'))
    or pg_has_role('crm_app', 'crm_worker', 'MEMBER')
    or pg_has_role('crm_identity', 'crm_worker', 'MEMBER') then
    raise exception 'the purge functions must be owned by crm_purge and executable by crm_worker alone';
  end if;
  if exists (select 1 from pg_auth_members m where m.member = 'crm_purge'::regrole)
    or exists (
      select 1 from pg_auth_members m
      where m.roleid = 'crm_purge'::regrole and (m.set_option or m.inherit_option)
        and pg_get_userbyid(m.member) not in ('neon_service', 'cloud_admin')
    )
    or pg_has_role('crm_app', 'crm_purge', 'MEMBER')
    or pg_has_role('crm_worker', 'crm_purge', 'MEMBER')
    or pg_has_role('crm_identity', 'crm_purge', 'MEMBER')
    or exists (
      select 1 from pg_roles
      where rolname = 'crm_purge' and (rolsuper or rolreplication or rolcreatedb or rolcreaterole or rolcanlogin
        or not rolbypassrls)
    ) then
    raise exception 'crm_purge must be a plain role in no role that nothing but the database owner can reach';
  end if;
end
$$;