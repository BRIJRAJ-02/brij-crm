-- Hand written: extensions and the app role. Runs as the owner role.
-- Trigram search for global search (#33), available from the start.
create extension if not exists pg_trgm;
--> statement-breakpoint

-- crm_app is a group role. It can't log in, isn't a superuser and can't
-- bypass row level security. Each environment's app login is a member of it
-- (see scripts/app-login.ts), so grants live in one place.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_app') then
    create role crm_app nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;
--> statement-breakpoint

grant usage on schema public to crm_app;
--> statement-breakpoint

-- Every table and sequence the owner creates from now on is usable by the app,
-- through row level security. The app never owns a table, so FORCE ROW LEVEL
-- SECURITY applies to it.
alter default privileges in schema public grant select, insert, update, delete on tables to crm_app;
--> statement-breakpoint
alter default privileges in schema public grant usage, select on sequences to crm_app;
