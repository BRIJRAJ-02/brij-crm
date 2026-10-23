-- Revokes across workspaces (spec 0031, AC-815; owner ask A115's follow ups). Removing a member, or purging a deleted
-- workspace, ends each of its calendar connections' grants with the provider. Google ends the whole grant of a user
-- to the app, so that silently broke the same Google account's connection in the person's other workspaces. Before
-- revoking, the calendar task now asks crm_calendar_account_shared(connection) whether another connection, in any
-- workspace, still holds the same provider and account and may sync ('syncing', 'connected' or 'failed'); when one
-- does, it only stops this connection's channels and deletes its row and tokens, and the grant stays for the other.
--
-- Answering reaches across workspaces, so it is a narrow definer as 0066's domain lookups are: owned by
-- crm_calendar_lookup, a role that can't log in, reads five columns of calendar_connections past row level security
-- and nothing else. It answers one boolean, only for a connection of the caller's own workspace (app.workspace_id),
-- never which workspace or whose connection, and only crm_app (the worker and the job drain are in it) may call it.
-- Hardened as crm_workspace_ids in 0034: a standard SQL body bound to its table when made, a fixed search_path, and
-- every name qualified. Any change to the role or the function goes through security-access-reviewer.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_calendar_lookup') then
    create role crm_calendar_lookup nologin nosuperuser bypassrls nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$$;
--> statement-breakpoint
alter role crm_calendar_lookup nologin bypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant usage on schema public to crm_calendar_lookup;
--> statement-breakpoint
grant select (workspace_id, id, provider, account_email, status) on calendar_connections to crm_calendar_lookup;
--> statement-breakpoint

-- Whether another connection, in any workspace, holds this connection's provider and account and may still sync.
-- The account is stored lower case and trimmed (calendar_connections_email), so equality matches it. False for a
-- connection outside the caller's workspace, as for one held nowhere else.
create function crm_calendar_account_shared(connection_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select exists (
    select 1
    from public.calendar_connections c
    join public.calendar_connections o
      on o.provider = c.provider and o.account_email = c.account_email and o.id <> c.id
    where c.id = crm_calendar_account_shared.connection_id
      and c.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
      and o.status in ('syncing', 'connected', 'failed')
  );
end;
--> statement-breakpoint
revoke all on function crm_calendar_account_shared(uuid) from public;
--> statement-breakpoint
grant execute on function crm_calendar_account_shared(uuid) to crm_app;
--> statement-breakpoint

-- Hand the function to crm_calendar_lookup. Postgres 16 and later don't give the creator SET on a role it creates,
-- and a new owner needs CREATE on the schema, so both are granted for the change, then taken back.
grant crm_calendar_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_calendar_lookup;
--> statement-breakpoint
alter function crm_calendar_account_shared(uuid) owner to crm_calendar_lookup;
--> statement-breakpoint
revoke create on schema public from crm_calendar_lookup;
--> statement-breakpoint
revoke crm_calendar_lookup from current_user;
--> statement-breakpoint

-- Refuse to finish unless the lookup is as narrow as it reads: the function owned by crm_calendar_lookup and
-- executable by crm_app alone (the identity login never), the role a plain one in no role and out of the app's and
-- the identity login's reach, and reading those five columns and nothing else.
do $$
begin
  if (
    select pg_get_userbyid(p.proowner) from pg_proc p
    where p.oid = 'public.crm_calendar_account_shared(uuid)'::regprocedure
  ) <> 'crm_calendar_lookup'
  or exists (
    select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.oid = 'public.crm_calendar_account_shared(uuid)'::regprocedure
      and a.privilege_type = 'EXECUTE'
      and a.grantee not in ('crm_calendar_lookup'::regrole, 'crm_app'::regrole)
  ) or has_function_privilege('crm_identity', 'public.crm_calendar_account_shared(uuid)', 'EXECUTE') then
    raise exception 'crm_calendar_account_shared must be owned by crm_calendar_lookup and executable by crm_app alone';
  end if;
  if exists (
    select 1 from pg_auth_members m where m.member = 'crm_calendar_lookup'::regrole
  ) or pg_has_role('crm_app', 'crm_calendar_lookup', 'MEMBER')
    or pg_has_role('crm_identity', 'crm_calendar_lookup', 'MEMBER')
    or exists (
      select 1 from pg_roles
      where rolname = 'crm_calendar_lookup'
        and (rolsuper or rolreplication or rolcreatedb or rolcreaterole or rolcanlogin or not rolbypassrls)
    ) then
    raise exception 'crm_calendar_lookup must be a plain role in no role';
  end if;
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(privilege)
    where c.relkind in ('r', 'p', 'v', 'm', 'f')
      and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_toast%'
      and has_table_privilege('crm_calendar_lookup', c.oid, p.privilege)
  ) or exists (
    select 1
    from pg_attribute att
    cross join lateral aclexplode(att.attacl) a
    where a.grantee = 'crm_calendar_lookup'::regrole
      and not (att.attrelid = 'public.calendar_connections'::regclass
        and att.attname in ('workspace_id', 'id', 'provider', 'account_email', 'status')
        and a.privilege_type = 'SELECT')
  ) then
    raise exception 'crm_calendar_lookup may only read five columns of calendar_connections';
  end if;
end
$$;
