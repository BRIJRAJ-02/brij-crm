-- The outbox pruned (spec 0007, milestone 3, AC-89): crm_outbox_prune(before, max) replaces 0020's
-- crm_outbox_prune(max). It is the worker's alone (crm_worker), never the app's, and it keeps a workspace's retained
-- rows one unbroken run of seq up to its head: it deletes from each workspace's oldest row and stops at the first row
-- that is unpublished or not yet past the cutoff, so catch up's "oldest retained row" still means every row after it
-- is there. It walks the primary key, so 0020's index on published_at goes with the old function (drizzle-kit's
-- statement, first). Hand written from the second statement on.
--
-- Dropping the index takes the outbox's lock, which every write takes: give up after 5 seconds rather than queue
-- behind traffic, like 0020.
--
-- Contract in the same step: a worker still running the old code calls crm_outbox_prune(integer) until it is
-- replaced, and that call fails (logged as a warning, once a minute) for the minutes of the deploy; it deletes
-- nothing either way, and the rows wait for the new code.
set local lock_timeout = '5s';
--> statement-breakpoint
DROP INDEX "outbox_published";
--> statement-breakpoint
drop function crm_outbox_prune(integer);
--> statement-breakpoint

-- Deletes at most `max` (clamped to 1 to 10,000) outbox rows created before `before` and published, and returns how
-- many: from each workspace's oldest seq up, stopping at its first row that is unpublished or created at or after
-- `before`, so an unpublished row is never deleted and no row is deleted past one that is kept. A null `before`
-- deletes nothing, and a row made in the last hour never goes whatever `before` says (a floor under OUTBOX_RETENTION,
-- so a slip in the caller's interval, '24' for '24 hours', costs nothing). Returns a count, nothing else.
--
-- The walk is a skip scan over the primary key (workspace_id, seq), one index probe per step: after a row that goes,
-- the next row in key order (the same workspace's next seq, or the next workspace's first row); after a row that
-- stays, the next workspace's first row. Postgres reads a recursive CTE only as far as the limit asks, so a call
-- reads at most `max` rows that go, plus one row for each workspace it passes over. The delete then looks each walked
-- row up by its whole primary key (a nested loop of unique lookups, whatever the planner guesses the walk returns; a
-- range per workspace planned as a hash join over a full scan of the table, review of 12 October 2026), and checks
-- both conditions again on every row.
--
-- It waits at most a second for a row lock (the relay's prune and spec 0008's daily cleanup may meet on the same
-- oldest rows) and then fails, which ends the relay's round; publishing on the relay's connection never waits longer.
--
-- Hardened as crm_outbox_workspaces in 0020: a standard SQL body (begin atomic), parsed once, here, and bound to its
-- table by OID, so no session setting can change what it reads; a fixed search_path; every name qualified, and the
-- parameters by the function's name, so no column can shadow them.
create function crm_outbox_prune(before timestamptz, max integer)
  returns integer
  language sql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
  set lock_timeout = '1s'
begin atomic
  with recursive
    walk(workspace_id, seq, goes) as (
      (
        select o.workspace_id, o.seq,
          (o.published_at is not null and o.created_at < crm_outbox_prune.before
            and o.created_at < pg_catalog.now() - interval '1 hour') is true
        from public.outbox o
        order by o.workspace_id, o.seq
        limit 1
      )
      union all
      select n.workspace_id, n.seq, n.goes
      from walk w
      cross join lateral (
        select o.workspace_id, o.seq,
          (o.published_at is not null and o.created_at < crm_outbox_prune.before
            and o.created_at < pg_catalog.now() - interval '1 hour') is true as goes
        from public.outbox o
        where (o.workspace_id, o.seq) > (w.workspace_id, case when w.goes then w.seq else 9223372036854775807 end)
        order by o.workspace_id, o.seq
        limit 1
      ) n
    ),
    doomed as (
      select w.workspace_id, w.seq
      from walk w
      where w.goes
      limit least(greatest(crm_outbox_prune.max, 1), 10000)
    ),
    gone as (
      delete from public.outbox o
      using doomed d
      where o.workspace_id = d.workspace_id and o.seq = d.seq
        and o.published_at is not null and o.created_at < crm_outbox_prune.before
        and o.created_at < pg_catalog.now() - interval '1 hour'
      returning 1
    )
  select count(*)::integer from gone;
end;
--> statement-breakpoint
revoke all on function crm_outbox_prune(timestamptz, integer) from public;
--> statement-breakpoint
grant execute on function crm_outbox_prune(timestamptz, integer) to crm_worker;
--> statement-breakpoint

-- Hand the function to crm_relay, as 0020 does: SET on the role and CREATE on the schema for the change only.
-- crm_relay already reads and deletes outbox rows (0020), and gains nothing here.
grant crm_relay to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_relay;
--> statement-breakpoint
alter function crm_outbox_prune(timestamptz, integer) owner to crm_relay;
--> statement-breakpoint
revoke create on schema public from crm_relay;
--> statement-breakpoint
revoke crm_relay from current_user;
--> statement-breakpoint

-- Refuse to finish unless the prune is the worker's alone: owned by crm_relay, executable by crm_relay and
-- crm_worker and nobody else by a grant of its own (PUBLIC included), and out of the app's and the identity login's
-- reach by any route; and, repeating 0020's checks since crm_relay's delete now has a new path: unless crm_relay is
-- a plain role (no login, no power, bypassing row level security) that nothing but the database owner can reach
-- (Neon's platform roles skipped by name), in no role itself, with no privilege beyond reading and deleting outbox
-- rows.
do $$
declare
  prune constant regprocedure := 'public.crm_outbox_prune(timestamptz, integer)'::regprocedure;
begin
  if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = prune) <> 'crm_relay'
    or exists (
      select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid = prune and a.privilege_type = 'EXECUTE'
        and a.grantee not in ('crm_relay'::regrole, 'crm_worker'::regrole)
    )
    or exists (
      select 1 from pg_proc p where p.proname = 'crm_outbox_prune' and p.oid <> prune
    )
    or has_function_privilege('crm_app', prune, 'EXECUTE')
    or has_function_privilege('crm_identity', prune, 'EXECUTE')
    or not has_function_privilege('crm_worker', prune, 'EXECUTE') then
    raise exception 'crm_outbox_prune must be owned by crm_relay and executable by crm_worker alone';
  end if;
  if exists (
    select 1 from pg_auth_members m
    where m.roleid = 'crm_relay'::regrole
      and m.member <> (select datdba from pg_database where datname = current_database())
      and pg_get_userbyid(m.member) not in ('neon_service', 'cloud_admin')
  ) or exists (
    select 1 from pg_auth_members m
    where m.roleid = 'crm_relay'::regrole and (m.set_option or m.inherit_option)
      and pg_get_userbyid(m.member) not in ('neon_service', 'cloud_admin')
  ) or pg_has_role('crm_app', 'crm_relay', 'MEMBER')
    or pg_has_role('crm_worker', 'crm_relay', 'MEMBER')
    or exists (
      select 1 from pg_roles
      where rolname = 'crm_relay' and (rolsuper or rolreplication or rolcreatedb or rolcanlogin or not rolbypassrls)
    ) then
    raise exception 'crm_relay must be a plain role with no member but the database owner, with ADMIN only';
  end if;
  -- As 0020: from the catalog, every table privilege by any route, every column grant, and any role it is in.
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(privilege)
    where c.relkind in ('r', 'p', 'v', 'm', 'f')
      and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_toast%'
      and has_table_privilege('crm_relay', c.oid, p.privilege)
      and not (c.oid = 'public.outbox'::regclass and p.privilege in ('SELECT', 'DELETE'))
  ) or exists (
    select 1
    from pg_attribute att
    cross join lateral aclexplode(att.attacl) a
    where a.grantee = 'crm_relay'::regrole
      and not (att.attrelid = 'public.outbox'::regclass and a.privilege_type = 'SELECT')
  ) or exists (
    select 1 from pg_auth_members m where m.member = 'crm_relay'::regrole
  ) or not has_table_privilege('crm_relay', 'public.outbox', 'DELETE') then
    raise exception 'crm_relay may only read and delete outbox rows';
  end if;
end
$$;
