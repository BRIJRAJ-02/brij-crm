-- Hand written: who may use the `auth` schema (spec 0005, sign in and access). Runs as the owner role.
--
-- Global identity (Better Auth's tables and the workspace directory) sits outside row level security, so
-- these grants are its whole fence: the app role reads and writes rows, through packages/db's identity
-- store only, and no other role can use the schema. No tenant data lives here; the guard tests check that
-- only the two directory tables carry a workspace id.
revoke all on schema auth from public;
--> statement-breakpoint
grant usage on schema auth to crm_app;
--> statement-breakpoint
revoke all on all tables in schema auth from public;
--> statement-breakpoint
grant select, insert, update, delete on all tables in schema auth to crm_app;
--> statement-breakpoint
-- A later table the owner adds here is usable the same way, and no more.
alter default privileges in schema auth grant select, insert, update, delete on tables to crm_app;
--> statement-breakpoint

-- Refuse to finish if the schema, a table in it, or the owner's default privileges for new tables reach
-- anyone but the owner (or a role whose privileges the owner already holds, like Neon's neon_superuser) and
-- the app, if the app holds more than the four privileges, or if the app could change the schema.
do $$
declare
  auth_schema oid := (select oid from pg_namespace where nspname = 'auth');
  auth_owner oid := (select nspowner from pg_namespace where nspname = 'auth');
begin
  if exists (
    select 1
    from (
      select a.grantee, a.privilege_type, false as on_table
      from aclexplode((select nspacl from pg_namespace where oid = auth_schema)) a
      union all
      select a.grantee, a.privilege_type, true
      from pg_class c, aclexplode(c.relacl) a
      where c.relnamespace = auth_schema
      union all
      select a.grantee, a.privilege_type, true
      from pg_default_acl d, aclexplode(d.defaclacl) a
      where d.defaclrole = auth_owner and d.defaclnamespace in (auth_schema, 0) and d.defaclobjtype = 'r'
    ) g
    where case
      -- PUBLIC
      when g.grantee = 0 then true
      when g.grantee = auth_owner then false
      when g.grantee = 'crm_app'::regrole then
        g.on_table and g.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      else not pg_has_role(auth_owner, g.grantee, 'USAGE')
    end
  ) or has_schema_privilege('crm_app', 'auth', 'CREATE')
    or has_schema_privilege('crm_search', 'auth', 'USAGE') then
    raise exception 'schema auth must reach the owner and crm_app (select, insert, update, delete) only';
  end if;
end
$$;
