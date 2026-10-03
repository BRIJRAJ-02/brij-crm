-- The outbox and its relay (spec 0005, change events, AC-38 and AC-39). The table and the counter column are
-- drizzle-kit's; row level security, the grants, the relay role, its one function and the closing check are
-- hand written. Runs as the owner role, which needs BYPASSRLS to create crm_relay (as for crm_search in 0012).
--
-- Adding outbox_seq is a catalog change only (a constant default), but it waits for workspace_counters' lock,
-- which every write takes: give up after 5 seconds rather than queue behind traffic, like 0009, 0011 and 0019.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TYPE "public"."outbox_kind" AS ENUM('records', 'definitions');--> statement-breakpoint
CREATE TABLE "outbox" (
	"workspace_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"kind" "outbox_kind" NOT NULL,
	"object_id" uuid NOT NULL,
	"record_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"attribute_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"coarse" boolean DEFAULT false NOT NULL,
	"mutation_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp (6) with time zone,
	CONSTRAINT "outbox_pkey" PRIMARY KEY("workspace_id","seq")
);
--> statement-breakpoint
ALTER TABLE "workspace_counters" ADD COLUMN "outbox_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_pending" ON "outbox" USING btree ("workspace_id","seq") WHERE "outbox"."published_at" is null;
--> statement-breakpoint

-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table outbox enable row level security;
--> statement-breakpoint
alter table outbox force row level security;
--> statement-breakpoint
create policy outbox_tenant on outbox
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- The app writes a row in the write's transaction and the relay (as the app, inside withWorkspace) reads and
-- stamps it. Nothing else: no delete (#8 prunes, as a job), and no update of an event once it is written.
revoke all on outbox from crm_app;
--> statement-breakpoint
grant select, insert on outbox to crm_app;
--> statement-breakpoint
grant update (published_at) on outbox to crm_app;
--> statement-breakpoint

-- crm_relay: the owner of the one function that reads across workspaces. It can't log in, bypasses row level
-- security, and can read the outbox and nothing else. It and crm_search are the only roles besides the owner
-- that bypass row level security, and its function and crm_search_text the only security definer functions; the
-- guard tests list them. Any change here goes through security-access-reviewer.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_relay') then
    create role crm_relay nologin nosuperuser bypassrls nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$$;
--> statement-breakpoint
-- Roles are shared by the whole cluster: one made earlier (by hand, or by a draft) gets exactly these attributes.
-- SUPERUSER, REPLICATION and CREATEDB need the same attribute to change, so the check at the end refuses them.
alter role crm_relay nologin bypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant usage on schema public to crm_relay;
--> statement-breakpoint
grant select on outbox to crm_relay;
--> statement-breakpoint

-- The workspaces with unpublished outbox rows, at most `max` (clamped to 1 to 500). Workspace ids only, never a
-- row's contents: the relay then reads and marks each workspace's rows inside withWorkspace, under row level
-- security, as the app. One id per workspace however many rows wait (the pending index, read in order).
--
-- As crm_search_text: a standard SQL body (begin atomic) is parsed once, here, and binds its table by OID, so no
-- session setting can change what it reads; the parameter is qualified with the function's name, so no column
-- can shadow it.
create function crm_outbox_workspaces(max integer)
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 500
begin atomic
  select o.workspace_id
  from public.outbox o
  where o.published_at is null
  group by o.workspace_id
  limit least(greatest(crm_outbox_workspaces.max, 1), 500);
end;
--> statement-breakpoint
revoke all on function crm_outbox_workspaces(integer) from public;
--> statement-breakpoint
grant execute on function crm_outbox_workspaces(integer) to crm_app;
--> statement-breakpoint

-- Hand the function to crm_relay. Postgres 16 and later don't give the creator SET on a role it creates, and a
-- new owner needs CREATE on the schema, so both are granted for the change, then taken back.
grant crm_relay to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_relay;
--> statement-breakpoint
alter function crm_outbox_workspaces(integer) owner to crm_relay;
--> statement-breakpoint
revoke create on schema public from crm_relay;
--> statement-breakpoint
revoke crm_relay from current_user;
--> statement-breakpoint

-- Refuse to finish if anything but the database owner can reach crm_relay, or if the app can by any grant, or
-- if crm_relay can log in or holds a power no grant can fence. Neon's own platform roles (neon_service and
-- cloud_admin) are skipped by name, as in 0017 and 0018; off Neon they don't exist and nothing is skipped.
do $$
begin
  if exists (
    select 1 from pg_auth_members m
    where m.roleid = 'crm_relay'::regrole
      and m.member <> (select datdba from pg_database where datname = current_database())
      and pg_get_userbyid(m.member) not in ('neon_service', 'cloud_admin')
  ) or exists (
    select 1 from pg_auth_members m
    where m.roleid = 'crm_relay'::regrole and (m.set_option or m.inherit_option)
      and pg_get_userbyid(m.member) not in ('neon_service', 'cloud_admin')
  ) or pg_has_role('crm_app', 'crm_relay', 'MEMBER')
    or exists (
      select 1 from pg_roles
      where rolname = 'crm_relay' and (rolsuper or rolreplication or rolcreatedb or rolcanlogin or not rolbypassrls)
    ) then
    raise exception 'crm_relay must be a plain role with no member but the database owner, with ADMIN only';
  end if;
end
$$;
