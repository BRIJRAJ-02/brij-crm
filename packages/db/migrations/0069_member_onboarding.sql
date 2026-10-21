-- First run's About you answers (spec 0036): a member's role, team size and the areas they mean to use, one row per
-- member, written with the workspace they start. The table is drizzle-kit's; row level security and the grants are
-- hand written. Never shown to other members: the app can't read it at all yet.
--
-- The foreign key briefly locks members against writes: give up after 5 seconds rather than queue behind traffic.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "member_onboarding" (
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"answers" jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_onboarding_pkey" PRIMARY KEY("workspace_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "member_onboarding" ADD CONSTRAINT "member_onboarding_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table member_onboarding enable row level security;
--> statement-breakpoint
alter table member_onboarding force row level security;
--> statement-breakpoint
create policy member_onboarding_tenant on member_onboarding
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- Written once: the app may only insert the three columns (created_at is always the inserting transaction's time),
-- never read, change or delete a row (the default privileges would grant all of it). Nothing reads the answers yet;
-- the read that comes with them gets a grant and a door entry for the reader's own row only.
revoke all on member_onboarding from crm_app;
--> statement-breakpoint
grant insert (workspace_id, member_id, answers) on member_onboarding to crm_app;
--> statement-breakpoint

-- Refuse to finish if the table or any of its columns reaches anyone but the owner (or a role whose privileges the
-- owner already holds, like Neon's neon_superuser) and the app, or the app holds anything but insert on
-- workspace_id, member_id and answers.
do $$
declare
  onboarding regclass := 'public.member_onboarding'::regclass;
  table_owner oid := (select relowner from pg_class where oid = 'public.member_onboarding'::regclass);
begin
  if exists (
    select 1
    from (
      select a.grantee, a.privilege_type, null::name as column_name
      from pg_class c, aclexplode(c.relacl) a
      where c.oid = onboarding
      union all
      select a.grantee, a.privilege_type, att.attname
      from pg_attribute att, aclexplode(att.attacl) a
      where att.attrelid = onboarding and att.attnum > 0 and not att.attisdropped
    ) g
    where case
      -- PUBLIC
      when g.grantee = 0 then true
      when g.grantee = table_owner then false
      when g.grantee = 'crm_app'::regrole then
        g.column_name is null
          or g.privilege_type <> 'INSERT'
          or g.column_name not in ('workspace_id', 'member_id', 'answers')
      else not pg_has_role(table_owner, g.grantee, 'USAGE')
    end
  ) or has_table_privilege('crm_app', onboarding, 'SELECT')
    or not has_column_privilege('crm_app', onboarding, 'workspace_id', 'INSERT')
    or not has_column_privilege('crm_app', onboarding, 'member_id', 'INSERT')
    or not has_column_privilege('crm_app', onboarding, 'answers', 'INSERT') then
    raise exception 'member_onboarding must reach the owner, and crm_app (insert of workspace_id, member_id and answers) only';
  end if;
end
$$;
