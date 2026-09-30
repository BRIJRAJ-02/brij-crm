-- Local only. Mirrors Neon: an owner role that owns the `crm` database and
-- runs migrations. The migrations create the crm_app group role, and
-- `pnpm db:app-login` creates the app's login role inside it.
create role crm_owner login password 'crm_owner_local' createrole;
create database crm owner crm_owner;
