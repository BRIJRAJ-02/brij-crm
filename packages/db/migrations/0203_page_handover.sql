-- A page only person's page handed over, and removed managed pages purged (spec 0070 leftovers, 9 Nov 2026).
--
-- 1. `invitations.member_id`: an email invitation that hands a page only person's page to whoever accepts it (Team
--    pages › Invite to manage their page). Accepting it makes the person's own identity a login at the invited
--    address, so they stay the same member, with their page, handle and history. Only an email invitation for the
--    Member role, with no custom role, names one; at most one open invitation names each member. The member row is
--    never deleted (the purge below keeps it, nameable, with its link to the identity cleared), so the foreign key
--    restricts.
--
-- 2. `crm_purge_managed_page(user_id)`: the daily cleanup's purge of a managed person (a partner's or a page only one)
--    removed more than 30 days ago (AC-7022: "their page's content stays for 30 days"). crm_handle's definer, for
--    crm_app, in the caller's own workspace (`app.workspace_id`) only, and only for an identity a partner or Team pages
--    made for this workspace (`auth.managed_users`) whose `managed_members` row here was removed more than 30 days ago,
--    with no member row here that isn't removed and no active membership (`crm_workspace_member`): a guest, a member
--    made again, or anyone in a workspace inside its restore window is never touched. It deletes the page (its blocks,
--    their presses by cascade, its counts, the page row and, by cascade, its pictures' rows and their counts) and their
--    page's social links (a managed identity belongs to one workspace), and lets the handle go as a deleted account's
--    goes: the person cleared, so 0122's trigger stamps `released_at`, and the daily sweep frees it 90 days on (late
--    trap #73). It answers the stored files the page named (its pictures, photo, cover and background), for the caller
--    to remove from the store before it commits, after one row with no path that says it passed its checks (no rows:
--    refused, nothing deleted). crm_handle gets delete on the page row and the columns of `auth.managed_users`,
--    `managed_members` and `members` it reads, nothing more.
--
-- Postgres 17 compatible. Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "member_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_member_shape" CHECK (
  "member_id" IS NULL OR ("kind" = 'email' AND "role" = 'member' AND "custom_role_id" IS NULL)
);--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_open_member" ON "invitations" USING btree ("workspace_id","member_id") WHERE "status" = 'open' AND "member_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "invitations_member_ix" ON "invitations" USING btree ("workspace_id","member_id") WHERE "member_id" IS NOT NULL;
--> statement-breakpoint
grant delete on auth.public_profiles to crm_handle;
--> statement-breakpoint
grant select (user_id, workspace_id) on auth.managed_users to crm_handle;
--> statement-breakpoint
grant select (workspace_id, user_id, removed_at) on public.managed_members to crm_handle;
--> statement-breakpoint
grant select (workspace_id, user_id, status) on public.members to crm_handle;
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set role crm_handle;
--> statement-breakpoint
create function crm_purge_managed_page(person uuid)
  returns table (path text)
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  workspace uuid := nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid;
begin
  if workspace is null or person is null then
    return;
  end if;
  -- Only an identity a partner or Team pages made for this workspace, removed from it more than 30 days ago, and no
  -- member here in any other way (a guest, made a member again, a workspace in its restore window).
  if not exists (
    select 1 from auth.managed_users mu where mu.user_id = person and mu.workspace_id = workspace
  ) or not exists (
    select 1 from public.managed_members mm
    where mm.workspace_id = workspace and mm.user_id = person
      and mm.removed_at < pg_catalog.now() - interval '30 days'
  ) or exists (
    select 1 from public.members m where m.workspace_id = workspace and m.user_id = person and m.status <> 'removed'
  ) or public.crm_workspace_member(person, workspace) then
    return;
  end if;
  -- It passed: one row with no path says so, then the files its rows name, read before the rows go, for the caller to
  -- remove from the store before it commits.
  return query select null::text;
  return query
    select m.path from auth.profile_images m where m.user_id = person and m.workspace_id = workspace
    union
    select f.path from auth.public_profiles p
      cross join lateral (values (p.avatar_path), (p.cover_path), (p.ground_path)) as f(path)
    where p.user_id = person and p.workspace_id = workspace and f.path is not null;
  delete from auth.profile_items i where i.user_id = person and i.workspace_id = workspace;
  delete from auth.profile_views v where v.user_id = person and v.workspace_id = workspace;
  delete from auth.profile_view_days d where d.user_id = person and d.workspace_id = workspace;
  delete from auth.public_profiles p where p.user_id = person and p.workspace_id = workspace;
  delete from auth.social_links s where s.user_id = person;
  -- Held 90 days, then free (0122): never handed to the next person with the same name at once.
  update auth.public_handles h set user_id = null
  where h.user_id = person and h.workspace_id = workspace;
end;
$$;
--> statement-breakpoint
revoke all on function crm_purge_managed_page(uuid) from public;
--> statement-breakpoint
grant execute on function crm_purge_managed_page(uuid) to crm_app;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
--> statement-breakpoint
do $$
begin
  if exists (
    select 1 from pg_proc p
    where p.oid = 'public.crm_purge_managed_page(uuid)'::regprocedure
      and (pg_catalog.pg_get_userbyid(p.proowner) <> 'crm_handle' or not p.prosecdef
        or not ('search_path=pg_catalog, pg_temp' = any (coalesce(p.proconfig, array[]::text[]))))
  )
    or exists (
      select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid = 'public.crm_purge_managed_page(uuid)'::regprocedure
        and a.grantee not in ('crm_handle'::regrole, 'crm_app'::regrole)
    )
    or has_table_privilege('crm_handle', 'auth.managed_users', 'INSERT')
    or has_table_privilege('crm_handle', 'auth.managed_users', 'UPDATE')
    or has_table_privilege('crm_handle', 'auth.managed_users', 'DELETE')
    or has_column_privilege('crm_handle', 'auth.managed_users', 'partner_id', 'SELECT')
    or has_column_privilege('crm_handle', 'auth.managed_users', 'external_id', 'SELECT')
    or has_table_privilege('crm_handle', 'public.managed_members', 'INSERT')
    or has_table_privilege('crm_handle', 'public.managed_members', 'UPDATE')
    or has_table_privilege('crm_handle', 'public.managed_members', 'DELETE')
    or has_table_privilege('crm_handle', 'public.members', 'INSERT')
    or has_table_privilege('crm_handle', 'public.members', 'UPDATE')
    or has_table_privilege('crm_handle', 'public.members', 'DELETE')
    or has_table_privilege('crm_app', 'auth.public_profiles', 'DELETE') then
    raise exception 'the managed page purge must be crm_handle''s definer, reaching only what it needs';
  end if;
end
$$;
