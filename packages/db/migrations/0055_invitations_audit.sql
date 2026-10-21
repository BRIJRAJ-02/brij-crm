-- Invitations and the audit log (spec 0031, slice 2): `invitations` (email invitations now, the invite link from
-- slice 6) and `audit_events` (append only, reused by specs 0032 and 0033), with the standard tenant policy on each;
-- drizzle-kit's tables, keys and indexes, the rest hand written at the end.
--
-- Acceptance finds an invitation before it knows the workspace, by the SHA-256 of its token:
-- crm_invitation_by_token(hash), owned by crm_invitation_lookup (no login, bypasses row level security only to read
-- seven columns of invitations), answers the workspace and invitation ids and nothing else. Sign up asks the same
-- role one yes or no question: crm_invitation_open_for(email), whether an open, unexpired email invitation names
-- that address (owner decision 3, AC-807). Both are for crm_app only. This replaces the spec's
-- `auth.invitation_lookup` table: the app never writes schema auth beyond the two directory rows, and this is the
-- shape crm_booking_by_token already has.
--
-- The foreign keys briefly lock the tables they touch. Give up after 5 seconds rather than queue behind traffic, like
-- 0020, 0023, 0026, 0029, 0033, 0037 and 0041.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"actor_member_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"request_id" text,
	CONSTRAINT "audit_events_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "audit_events_actor_shape" CHECK (("audit_events"."actor_type" is null and "audit_events"."actor_id" is null and "audit_events"."actor_member_id" is null)
      or ("audit_events"."actor_type" = 'system' and "audit_events"."actor_id" is null and "audit_events"."actor_member_id" is null)
      or ("audit_events"."actor_type" = 'member' and "audit_events"."actor_id" is not null and "audit_events"."actor_member_id" = "audit_events"."actor_id")
      or ("audit_events"."actor_type"::text not in ('member', 'system', 'calendar') and "audit_events"."actor_id" is not null and "audit_events"."actor_member_id" is null)),
	CONSTRAINT "audit_events_action" CHECK ("audit_events"."action" ~ '^[a-z_]+(\.[a-z_]+)+$')
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"kind" text DEFAULT 'email' NOT NULL,
	"email" text,
	"role" "member_role" NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp (6) with time zone,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"send_count" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp (6) with time zone,
	"used_by_member_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "invitations_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "invitations_created_by_actor" CHECK (("invitations"."created_by_type" is null and "invitations"."created_by_id" is null and "invitations"."created_by_member_id" is null)
      or ("invitations"."created_by_type" = 'system' and "invitations"."created_by_id" is null and "invitations"."created_by_member_id" is null)
      or ("invitations"."created_by_type" = 'member' and "invitations"."created_by_id" is not null and "invitations"."created_by_member_id" = "invitations"."created_by_id")
      or ("invitations"."created_by_type"::text not in ('member', 'system', 'calendar') and "invitations"."created_by_id" is not null and "invitations"."created_by_member_id" is null)),
	CONSTRAINT "invitations_updated_by_actor" CHECK (("invitations"."updated_by_type" is null and "invitations"."updated_by_id" is null and "invitations"."updated_by_member_id" is null)
      or ("invitations"."updated_by_type" = 'system' and "invitations"."updated_by_id" is null and "invitations"."updated_by_member_id" is null)
      or ("invitations"."updated_by_type" = 'member' and "invitations"."updated_by_id" is not null and "invitations"."updated_by_member_id" = "invitations"."updated_by_id")
      or ("invitations"."updated_by_type"::text not in ('member', 'system', 'calendar') and "invitations"."updated_by_id" is not null and "invitations"."updated_by_member_id" is null)),
	CONSTRAINT "invitations_kind" CHECK ("invitations"."kind" in ('email', 'link')),
	CONSTRAINT "invitations_status" CHECK ("invitations"."status" in ('open', 'used', 'revoked')),
	CONSTRAINT "invitations_email_shape" CHECK (("invitations"."kind" = 'email' and "invitations"."email" is not null and "invitations"."email" = lower("invitations"."email") and "invitations"."max_uses" = 1)
        or ("invitations"."kind" = 'link' and "invitations"."email" is null and "invitations"."role"::text not in ('owner', 'admin'))),
	CONSTRAINT "invitations_token_hash" CHECK ("invitations"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "invitations_uses" CHECK ("invitations"."uses" >= 0 and ("invitations"."max_uses" is null or "invitations"."max_uses" >= 1))
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor" FOREIGN KEY ("workspace_id","actor_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_used_by" FOREIGN KEY ("workspace_id","used_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_at" ON "audit_events" USING btree ("workspace_id","at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "audit_events_target" ON "audit_events" USING btree ("workspace_id","target_type","target_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_open_email" ON "invitations" USING btree ("workspace_id","email") WHERE "invitations"."status" = 'open' and "invitations"."kind" = 'email';--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_open_link" ON "invitations" USING btree ("workspace_id") WHERE "invitations"."status" = 'open' and "invitations"."kind" = 'link';--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_open_address" ON "invitations" USING btree ("email") WHERE "invitations"."status" = 'open' and "invitations"."kind" = 'email';--> statement-breakpoint
CREATE INDEX "invitations_open" ON "invitations" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id") WHERE "invitations"."status" = 'open';
--> statement-breakpoint
alter table invitations enable row level security;
--> statement-breakpoint
alter table invitations force row level security;
--> statement-breakpoint
create policy invitations_tenant on invitations
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table audit_events enable row level security;
--> statement-breakpoint
alter table audit_events force row level security;
--> statement-breakpoint
create policy audit_events_tenant on audit_events
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- Append only (AC-830): the app inserts and reads, nothing more, and a trigger refuses an update, a delete or a
-- truncate from anyone, the owner included. A workspace's purge (slice 7) will need its own narrow way past it.
revoke all on audit_events from crm_app;
--> statement-breakpoint
grant select, insert on audit_events to crm_app;
--> statement-breakpoint
create function crm_audit_events_append_only()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception using errcode = 'CRM02', message = 'AUDIT_APPEND_ONLY',
    detail = 'audit_events rows are never changed or removed.';
end;
$$;
--> statement-breakpoint
revoke all on function crm_audit_events_append_only() from public;
--> statement-breakpoint
create trigger audit_events_append_only
  before update or delete on audit_events
  for each row execute function crm_audit_events_append_only();
--> statement-breakpoint
create trigger audit_events_no_truncate
  before truncate on audit_events
  for each statement execute function crm_audit_events_append_only();
--> statement-breakpoint

-- The lookups' role: no login, no power but reading seven columns of invitations past row level security.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_invitation_lookup') then
    create role crm_invitation_lookup nologin nosuperuser bypassrls nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$$;
--> statement-breakpoint
alter role crm_invitation_lookup nologin bypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant usage on schema public to crm_invitation_lookup;
--> statement-breakpoint
grant select (workspace_id, id, token_hash, kind, email, status, expires_at) on invitations to crm_invitation_lookup;
--> statement-breakpoint

-- The workspace and invitation a token's hash names, or no row. Ids only: whether it is still open, its role and
-- its address are read by the caller inside withWorkspace() under row level security. Hardened as crm_workspace_ids
-- in 0034: a standard SQL body bound to its table, a fixed search_path, every name qualified, the parameter by the
-- function's name.
create function crm_invitation_by_token(token_hash text)
  returns table (workspace_id uuid, invitation_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 1
begin atomic
  select i.workspace_id, i.id
  from public.invitations i
  where i.token_hash = crm_invitation_by_token.token_hash
  limit 1;
end;
--> statement-breakpoint
revoke all on function crm_invitation_by_token(text) from public;
--> statement-breakpoint
grant execute on function crm_invitation_by_token(text) to crm_app;
--> statement-breakpoint

-- Whether an open, unexpired email invitation names this address (compared lowercased): sign up's only question.
-- A boolean, never which workspace.
create function crm_invitation_open_for(email text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select exists (
    select 1
    from public.invitations i
    where i.kind = 'email'
      and i.status = 'open'
      and i.email = pg_catalog.lower(crm_invitation_open_for.email)
      and i.expires_at > pg_catalog.now()
  );
end;
--> statement-breakpoint
revoke all on function crm_invitation_open_for(text) from public;
--> statement-breakpoint
grant execute on function crm_invitation_open_for(text) to crm_app;
--> statement-breakpoint
grant crm_invitation_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_invitation_lookup;
--> statement-breakpoint
alter function crm_invitation_by_token(text) owner to crm_invitation_lookup;
--> statement-breakpoint
alter function crm_invitation_open_for(text) owner to crm_invitation_lookup;
--> statement-breakpoint
revoke create on schema public from crm_invitation_lookup;
--> statement-breakpoint
revoke crm_invitation_lookup from current_user;
--> statement-breakpoint

-- Refuse to finish unless the lookups are as narrow as they read: owned by crm_invitation_lookup, executable by it
-- and crm_app alone (crm_worker reaches them through crm_app), out of the identity login's reach, and
-- crm_invitation_lookup a plain role in no role, holding nothing but the seven columns.
do $$
declare
  lookups constant regprocedure[] := array[
    'public.crm_invitation_by_token(text)'::regprocedure,
    'public.crm_invitation_open_for(text)'::regprocedure
  ];
begin
  if exists (
    select 1 from pg_proc p
    where p.oid = any(lookups) and pg_get_userbyid(p.proowner) <> 'crm_invitation_lookup'
  ) or exists (
    select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.oid = any(lookups) and a.privilege_type = 'EXECUTE'
      and a.grantee not in ('crm_invitation_lookup'::regrole, 'crm_app'::regrole)
  ) or exists (
    select 1 from unnest(lookups) l(fn) where has_function_privilege('crm_identity', l.fn, 'EXECUTE')
  ) then
    raise exception 'the invitation lookups must be owned by crm_invitation_lookup and executable by crm_app alone';
  end if;
  if exists (
    select 1 from pg_auth_members m where m.member = 'crm_invitation_lookup'::regrole
  ) or pg_has_role('crm_app', 'crm_invitation_lookup', 'MEMBER')
    or pg_has_role('crm_identity', 'crm_invitation_lookup', 'MEMBER')
    or exists (
      select 1 from pg_roles
      where rolname = 'crm_invitation_lookup'
        and (rolsuper or rolreplication or rolcreatedb or rolcreaterole or rolcanlogin or not rolbypassrls)
    ) then
    raise exception 'crm_invitation_lookup must be a plain role in no role';
  end if;
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(privilege)
    where c.relkind in ('r', 'p', 'v', 'm', 'f')
      and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_toast%'
      and has_table_privilege('crm_invitation_lookup', c.oid, p.privilege)
  ) or exists (
    select 1
    from pg_attribute att
    cross join lateral aclexplode(att.attacl) a
    where a.grantee = 'crm_invitation_lookup'::regrole
      and not (att.attrelid = 'public.invitations'::regclass
        and att.attname in ('workspace_id', 'id', 'token_hash', 'kind', 'email', 'status', 'expires_at')
        and a.privilege_type = 'SELECT')
  ) then
    raise exception 'crm_invitation_lookup may only read seven columns of invitations';
  end if;
end
$$;
