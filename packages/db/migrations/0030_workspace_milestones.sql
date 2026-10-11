-- The milestones a workspace reaches once (spec 0010, AC-177): the source of truth for the product counts PostHog
-- charts. The table is drizzle-kit's; row level security, the grants and the closing check are hand written.
--
-- The foreign key briefly locks workspaces against writes: give up after 5 seconds rather than queue behind
-- traffic, like 0009, 0011, 0019 and 0020.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "workspace_milestones" (
	"workspace_id" uuid NOT NULL,
	"milestone" text NOT NULL,
	"reached_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_milestones_pkey" PRIMARY KEY("workspace_id","milestone"),
	CONSTRAINT "workspace_milestones_milestone" CHECK ("workspace_milestones"."milestone" in ('workspace_created', 'first_record_created'))
);
--> statement-breakpoint
ALTER TABLE "workspace_milestones" ADD CONSTRAINT "workspace_milestones_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table workspace_milestones enable row level security;
--> statement-breakpoint
alter table workspace_milestones force row level security;
--> statement-breakpoint
create policy workspace_milestones_tenant on workspace_milestones
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- A milestone is reached once and never changed: the app reads and inserts it, nothing more (the default
-- privileges would grant update and delete too). A row goes only with its workspace, by the cascade.
revoke all on workspace_milestones from crm_app;
--> statement-breakpoint
grant select, insert on workspace_milestones to crm_app;
--> statement-breakpoint

-- Refuse to finish if the table reaches anyone but the owner (or a role whose privileges the owner already holds,
-- like Neon's neon_superuser) and the app, or the app holds anything but select and insert.
do $$
declare
  milestones regclass := 'public.workspace_milestones'::regclass;
  table_owner oid := (select relowner from pg_class where oid = 'public.workspace_milestones'::regclass);
begin
  if exists (
    select 1
    from pg_class c, aclexplode(c.relacl) a
    where c.oid = milestones
      and case
        -- PUBLIC
        when a.grantee = 0 then true
        when a.grantee = table_owner then false
        when a.grantee = 'crm_app'::regrole then a.privilege_type not in ('SELECT', 'INSERT')
        else not pg_has_role(table_owner, a.grantee, 'USAGE')
      end
  ) or not has_table_privilege('crm_app', milestones, 'SELECT')
    or not has_table_privilege('crm_app', milestones, 'INSERT') then
    raise exception 'workspace_milestones must reach the owner and crm_app (select, insert) only';
  end if;
end
$$;
