-- The guest role (spec 0031, slice 9, AC-828): someone outside the team who sees only what the access rules share
-- with them, holds no permission, takes no seat, and can't host. Added last, so `owner`, `admin`, `member` keep
-- their order. Nothing in this batch uses the value as an enum, so it may be added inside the migration's
-- transaction (the function below compares the role as text).
ALTER TYPE "public"."member_role" ADD VALUE IF NOT EXISTS 'guest';
--> statement-breakpoint
-- A guest has no link page (late trap #77): `crm_workspace_member`, which every link page function asks (the public
-- page by handle, its blocks, counts and views, and every edit), now answers false for a guest. So a member made a
-- guest has their page hidden at once, by its address and in every read, and no edit or new page is made for them,
-- while its rows stay: made a member again, the same page is back as it was. Same owner, grants and signature. The
-- reader gains the one column it now reads, `members.role`, beside the ids and status it already held (0086).
grant select (role) on members to crm_booking_lookup;
--> statement-breakpoint
grant crm_booking_lookup to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_booking_lookup;
--> statement-breakpoint
set local role crm_booking_lookup;
--> statement-breakpoint
create or replace function crm_workspace_member(owner uuid, workspace uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
begin atomic
  select exists (
    select 1
    from public.members m
    join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = crm_workspace_member.workspace
      and m.user_id = crm_workspace_member.owner
      and m.status = 'active'
      and m.role::text <> 'guest'
      and w.deleted_at is null
  );
end;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_booking_lookup;
--> statement-breakpoint
revoke crm_booking_lookup from current_user;
