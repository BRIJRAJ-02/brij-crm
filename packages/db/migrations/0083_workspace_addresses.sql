-- A workspace's address can change (Settings › Workspace › General, polish item 9). `auth.workspace_addresses` holds
-- every address a workspace has held, its current one included, keyed by the address alone: an old address keeps
-- finding its workspace (the web app then moves to the new one), and no other workspace can take it while that
-- workspace exists. The rule, picked for being the simplest safe one: an address is never freed while its
-- workspace exists, deleted or not; it goes, with the current one, only when the purge removes the directory row
-- (the foreign key cascades, run as this table's owner, so crm_purge needs nothing more).
--
-- One way in, hand written: crm_claim_workspace_address(wanted), a definer owned by crm_address (a role that can't
-- log in and holds only what the function needs), executable by crm_app alone. It acts only on the workspace the
-- transaction is set to (`app.workspace_id`, which withWorkspace sets for row level security): it records the
-- workspace's current address, claims `wanted` (taken by another workspace raises 23505 on
-- workspace_addresses_pkey, so the engine refuses SLUG_TAKEN), and moves the directory row to it. Creating a
-- workspace calls it in the same transaction as the directory insert, and so does a change of address, with the
-- tenant row, the audit row and the change event, so all of it lands or none does. crm_app still holds no new
-- privilege on schema auth (migration 0018's rule), only EXECUTE on this one function.
--
-- Existing directory rows are backfilled, so every address in use today is held from the start. Any change to the
-- role or the function goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "auth"."workspace_addresses" (
	"slug" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_addresses_pkey" PRIMARY KEY("slug"),
	CONSTRAINT "workspace_addresses_slug_shape" CHECK ("auth"."workspace_addresses"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("auth"."workspace_addresses"."slug") between 3 and 40)
);
--> statement-breakpoint
ALTER TABLE "auth"."workspace_addresses" ADD CONSTRAINT "workspace_addresses_directory" FOREIGN KEY ("workspace_id") REFERENCES "auth"."workspace_directory"("workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_addresses_workspace" ON "auth"."workspace_addresses" USING btree ("workspace_id");

--> statement-breakpoint
insert into auth.workspace_addresses (slug, workspace_id)
select d.slug, d.workspace_id from auth.workspace_directory d
on conflict (slug) do nothing;
--> statement-breakpoint
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_address') then
    create role crm_address nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$$;
--> statement-breakpoint
alter role crm_address nologin nobypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant usage on schema auth to crm_address;
--> statement-breakpoint
grant select (workspace_id, slug), update (slug) on auth.workspace_directory to crm_address;
--> statement-breakpoint
grant select, insert on auth.workspace_addresses to crm_address;
--> statement-breakpoint
-- Claims `wanted` for the workspace the transaction is set to, and makes it the directory's address. Nothing for
-- an address the workspace already holds (its own old one comes back); 54000 WORKSPACE_ADDRESS_LIMIT past 20 held; 23505 on workspace_addresses_pkey for one
-- another workspace holds, even one only just claimed by a transaction that commits first.
create function crm_claim_workspace_address(wanted text)
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  workspace uuid := nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid;
  held text;
  holder uuid;
begin
  if workspace is null then
    raise exception using errcode = '42501', message = 'crm_claim_workspace_address runs inside a workspace only.';
  end if;
  select d.slug into held from auth.workspace_directory d where d.workspace_id = workspace for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'The workspace has no directory row.';
  end if;
  insert into auth.workspace_addresses (slug, workspace_id) values (held, workspace) on conflict (slug) do nothing;
  -- At most 20 addresses a workspace, so none can hoard names; one it holds already can always come back.
  if not exists (select 1 from auth.workspace_addresses a where a.slug = wanted and a.workspace_id = workspace)
    and (select count(*) from auth.workspace_addresses a where a.workspace_id = workspace) >= 20 then
    raise exception using errcode = '54000', message = 'WORKSPACE_ADDRESS_LIMIT';
  end if;
  insert into auth.workspace_addresses (slug, workspace_id) values (wanted, workspace) on conflict (slug) do nothing;
  select a.workspace_id into holder from auth.workspace_addresses a where a.slug = wanted;
  if holder is distinct from workspace then
    raise exception using errcode = '23505', constraint = 'workspace_addresses_pkey',
      message = 'That workspace address is taken.';
  end if;
  update auth.workspace_directory d set slug = wanted where d.workspace_id = workspace and d.slug <> wanted;
end;
$$;
--> statement-breakpoint
revoke all on function crm_claim_workspace_address(text) from public;
--> statement-breakpoint
grant execute on function crm_claim_workspace_address(text) to crm_app;
--> statement-breakpoint
grant crm_address to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_address;
--> statement-breakpoint
alter function crm_claim_workspace_address(text) owner to crm_address;
--> statement-breakpoint
revoke create on schema public from crm_address;
--> statement-breakpoint
revoke crm_address from current_user;
--> statement-breakpoint
-- Refuse to finish unless the claim is as narrow as it reads: owned by crm_address and executable by crm_app alone,
-- out of the identity login's reach; crm_address a plain role in no role that nothing but the owner can become,
-- holding exactly the privileges granted above.
do $$
declare
  fn constant regprocedure := 'public.crm_claim_workspace_address(text)'::regprocedure;
begin
  if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = fn) <> 'crm_address'
    or exists (
      select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid = fn and a.privilege_type = 'EXECUTE'
        and a.grantee not in ('crm_address'::regrole, 'crm_app'::regrole)
    )
    or has_function_privilege('crm_identity', fn, 'EXECUTE') then
    raise exception 'crm_claim_workspace_address must be owned by crm_address and executable by crm_app alone';
  end if;
  if exists (select 1 from pg_roles where rolname = 'crm_address' and (rolcanlogin or rolsuper or rolbypassrls))
    or exists (select 1 from pg_auth_members m where m.member = 'crm_address'::regrole)
    or exists (
      select 1 from pg_auth_members m
      where m.roleid = 'crm_address'::regrole and (m.set_option or m.inherit_option)
        and pg_get_userbyid(m.member) not in ('neon_service', 'cloud_admin')
    )
    or pg_has_role('crm_app', 'crm_address', 'MEMBER')
    or pg_has_role('crm_identity', 'crm_address', 'MEMBER')
    or exists (
      select 1 from information_schema.role_table_grants g
      where g.grantee = 'crm_address'
        and (g.table_schema, g.table_name, g.privilege_type) not in (('auth', 'workspace_addresses', 'SELECT'),
          ('auth', 'workspace_addresses', 'INSERT'))
    )
    or exists (
      select 1 from pg_attribute att cross join lateral aclexplode(att.attacl) a
      where a.grantee = 'crm_address'::regrole
        and (att.attrelid, att.attname, a.privilege_type) not in (
          ('auth.workspace_directory'::regclass, 'workspace_id', 'SELECT'),
          ('auth.workspace_directory'::regclass, 'slug', 'SELECT'),
          ('auth.workspace_directory'::regclass, 'slug', 'UPDATE'))
    ) then
    raise exception 'crm_address must be a plain role, out of every login''s reach, holding only the claim''s grants';
  end if;
end
$$;
