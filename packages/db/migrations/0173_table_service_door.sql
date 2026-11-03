-- Table seating's public door (spec 0066 B7 lite; spec 0065 AC-6550, AC-6557): a guest's reservation page at
-- timefix.com/r/<key> finds its place by the place's public key.
--
-- * `crm_table_lookup`, a new lookup role, and its one definer `crm_table_place_by_key(key)`: the workspace and place
--   a public key names, only while the workspace is live and has Timefix's business apps, with whether Table seating
--   is installed now. Ids and that one flag only; the guest page's reads then run inside withWorkspace() under row
--   level security. A removed app still finds its place, so a guest's manage link keeps working for a reservation
--   already made (0065: "the guest holds a promise"); new times and reservations refuse unless `installed`.
--   crm_app may execute it.
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_table_lookup') then
    create role crm_table_lookup nologin nosuperuser bypassrls nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$$;
--> statement-breakpoint
alter role crm_table_lookup nologin bypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant usage on schema public to crm_table_lookup;
--> statement-breakpoint
grant select (workspace_id, id, public_key) on places to crm_table_lookup;
--> statement-breakpoint
grant select (workspace_id, app, removed_at) on workspace_apps to crm_table_lookup;
--> statement-breakpoint
grant select (id, deleted_at, early_access) on workspaces to crm_table_lookup;
--> statement-breakpoint
-- The workspace and place a reservation page's key names (spec 0065, AC-6550), or no row: only while the workspace is
-- live and Timefix's business apps are open for it, with whether Table seating is installed. Ids only. A standard
-- SQL body bound to its tables, a fixed search_path, every name qualified, the parameter by the function's name.
create function crm_table_place_by_key(key text)
  returns table (workspace_id uuid, place_id uuid, installed boolean)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select p.workspace_id, p.id, exists (
      select 1 from public.workspace_apps a
      where a.workspace_id = p.workspace_id and a.app = 'table_seating' and a.removed_at is null
    )
  from public.places p
  join public.workspaces w on w.id = p.workspace_id
  where p.public_key = crm_table_place_by_key.key
    and w.deleted_at is null
    and 'business_apps' = any(w.early_access)
  limit 1;
end;
--> statement-breakpoint
revoke all on function crm_table_place_by_key(text) from public;
--> statement-breakpoint
grant execute on function crm_table_place_by_key(text) to crm_app;
--> statement-breakpoint
grant crm_table_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_table_lookup;
--> statement-breakpoint
alter function crm_table_place_by_key(text) owner to crm_table_lookup;
--> statement-breakpoint
revoke create on schema public from crm_table_lookup;
--> statement-breakpoint
revoke crm_table_lookup from current_user;
--> statement-breakpoint
-- Refuse to finish unless the lookup is as narrow as it reads: owned by crm_table_lookup, executable by it and
-- crm_app alone, out of the identity login's reach, and crm_table_lookup a plain role in no role.
do $$
declare
  lookup constant regprocedure := 'public.crm_table_place_by_key(text)'::regprocedure;
begin
  if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = lookup) <> 'crm_table_lookup'
    or exists (
      select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid = lookup and a.privilege_type = 'EXECUTE'
        and a.grantee not in ('crm_table_lookup'::regrole, 'crm_app'::regrole)
    )
    or has_function_privilege('crm_identity', lookup, 'EXECUTE') then
    raise exception 'crm_table_place_by_key must be owned by crm_table_lookup and executable by crm_app alone';
  end if;
  if exists (
    select 1 from pg_auth_members m where m.member = 'crm_table_lookup'::regrole
  ) or pg_has_role('crm_app', 'crm_table_lookup', 'MEMBER')
    or pg_has_role('crm_identity', 'crm_table_lookup', 'MEMBER')
    or exists (
      select 1 from pg_roles
      where rolname = 'crm_table_lookup' and (rolsuper or rolreplication or rolcreatedb or rolcreaterole or rolcanlogin
        or not rolbypassrls)
    ) then
    raise exception 'crm_table_lookup must be a plain role in no role';
  end if;
end
$$;
--> statement-breakpoint
-- A place's visits go live (spec 0066 B7): `outbox_kind` gains `visits`, one row per write that made, changed or
-- moved a reservation, naming the places, so open Service lists and floors read their day again. Enum values are only
-- ever added, and nothing in this migration uses it, so it runs inside its transaction.
ALTER TYPE "public"."outbox_kind" ADD VALUE 'visits';
--> statement-breakpoint
-- Puts a reservation's guest email on Graphile Worker's queue (spec 0066 B7 lite; spec 0065 AC-6555), as
-- crm_enqueue_booking_mail does for bookings, owned by the same crm_queue. It reads the visit under the caller's
-- workspace setting (row level security still applies, crm_queue bypasses nothing) and builds the queue row itself, so
-- the caller chooses only the kind: task crm_visit_mail, payload the workspace and visit ids and the kind, 5 attempts.
-- `confirmed`, `changed` and `cancelled` run now. `reminder_24h` and `reminder_2h` run that long before the visit
-- starts, keyed by visit and kind with job_key_mode 'replace', so a change replaces them; one whose time has passed
-- is not queued, and one left for a cancelled visit finds it cancelled and sends nothing. Only a visit with an email.
-- Answers whether it queued.
grant crm_queue to current_user with inherit false, set true;
--> statement-breakpoint
grant select (workspace_id, id, status, starts_at, client_email) on appointments to crm_queue;
--> statement-breakpoint
create function crm_enqueue_visit_mail(appointment_id uuid, kind text)
  returns boolean
  language sql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
as $function$
  with visit as (
    select a.workspace_id, a.id,
      case crm_enqueue_visit_mail.kind
        when 'reminder_24h' then a.starts_at - interval '24 hours'
        when 'reminder_2h' then a.starts_at - interval '2 hours'
        else pg_catalog.now()
      end as run_at
    from public.appointments a
    where a.id = crm_enqueue_visit_mail.appointment_id
      and a.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
      and a.client_email is not null
      and crm_enqueue_visit_mail.kind in ('confirmed', 'changed', 'cancelled', 'reminder_24h', 'reminder_2h')
  ),
  added as materialized (
    select graphile_worker.add_job(
      identifier => 'crm_visit_mail',
      payload => pg_catalog.json_build_object(
        'workspaceId', visit.workspace_id, 'appointmentId', visit.id, 'kind', crm_enqueue_visit_mail.kind
      ),
      run_at => visit.run_at,
      max_attempts => 5,
      job_key => case when crm_enqueue_visit_mail.kind like 'reminder_%'
        then 'crm-visit:' || visit.workspace_id::text || ':' || visit.id::text || ':' || crm_enqueue_visit_mail.kind
      end,
      job_key_mode => 'replace'
    ) as queued
    from visit
    where crm_enqueue_visit_mail.kind not like 'reminder_%' or visit.run_at > pg_catalog.now()
  )
  select count(*) = 1 from added;
$function$;
--> statement-breakpoint
revoke all on function crm_enqueue_visit_mail(uuid, text) from public;
--> statement-breakpoint
grant execute on function crm_enqueue_visit_mail(uuid, text) to crm_app;
--> statement-breakpoint
grant create on schema public to crm_queue;
--> statement-breakpoint
alter function crm_enqueue_visit_mail(uuid, text) owner to crm_queue;
--> statement-breakpoint
revoke create on schema public from crm_queue;
--> statement-breakpoint
revoke crm_queue from current_user;
