-- Hand written: the identity login (spec 0005, security model). Runs as the owner role.
--
-- Global identity (Better Auth's tables and the workspace directory) gets its own group role, crm_identity,
-- and the identity store connects as a login inside it (IDENTITY_DATABASE_URL, see
-- scripts/identity-login.ts). crm_identity alone reads and writes schema `auth`. crm_app, which runs every
-- tenant query, keeps only `insert` on the two directory tables (written inside the workspace transaction),
-- so a mistake in tenant code can never read a session, an account or a sign in code.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_identity') then
    create role crm_identity nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
  end if;
end
$$;
--> statement-breakpoint
-- Whatever made it before, it is a plain group role with no login of its own. (The attributes only a
-- superuser may change are checked at the end instead.)
alter role crm_identity nologin nobypassrls nocreaterole password null;
--> statement-breakpoint
grant usage on schema auth to crm_identity;
--> statement-breakpoint
grant select, insert, update, delete on all tables in schema auth to crm_identity;
--> statement-breakpoint
-- A later table the owner adds here is the identity login's, and only its.
alter default privileges in schema auth grant select, insert, update, delete on tables to crm_identity;
--> statement-breakpoint
alter default privileges in schema auth revoke all on tables from crm_app;
--> statement-breakpoint
-- The app keeps usage on the schema (an insert needs it) and insert on the directory, nothing else.
revoke all on all tables in schema auth from crm_app;
--> statement-breakpoint
grant insert on auth.workspace_directory, auth.workspace_membership to crm_app;
--> statement-breakpoint

-- Refuse to finish unless, in schema auth: the schema reaches the owner, crm_app and crm_identity (usage
-- only); every table reaches the owner, crm_identity (select, insert, update, delete) and, on the two
-- directory tables only, crm_app (insert); the owner's default privileges for new tables reach crm_identity
-- (the same four) and no one else; nobody but the owner can create here; crm_search can't use it; the two
-- logins' groups are apart (neither is a member of the other); and crm_identity is a plain group role.
-- "The owner" includes a role whose privileges the owner already holds, like Neon's neon_superuser.
do $$
declare
  auth_schema oid := (select oid from pg_namespace where nspname = 'auth');
  auth_owner oid := (select nspowner from pg_namespace where nspname = 'auth');
  app oid := 'crm_app'::regrole;
  identity oid := 'crm_identity'::regrole;
begin
  if exists (
    select 1
    from (
      select a.grantee, a.privilege_type, 'schema' as kind, null::name as relname
      from aclexplode((select nspacl from pg_namespace where oid = auth_schema)) a
      union all
      select a.grantee, a.privilege_type, 'table', c.relname
      from pg_class c, aclexplode(c.relacl) a
      where c.relnamespace = auth_schema
      union all
      select a.grantee, a.privilege_type, 'default', null
      from pg_default_acl d, aclexplode(d.defaclacl) a
      where d.defaclrole = auth_owner and d.defaclnamespace in (auth_schema, 0) and d.defaclobjtype = 'r'
    ) g
    where case
      -- PUBLIC
      when g.grantee = 0 then true
      when g.grantee = auth_owner then false
      when g.grantee = identity then
        case g.kind
          when 'schema' then g.privilege_type <> 'USAGE'
          else g.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
        end
      when g.grantee = app then
        case g.kind
          when 'schema' then g.privilege_type <> 'USAGE'
          when 'table' then g.privilege_type <> 'INSERT'
            or g.relname not in ('workspace_directory', 'workspace_membership')
          else true
        end
      else not pg_has_role(auth_owner, g.grantee, 'USAGE')
    end
  ) or has_schema_privilege('crm_app', 'auth', 'CREATE')
    or has_schema_privilege('crm_identity', 'auth', 'CREATE')
    or has_schema_privilege('crm_search', 'auth', 'USAGE')
    or pg_has_role('crm_app', 'crm_identity', 'USAGE') or pg_has_role('crm_app', 'crm_identity', 'SET')
    or pg_has_role('crm_identity', 'crm_app', 'USAGE') or pg_has_role('crm_identity', 'crm_app', 'SET')
    or exists (
      select 1 from pg_roles
      where oid = identity and (rolcanlogin or rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication)
    ) then
    raise exception 'schema auth must reach crm_identity (select, insert, update, delete) and crm_app (insert on the directory) only';
  end if;
end
$$;
