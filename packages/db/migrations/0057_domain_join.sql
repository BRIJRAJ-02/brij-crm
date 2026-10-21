-- Domain join (spec 0031, slice 6, AC-819, AC-820): the email domains whose people may ask to join a workspace, and
-- their requests. Both tenant tables under forced row level security. /join finds a person's workspaces by their
-- verified email's domain before any scope exists through crm_workspaces_by_domain, a narrow definer that answers
-- workspace ids only, owned by its own role (as 0053's invitation lookups), so the spec's separate
-- auth.workspace_domain_lookup table isn't needed: the domain index here serves the same read.
CREATE TABLE "join_requests" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by_type" "actor_type",
	"decided_by_id" uuid,
	"decided_by_member_id" uuid,
	"decided_at" timestamp (6) with time zone,
	"member_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "join_requests_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "join_requests_created_by_actor" CHECK (("join_requests"."created_by_type" is null and "join_requests"."created_by_id" is null and "join_requests"."created_by_member_id" is null)
      or ("join_requests"."created_by_type" = 'system' and "join_requests"."created_by_id" is null and "join_requests"."created_by_member_id" is null)
      or ("join_requests"."created_by_type" = 'member' and "join_requests"."created_by_id" is not null and "join_requests"."created_by_member_id" = "join_requests"."created_by_id")
      or ("join_requests"."created_by_type"::text not in ('member', 'system', 'calendar') and "join_requests"."created_by_id" is not null and "join_requests"."created_by_member_id" is null)),
	CONSTRAINT "join_requests_updated_by_actor" CHECK (("join_requests"."updated_by_type" is null and "join_requests"."updated_by_id" is null and "join_requests"."updated_by_member_id" is null)
      or ("join_requests"."updated_by_type" = 'system' and "join_requests"."updated_by_id" is null and "join_requests"."updated_by_member_id" is null)
      or ("join_requests"."updated_by_type" = 'member' and "join_requests"."updated_by_id" is not null and "join_requests"."updated_by_member_id" = "join_requests"."updated_by_id")
      or ("join_requests"."updated_by_type"::text not in ('member', 'system', 'calendar') and "join_requests"."updated_by_id" is not null and "join_requests"."updated_by_member_id" is null)),
	CONSTRAINT "join_requests_decided_by_actor" CHECK (("join_requests"."decided_by_type" is null and "join_requests"."decided_by_id" is null and "join_requests"."decided_by_member_id" is null)
      or ("join_requests"."decided_by_type" = 'system' and "join_requests"."decided_by_id" is null and "join_requests"."decided_by_member_id" is null)
      or ("join_requests"."decided_by_type" = 'member' and "join_requests"."decided_by_id" is not null and "join_requests"."decided_by_member_id" = "join_requests"."decided_by_id")
      or ("join_requests"."decided_by_type"::text not in ('member', 'system', 'calendar') and "join_requests"."decided_by_id" is not null and "join_requests"."decided_by_member_id" is null)),
	CONSTRAINT "join_requests_status" CHECK ("join_requests"."status" in ('open', 'approved', 'declined')),
	CONSTRAINT "join_requests_email" CHECK ("join_requests"."email" = lower("join_requests"."email")),
	CONSTRAINT "join_requests_name" CHECK (char_length("join_requests"."name") between 1 and 80),
	CONSTRAINT "join_requests_decided" CHECK (("join_requests"."status" = 'open' and "join_requests"."decided_at" is null) or ("join_requests"."status" <> 'open' and "join_requests"."decided_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "workspace_domains" (
	"workspace_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "workspace_domains_pkey" PRIMARY KEY("workspace_id","domain"),
	CONSTRAINT "workspace_domains_created_by_actor" CHECK (("workspace_domains"."created_by_type" is null and "workspace_domains"."created_by_id" is null and "workspace_domains"."created_by_member_id" is null)
      or ("workspace_domains"."created_by_type" = 'system' and "workspace_domains"."created_by_id" is null and "workspace_domains"."created_by_member_id" is null)
      or ("workspace_domains"."created_by_type" = 'member' and "workspace_domains"."created_by_id" is not null and "workspace_domains"."created_by_member_id" = "workspace_domains"."created_by_id")
      or ("workspace_domains"."created_by_type"::text not in ('member', 'system', 'calendar') and "workspace_domains"."created_by_id" is not null and "workspace_domains"."created_by_member_id" is null)),
	CONSTRAINT "workspace_domains_updated_by_actor" CHECK (("workspace_domains"."updated_by_type" is null and "workspace_domains"."updated_by_id" is null and "workspace_domains"."updated_by_member_id" is null)
      or ("workspace_domains"."updated_by_type" = 'system' and "workspace_domains"."updated_by_id" is null and "workspace_domains"."updated_by_member_id" is null)
      or ("workspace_domains"."updated_by_type" = 'member' and "workspace_domains"."updated_by_id" is not null and "workspace_domains"."updated_by_member_id" = "workspace_domains"."updated_by_id")
      or ("workspace_domains"."updated_by_type"::text not in ('member', 'system', 'calendar') and "workspace_domains"."updated_by_id" is not null and "workspace_domains"."updated_by_member_id" is null)),
	CONSTRAINT "workspace_domains_domain" CHECK ("workspace_domains"."domain" = lower("workspace_domains"."domain") and "workspace_domains"."domain" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' and char_length("workspace_domains"."domain") <= 253)
);
--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_decided_by" FOREIGN KEY ("workspace_id","decided_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_domains" ADD CONSTRAINT "workspace_domains_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_domains" ADD CONSTRAINT "workspace_domains_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_domains" ADD CONSTRAINT "workspace_domains_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "join_requests_open" ON "join_requests" USING btree ("workspace_id","user_id") WHERE "join_requests"."status" = 'open';--> statement-breakpoint
CREATE INDEX "join_requests_open_list" ON "join_requests" USING btree ("workspace_id","created_at","id") WHERE "join_requests"."status" = 'open';--> statement-breakpoint
CREATE INDEX "join_requests_user" ON "join_requests" USING btree ("workspace_id","user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "workspace_domains_domain_lookup" ON "workspace_domains" USING btree ("domain");
--> statement-breakpoint
alter table workspace_domains enable row level security;
--> statement-breakpoint
alter table workspace_domains force row level security;
--> statement-breakpoint
create policy workspace_domains_tenant on workspace_domains
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table join_requests enable row level security;
--> statement-breakpoint
alter table join_requests force row level security;
--> statement-breakpoint
create policy join_requests_tenant on join_requests
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- The lookup's role: no login, no power but reading two columns of workspace_domains past row level security.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_domain_lookup') then
    create role crm_domain_lookup nologin nosuperuser bypassrls nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$$;
--> statement-breakpoint
alter role crm_domain_lookup nologin bypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant usage on schema public to crm_domain_lookup;
--> statement-breakpoint
grant select (workspace_id, domain) on workspace_domains to crm_domain_lookup;
--> statement-breakpoint

-- The workspaces whose people at this domain may ask to join, or none. Ids only: the workspace's name, whether it
-- is live, and the person's standing are read by the caller inside withWorkspace() under row level security.
create function crm_workspaces_by_domain(domain text)
  returns table (workspace_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 5
begin atomic
  select d.workspace_id
  from public.workspace_domains d
  where d.domain = pg_catalog.lower(crm_workspaces_by_domain.domain)
  order by d.workspace_id
  limit 50;
end;
--> statement-breakpoint

-- Whether one workspace lets people at this domain ask to join: the request path's check, so a workspace past the
-- list's cap of 50 is still answered exactly.
create function crm_workspace_has_domain(workspace_id uuid, domain text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select exists (
    select 1 from public.workspace_domains d
    where d.workspace_id = crm_workspace_has_domain.workspace_id
      and d.domain = pg_catalog.lower(crm_workspace_has_domain.domain)
  );
end;
--> statement-breakpoint
revoke all on function crm_workspaces_by_domain(text) from public;
--> statement-breakpoint
revoke all on function crm_workspace_has_domain(uuid, text) from public;
--> statement-breakpoint
grant execute on function crm_workspaces_by_domain(text) to crm_app;
--> statement-breakpoint
grant execute on function crm_workspace_has_domain(uuid, text) to crm_app;
--> statement-breakpoint
grant crm_domain_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_domain_lookup;
--> statement-breakpoint
alter function crm_workspaces_by_domain(text) owner to crm_domain_lookup;
--> statement-breakpoint
alter function crm_workspace_has_domain(uuid, text) owner to crm_domain_lookup;
--> statement-breakpoint
revoke create on schema public from crm_domain_lookup;
--> statement-breakpoint
revoke crm_domain_lookup from current_user;
--> statement-breakpoint

-- Refuse to finish unless the lookup is as narrow as it reads.
do $$
begin
  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.crm_workspaces_by_domain(text)'::regprocedure, 'public.crm_workspace_has_domain(uuid, text)'::regprocedure)
      and pg_get_userbyid(p.proowner) <> 'crm_domain_lookup'
  ) or exists (
    select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.oid in ('public.crm_workspaces_by_domain(text)'::regprocedure, 'public.crm_workspace_has_domain(uuid, text)'::regprocedure)
      and a.privilege_type = 'EXECUTE'
      and a.grantee not in ('crm_domain_lookup'::regrole, 'crm_app'::regrole)
  ) or has_function_privilege('crm_identity', 'public.crm_workspaces_by_domain(text)', 'EXECUTE')
    or has_function_privilege('crm_identity', 'public.crm_workspace_has_domain(uuid, text)', 'EXECUTE') then
    raise exception 'the domain lookups must be owned by crm_domain_lookup and executable by crm_app alone';
  end if;
  if exists (
    select 1 from pg_auth_members m where m.member = 'crm_domain_lookup'::regrole
  ) or pg_has_role('crm_app', 'crm_domain_lookup', 'MEMBER')
    or pg_has_role('crm_identity', 'crm_domain_lookup', 'MEMBER')
    or exists (
      select 1 from pg_roles
      where rolname = 'crm_domain_lookup'
        and (rolsuper or rolreplication or rolcreatedb or rolcreaterole or rolcanlogin or not rolbypassrls)
    ) then
    raise exception 'crm_domain_lookup must be a plain role in no role';
  end if;
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(privilege)
    where c.relkind in ('r', 'p', 'v', 'm', 'f')
      and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_toast%'
      and has_table_privilege('crm_domain_lookup', c.oid, p.privilege)
  ) or exists (
    select 1
    from pg_attribute att
    cross join lateral aclexplode(att.attacl) a
    where a.grantee = 'crm_domain_lookup'::regrole
      and not (att.attrelid = 'public.workspace_domains'::regclass
        and att.attname in ('workspace_id', 'domain')
        and a.privilege_type = 'SELECT')
  ) then
    raise exception 'crm_domain_lookup may only read two columns of workspace_domains';
  end if;
end
$$;
