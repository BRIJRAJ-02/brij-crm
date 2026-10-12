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

-- A milestone is reached once and never changed: the app reads it, and inserts only its workspace and name, so
-- reached_at is always the reaching transaction's own time (the default privileges would grant update, delete
-- and an insert of any column). A row goes only with its workspace, by the cascade.
revoke all on workspace_milestones from crm_app;
--> statement-breakpoint
grant select on workspace_milestones to crm_app;
--> statement-breakpoint
grant insert (workspace_id, milestone) on workspace_milestones to crm_app;
--> statement-breakpoint

-- Refuse to finish if the table or any of its columns reaches anyone but the owner (or a role whose privileges the
-- owner already holds, like Neon's neon_superuser) and the app, or the app holds anything but select on the table
-- and insert on workspace_id and milestone.
do $$
declare
  milestones regclass := 'public.workspace_milestones'::regclass;
  table_owner oid := (select relowner from pg_class where oid = 'public.workspace_milestones'::regclass);
begin
  if exists (
    select 1
    from (
      select a.grantee, a.privilege_type, null::name as column_name
      from pg_class c, aclexplode(c.relacl) a
      where c.oid = milestones
      union all
      select a.grantee, a.privilege_type, att.attname
      from pg_attribute att, aclexplode(att.attacl) a
      where att.attrelid = milestones and att.attnum > 0 and not att.attisdropped
    ) g
    where case
      -- PUBLIC
      when g.grantee = 0 then true
      when g.grantee = table_owner then false
      when g.grantee = 'crm_app'::regrole then
        case
          when g.column_name is null then g.privilege_type <> 'SELECT'
          else g.privilege_type <> 'INSERT' or g.column_name not in ('workspace_id', 'milestone')
        end
      else not pg_has_role(table_owner, g.grantee, 'USAGE')
    end
  ) or not has_table_privilege('crm_app', milestones, 'SELECT')
    or not has_column_privilege('crm_app', milestones, 'workspace_id', 'INSERT')
    or not has_column_privilege('crm_app', milestones, 'milestone', 'INSERT') then
    raise exception 'workspace_milestones must reach the owner, and crm_app (select; insert of workspace_id and milestone) only';
  end if;
end
$$;
