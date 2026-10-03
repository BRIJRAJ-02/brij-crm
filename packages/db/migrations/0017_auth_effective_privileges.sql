-- Hand written: what each role can actually do in schema auth (spec 0005, the sign in security review). Runs as
-- the owner role. It changes nothing; it refuses to finish while any role reaches more than it should.
--
-- 0016 checks the grants written on schema auth. A role can reach those tables without any grant there: through
-- pg_read_all_data or pg_write_all_data (which skip every grant), through a group it inherits or can SET ROLE to,
-- or by a grant on a single column. So this asks Postgres itself (has_table_privilege, and
-- has_any_column_privilege for the privileges a column can carry) what each role can do on each auth table, and
-- allows only:
-- - crm_identity, and a role in it: select, insert, update and delete;
-- - crm_app, and a role in it: insert on workspace_directory and workspace_membership;
-- - the owner, and the roles the owner is itself in (like Neon's neon_superuser), as 0016 tolerates them;
-- - superusers, which no grant can fence (the logins are checked against reaching one when the api starts).
-- - Neon's own platform roles, neon_service and cloud_admin, by name.
-- Built in roles (oid below 16384, pg_read_all_data among them) are judged through the roles in them.
do $$
declare
  auth_schema oid := (select oid from pg_namespace where nspname = 'auth');
  auth_owner oid := (select nspowner from pg_namespace where nspname = 'auth');
  app oid := 'crm_app'::regrole;
  identity oid := 'crm_identity'::regrole;
  offenders text;
begin
  select string_agg(format('%s has %s on auth.%s', r.rolname, p.privilege, c.relname), '; '
      order by r.rolname, c.relname, p.privilege)
  into offenders
  from pg_roles r
  cross join pg_class c
  cross join (
    values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
  ) as p(privilege)
  where c.relnamespace = auth_schema
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and r.oid >= 16384
    and not r.rolsuper
    -- Neon's own platform roles (neon_service, cloud_admin) already read every tenant and can't be fenced by a
    -- grant, so they are skipped by name (decided by the owner, 3 October 2026). Any other role, including one
    -- made in the Neon console, is still checked. Off Neon these roles don't exist and nothing is skipped.
    and r.rolname not in ('neon_service', 'cloud_admin')
    and not pg_has_role(auth_owner, r.oid, 'USAGE')
    -- What r can do as itself (with what it inherits), or as any role it can SET ROLE to.
    and exists (
      select 1 from pg_roles s
      where (s.oid = r.oid or pg_has_role(r.oid, s.oid, 'SET'))
        and case
          when p.privilege in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
            then has_any_column_privilege(s.oid, c.oid, p.privilege)
          else has_table_privilege(s.oid, c.oid, p.privilege)
        end
    )
    and not (
      (pg_has_role(r.oid, identity, 'MEMBER') and p.privilege in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
      or (
        pg_has_role(r.oid, app, 'MEMBER') and p.privilege = 'INSERT'
        and c.relname in ('workspace_directory', 'workspace_membership')
      )
    );

  if offenders is not null then
    raise exception 'schema auth must reach crm_identity (select, insert, update, delete) and crm_app (insert on the directory) only, but: %', offenders;
  end if;
end
$$;
