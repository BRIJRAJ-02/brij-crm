-- Local only. Mirrors Neon: an owner role that owns the `crm` database and
-- runs migrations, with BYPASSRLS as Neon's owner has (it needs it to create
-- crm_search, the search function's role). The migrations create the crm_app
-- group role, and `pnpm db:app-login` creates the app's login role inside it.
-- A volume made before BYPASSRLS was added needs, once, as postgres:
-- alter role crm_owner bypassrls;
create role crm_owner login password 'crm_owner_local' createrole bypassrls;
create database crm owner crm_owner;
