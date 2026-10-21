-- A workspace's sign in rules (spec 0033, milestone 4, AC-893, AC-894): `workspace_security`, one row per workspace,
-- made the first time an owner changes a rule (no row means none). Require two factor, how long a sign in lasts here,
-- and when everyone was last signed out of it. The access door reads it in its one tenant query. The standard tenant
-- policy, forced; drizzle-kit's table and keys, the policy hand written at the end.
--
-- Deleting an account closes the person's open join requests and blanks their name and address on every request
-- (spec 0031 slice 6, spec 0033 AC-905), in workspaces they never joined, so no member scope can find them:
-- crm_join_requests_of(user_id), owned by crm_domain_lookup (which now also reads two columns of join_requests past
-- row level security), answers the workspace ids holding a request of theirs and nothing else; the caller changes
-- each inside withWorkspace().
--
-- The foreign keys briefly lock the tables they touch. Give up after 5 seconds rather than queue behind traffic, like
-- 0055.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "workspace_security" (
	"workspace_id" uuid NOT NULL,
	"require_two_factor" boolean DEFAULT false NOT NULL,
	"session_length_days" integer,
	"sessions_valid_after" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "workspace_security_pkey" PRIMARY KEY("workspace_id"),
	CONSTRAINT "workspace_security_created_by_actor" CHECK (("workspace_security"."created_by_type" is null and "workspace_security"."created_by_id" is null and "workspace_security"."created_by_member_id" is null)
      or ("workspace_security"."created_by_type" = 'system' and "workspace_security"."created_by_id" is null and "workspace_security"."created_by_member_id" is null)
      or ("workspace_security"."created_by_type" = 'member' and "workspace_security"."created_by_id" is not null and "workspace_security"."created_by_member_id" = "workspace_security"."created_by_id")
      or ("workspace_security"."created_by_type"::text not in ('member', 'system', 'calendar') and "workspace_security"."created_by_id" is not null and "workspace_security"."created_by_member_id" is null)),
	CONSTRAINT "workspace_security_updated_by_actor" CHECK (("workspace_security"."updated_by_type" is null and "workspace_security"."updated_by_id" is null and "workspace_security"."updated_by_member_id" is null)
      or ("workspace_security"."updated_by_type" = 'system' and "workspace_security"."updated_by_id" is null and "workspace_security"."updated_by_member_id" is null)
      or ("workspace_security"."updated_by_type" = 'member' and "workspace_security"."updated_by_id" is not null and "workspace_security"."updated_by_member_id" = "workspace_security"."updated_by_id")
      or ("workspace_security"."updated_by_type"::text not in ('member', 'system', 'calendar') and "workspace_security"."updated_by_id" is not null and "workspace_security"."updated_by_member_id" is null)),
	CONSTRAINT "workspace_security_session_length" CHECK ("workspace_security"."session_length_days" is null or "workspace_security"."session_length_days" in (1, 7, 14, 30))
);
--> statement-breakpoint
ALTER TABLE "workspace_security" ADD CONSTRAINT "workspace_security_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_security" ADD CONSTRAINT "workspace_security_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_security" ADD CONSTRAINT "workspace_security_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
alter table workspace_security enable row level security;
--> statement-breakpoint
alter table workspace_security force row level security;
--> statement-breakpoint
create policy workspace_security_tenant on workspace_security
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
create index join_requests_by_user on join_requests using btree (user_id);
--> statement-breakpoint
grant select (workspace_id, user_id) on join_requests to crm_domain_lookup;
--> statement-breakpoint
-- The workspaces holding a join request of this person's, or none. Ids only.
create function crm_join_requests_of(user_id uuid)
  returns table (workspace_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 5
begin atomic
  select distinct j.workspace_id
  from public.join_requests j
  where j.user_id = crm_join_requests_of.user_id
  order by j.workspace_id
  limit 200;
end;
--> statement-breakpoint
revoke all on function crm_join_requests_of(uuid) from public;
--> statement-breakpoint
grant execute on function crm_join_requests_of(uuid) to crm_app;
--> statement-breakpoint
grant crm_domain_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_domain_lookup;
--> statement-breakpoint
alter function crm_join_requests_of(uuid) owner to crm_domain_lookup;
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
    where p.oid = 'public.crm_join_requests_of(uuid)'::regprocedure
      and pg_get_userbyid(p.proowner) <> 'crm_domain_lookup'
  ) or exists (
    select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.oid = 'public.crm_join_requests_of(uuid)'::regprocedure
      and a.privilege_type = 'EXECUTE'
      and a.grantee not in ('crm_domain_lookup'::regrole, 'crm_app'::regrole)
  ) or has_function_privilege('crm_identity', 'public.crm_join_requests_of(uuid)', 'EXECUTE') then
    raise exception 'crm_join_requests_of must be owned by crm_domain_lookup and executable by crm_app alone';
  end if;
end
$$;
