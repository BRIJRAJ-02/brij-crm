-- Hand written: every workspace's owner, and the guard that keeps one (spec 0009, AC-132 and AC-137). Runs as the
-- owner role, after 0021 added `members.role` with the default `member`.
--
-- Row security off: the owner bypasses it (as on Neon), and a role it would filter fails here rather than
-- backfilling nothing and passing the closing check with nothing to check.
set local row_security = off;
--> statement-breakpoint

-- 1. The backfill: in each workspace, the earliest active member (by created_at, then id) becomes its owner.
--    A workspace with no active member gets none; it is named in a notice and left for #23.
update members m
set role = 'owner'
from (
  select distinct on (workspace_id) workspace_id, id
  from members
  where status = 'active'
  order by workspace_id, created_at, id
) earliest
where m.workspace_id = earliest.workspace_id and m.id = earliest.id;
--> statement-breakpoint

-- 2. The guard: a transaction that leaves a live workspace with no active owner is refused at its commit, even one
--    that never went through the service (a script, a support tool, a raw update). A deferred constraint trigger
--    raises at COMMIT, outside the statement that broke the rule, so it raises a fixed SQLSTATE of its own, CRM01
--    (class CR, which Postgres doesn't use), with the message LAST_OWNER; packages/core maps that code, at the
--    commit of inWorkspace and runWrite, to 409 LAST_OWNER. Any other error at commit stays unexpected.
--
--    It fires only when the old row was an active owner: a demotion, a removal or a delete. It runs as the caller
--    (security invoker, the default), under row level security, so it reads only its own workspace's members; a
--    soft deleted workspace no longer needs an owner. Executing a trigger function needs no privilege at fire
--    time, so nobody is granted it. The search path is fixed and every name qualified.
create function crm_members_keep_an_owner()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  if old.role = 'owner'
    and old.status = 'active'
    and exists (select 1 from public.workspaces w where w.id = old.workspace_id and w.deleted_at is null)
    and not exists (
      select 1 from public.members m
      where m.workspace_id = old.workspace_id and m.role = 'owner' and m.status = 'active'
    )
  then
    raise exception using errcode = 'CRM01', message = 'LAST_OWNER',
      detail = 'A live workspace needs at least one active owner.';
  end if;
  return null;
end;
$$;
--> statement-breakpoint
revoke all on function crm_members_keep_an_owner() from public;
--> statement-breakpoint
create constraint trigger members_keep_an_owner
  after update of role, status or delete on members
  deferrable initially deferred
  for each row
  execute function crm_members_keep_an_owner();
--> statement-breakpoint

-- 3. The closing check: refuse to finish unless every live workspace with an active member has an active owner, and
--    the guard is in place as a deferred constraint trigger. A live workspace with no active member is only noted.
do $$
declare
  ownerless text;
  memberless text;
  guard record;
begin
  select string_agg(w.id::text, ', ' order by w.id)
  into ownerless
  from workspaces w
  where w.deleted_at is null
    and exists (select 1 from members m where m.workspace_id = w.id and m.status = 'active')
    and not exists (select 1 from members m where m.workspace_id = w.id and m.status = 'active' and m.role = 'owner');
  if ownerless is not null then
    raise exception 'every live workspace with an active member needs an active owner, but these have none: %', ownerless;
  end if;

  select string_agg(w.id::text, ', ' order by w.id)
  into memberless
  from workspaces w
  where w.deleted_at is null
    and not exists (select 1 from members m where m.workspace_id = w.id and m.status = 'active');
  if memberless is not null then
    raise notice 'no active member, so no owner (left for #23): %', memberless;
  end if;

  select t.tgdeferrable as deferrable, t.tginitdeferred as deferred, t.tgenabled as enabled, t.tgconstraint <> 0 as constraint_trigger
  into guard
  from pg_trigger t
  where t.tgrelid = 'public.members'::regclass and t.tgname = 'members_keep_an_owner';
  if not found or not guard.deferrable or not guard.deferred or guard.enabled <> 'O' or not guard.constraint_trigger then
    raise exception 'members_keep_an_owner must be an enabled constraint trigger, deferrable initially deferred';
  end if;
end
$$;
