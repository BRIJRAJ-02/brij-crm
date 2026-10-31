-- Custom domains for link pages (spec 0064, slice 1, AC-6401 to AC-6409): `public_domains`, one row per host a
-- person asked for, tied to their link page in one workspace. Spec 0064 keys the row by the page's own id
-- (`profile_id`, lane P1); until P1 lands a page is still (user_id, workspace_id), so the row carries those two and
-- the member, and P1's migration adds `profile_id` beside them.
--
-- Ownership is proved by a TXT record before anything else happens (`verify_token`), so a host is bound, and added to
-- the Vercel project, only for whoever controls its DNS. Until then several people may ask for the same host, each
-- with their own token; once one proves it (`verified_at`), the host is theirs alone (`public_domains_host_bound`),
-- so nobody can block a host by asking for it first.
--
-- One new, empty table: no lock on anything that holds rows. The standard tenant policy, forced (the guard tests).
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "public_domains" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"member_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"host" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"verify_token" text NOT NULL,
	"dns_records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"problem" text,
	"waiting_since" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp (6) with time zone,
	"live_at" timestamp (6) with time zone,
	"last_checked_at" timestamp (6) with time zone,
	"removed_at" timestamp (6) with time zone,
	"detached_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_domains_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "public_domains_host" CHECK (char_length("public_domains"."host") between 4 and 253 and "public_domains"."host" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
	CONSTRAINT "public_domains_kind" CHECK ("public_domains"."kind" in ('apex', 'subdomain')),
	CONSTRAINT "public_domains_status" CHECK ("public_domains"."status" in ('waiting', 'checking', 'live', 'attention', 'failed', 'removed')),
	CONSTRAINT "public_domains_token" CHECK ("public_domains"."verify_token" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "public_domains_records" CHECK (jsonb_typeof("public_domains"."dns_records") = 'array' and pg_column_size("public_domains"."dns_records") <= 8192),
	CONSTRAINT "public_domains_problem" CHECK (char_length("public_domains"."problem") <= 200),
	CONSTRAINT "public_domains_removed" CHECK (("public_domains"."status" = 'removed') = ("public_domains"."removed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "public_domains" ADD CONSTRAINT "public_domains_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "public_domains_one_per_page" ON "public_domains" USING btree ("workspace_id","user_id") WHERE "public_domains"."status" <> 'removed';--> statement-breakpoint
CREATE INDEX "public_domains_by_member" ON "public_domains" USING btree ("workspace_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_domains_host_bound" ON "public_domains" USING btree ("host") WHERE "public_domains"."verified_at" is not null and "public_domains"."status" <> 'removed';--> statement-breakpoint
-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table public_domains enable row level security;
--> statement-breakpoint
alter table public_domains force row level security;
--> statement-breakpoint
create policy public_domains_tenant on public_domains
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- The host lookups reach across workspaces, so they are narrow definers as 0093's calendar lookup is: owned by
-- crm_host_lookup, a role that can't log in, reads the columns below past row level security and nothing else, and
-- answers a handle or a boolean, never a workspace or a person. Only crm_app (the worker and the job drain are in
-- it) may call them. Hardened as crm_workspace_ids in 0034: a standard SQL body bound to its tables when made, a
-- fixed search_path, and every name qualified. Any change to the role or the functions goes through
-- security-access-reviewer.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_host_lookup') then
    create role crm_host_lookup nologin nosuperuser bypassrls nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$$;
--> statement-breakpoint
alter role crm_host_lookup nologin bypassrls nocreaterole noinherit password null;
--> statement-breakpoint
grant usage on schema public to crm_host_lookup;
--> statement-breakpoint
grant usage on schema auth to crm_host_lookup;
--> statement-breakpoint
grant select (workspace_id, id, user_id, host, status, verified_at) on public_domains to crm_host_lookup;
--> statement-breakpoint
grant select (workspace_id, user_id, status) on members to crm_host_lookup;
--> statement-breakpoint
grant select (id, deleted_at) on workspaces to crm_host_lookup;
--> statement-breakpoint
grant select (user_id, workspace_id, handle, shown_at) on auth.public_profiles to crm_host_lookup;
--> statement-breakpoint

-- The handle a custom host serves (AC-6404, AC-6406): only a live, proved host whose owner is still an active member
-- of a workspace that isn't deleted, and whose page is public. Null for every other host, whatever the reason, so a
-- miss reads the same however it missed.
create function crm_live_domain_handle(host text)
  returns text
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select p.handle
  from public.public_domains d
  join public.workspaces w on w.id = d.workspace_id and w.deleted_at is null
  join public.members m on m.workspace_id = d.workspace_id and m.user_id = d.user_id and m.status = 'active'
  join auth.public_profiles p on p.user_id = d.user_id and p.workspace_id = d.workspace_id and p.shown_at is not null
  where d.host = crm_live_domain_handle.host
    and d.verified_at is not null
    and d.status = 'live'
  limit 1;
end;
--> statement-breakpoint
revoke all on function crm_live_domain_handle(text) from public;
--> statement-breakpoint
grant execute on function crm_live_domain_handle(text) to crm_app;
--> statement-breakpoint

-- Whether a host is already proved by a row other than `mine` (AC-6408: "That domain is already in use."), in any
-- workspace. A boolean only: never whose, nor where.
create function crm_domain_host_bound(host text, mine uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select exists (
    select 1 from public.public_domains d
    where d.host = crm_domain_host_bound.host
      and d.verified_at is not null
      and d.status <> 'removed'
      and d.id is distinct from crm_domain_host_bound.mine
  );
end;
--> statement-breakpoint
revoke all on function crm_domain_host_bound(text, uuid) from public;
--> statement-breakpoint
grant execute on function crm_domain_host_bound(text, uuid) to crm_app;
--> statement-breakpoint

-- Hand both to crm_host_lookup. Postgres 16 and later don't give the creator SET on a role it creates, and a new owner
-- needs CREATE on the schema, so both are granted for the change, then taken back.
grant crm_host_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_host_lookup;
--> statement-breakpoint
alter function crm_live_domain_handle(text) owner to crm_host_lookup;
--> statement-breakpoint
alter function crm_domain_host_bound(text, uuid) owner to crm_host_lookup;
--> statement-breakpoint
revoke create on schema public from crm_host_lookup;
--> statement-breakpoint
revoke crm_host_lookup from current_user;
--> statement-breakpoint

-- The domain's next check (AC-6403, the `crm_domains_check` task): puts it on Graphile Worker's queue, as
-- crm_enqueue_scheduling_notice does, owned by the same crm_queue. It reads the row under the caller's workspace
-- setting (row level security still applies), and only a row still to check: one not removed, or a removed one
-- still attached to the Vercel project. It builds the queue row itself, so the caller chooses no task, payload or
-- queue: task crm_domains_check, payload the workspace and domain ids alone, job key crm-domain:<workspace>:<id>
-- with job_key_mode 'replace' (one waiting row per domain, at the time asked last), 5 attempts, run from 0 to a day
-- from now. Answers whether it queued.
grant select (workspace_id, id, status, verified_at, detached_at) on public_domains to crm_queue;
--> statement-breakpoint
create function crm_enqueue_domain_check(domain_id uuid, delay_seconds integer)
  returns boolean
  language sql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
as $function$
  with domain as (
    select d.workspace_id, d.id
    from public.public_domains d
    where d.id = crm_enqueue_domain_check.domain_id
      and d.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
      and (d.status <> 'removed' or (d.verified_at is not null and d.detached_at is null))
  ),
  added as materialized (
    select graphile_worker.add_job(
      identifier => 'crm_domains_check',
      payload => pg_catalog.json_build_object('workspaceId', domain.workspace_id, 'domainId', domain.id),
      run_at => pg_catalog.now()
        + least(greatest(coalesce(crm_enqueue_domain_check.delay_seconds, 0), 0), 86400)
          * interval '1 second',
      max_attempts => 5,
      job_key => 'crm-domain:' || domain.workspace_id::text || ':' || domain.id::text,
      job_key_mode => 'replace'
    ) as queued
    from domain
  )
  select count(*) = 1 from added;
$function$;
--> statement-breakpoint
revoke all on function crm_enqueue_domain_check(uuid, integer) from public;
--> statement-breakpoint
grant execute on function crm_enqueue_domain_check(uuid, integer) to crm_app;
--> statement-breakpoint
grant crm_queue to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_queue;
--> statement-breakpoint
alter function crm_enqueue_domain_check(uuid, integer) owner to crm_queue;
--> statement-breakpoint
revoke create on schema public from crm_queue;
--> statement-breakpoint
revoke crm_queue from current_user;
--> statement-breakpoint

-- Refuse to finish unless the lookups are as narrow as they read: owned by crm_host_lookup and executable by crm_app
-- alone (the identity login never), the role a plain one in no role and out of the app's and the identity login's
-- reach, reading the listed columns and nothing else.
do $$
begin
  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.crm_live_domain_handle(text)'::regprocedure, 'public.crm_domain_host_bound(text, uuid)'::regprocedure)
      and pg_get_userbyid(p.proowner) <> 'crm_host_lookup'
  ) or exists (
    select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.oid in ('public.crm_live_domain_handle(text)'::regprocedure, 'public.crm_domain_host_bound(text, uuid)'::regprocedure)
      and a.privilege_type = 'EXECUTE'
      and a.grantee not in ('crm_host_lookup'::regrole, 'crm_app'::regrole)
  ) or has_function_privilege('crm_identity', 'public.crm_live_domain_handle(text)', 'EXECUTE')
    or has_function_privilege('crm_identity', 'public.crm_domain_host_bound(text, uuid)', 'EXECUTE') then
    raise exception 'the host lookups must be owned by crm_host_lookup and executable by crm_app alone';
  end if;
  if exists (
    select 1 from pg_auth_members m where m.member = 'crm_host_lookup'::regrole
  ) or pg_has_role('crm_app', 'crm_host_lookup', 'MEMBER')
    or pg_has_role('crm_identity', 'crm_host_lookup', 'MEMBER')
    or exists (
      select 1 from pg_roles
      where rolname = 'crm_host_lookup'
        and (rolsuper or rolreplication or rolcreatedb or rolcreaterole or rolcanlogin or not rolbypassrls)
    ) then
    raise exception 'crm_host_lookup must be a plain role in no role';
  end if;
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(privilege)
    where c.relkind in ('r', 'p', 'v', 'm', 'f')
      and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_toast%'
      and has_table_privilege('crm_host_lookup', c.oid, p.privilege)
  ) or exists (
    select 1
    from pg_attribute att
    cross join lateral aclexplode(att.attacl) a
    where a.grantee = 'crm_host_lookup'::regrole
      and not (
        a.privilege_type = 'SELECT' and (
          (att.attrelid = 'public.public_domains'::regclass
            and att.attname in ('workspace_id', 'id', 'user_id', 'host', 'status', 'verified_at'))
          or (att.attrelid = 'public.members'::regclass and att.attname in ('workspace_id', 'user_id', 'status'))
          or (att.attrelid = 'public.workspaces'::regclass and att.attname in ('id', 'deleted_at'))
          or (att.attrelid = 'auth.public_profiles'::regclass
            and att.attname in ('user_id', 'workspace_id', 'handle', 'shown_at'))
        )
      )
  ) then
    raise exception 'crm_host_lookup may only read the columns its lookups name';
  end if;
end
$$;
