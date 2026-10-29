-- The workspace booking link (team scheduling brief, decision 3, 30 Oct 2026): a round robin booking page that
-- belongs to the workspace, not to a person, whose hosts are one rotation, "Everyone on the roster", that follows
-- membership.
--
-- `booking_pages.scope`: `member` (every page until now) or `workspace`. A workspace page is always round robin.
-- Its `owner_member_id` stays as who made it, for history; nothing manages, addresses or pauses it by that column.
-- Its `owner_user_id` is always null (the trigger below), and every handle, profile, link page and slug history
-- function finds pages by `owner_user_id`, so a workspace page is never on anyone's profile or `/<handle>/<slug>`.
-- Its slug is unique among the workspace's own pages instead, kept for a later `/<workspace>/<slug>` address.
--
-- `rotations.follows`: null for a rotation of chosen people, `everyone` for the workspace's one rotation of every
-- active member who isn't a guest. Its members are worked out on every read (`rotation_roster`), never stored, so a
-- new member is bookable at once and a removed member or a guest is never offered. A `rotation_members` row on it
-- only holds that person's own settings (switched off, weight, priority, caps, calibration).
alter table "booking_pages" add column "scope" text default 'member' not null;
--> statement-breakpoint
alter table "booking_pages" add constraint "booking_pages_scope" check ("booking_pages"."scope" in ('member', 'workspace'));
--> statement-breakpoint
alter table "booking_pages" add constraint "booking_pages_scope_kind" check ("booking_pages"."scope" = 'member' or "booking_pages"."kind" = 'round_robin');
--> statement-breakpoint
drop index if exists "booking_pages_slug";
--> statement-breakpoint
create unique index "booking_pages_slug" on "booking_pages" using btree ("workspace_id","owner_member_id","slug") where "booking_pages"."deleted_at" is null and "booking_pages"."scope" = 'member';
--> statement-breakpoint
create unique index "booking_pages_workspace_slug" on "booking_pages" using btree ("workspace_id","slug") where "booking_pages"."deleted_at" is null and "booking_pages"."scope" = 'workspace';
--> statement-breakpoint
-- The owner's identity, from the owner member's row, as before; none for a workspace page, which is nobody's.
create or replace function crm_booking_pages_owner_user()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $function$
begin
  if new.scope = 'workspace' then
    new.owner_user_id := null;
    return new;
  end if;
  select m.user_id into new.owner_user_id
  from public.members m
  where m.workspace_id = new.workspace_id and m.id = new.owner_member_id;
  return new;
end;
$function$;
--> statement-breakpoint
alter table "rotations" add column "follows" text;
--> statement-breakpoint
alter table "rotations" add constraint "rotations_follows" check ("rotations"."follows" is null or "rotations"."follows" = 'everyone');
--> statement-breakpoint
create unique index "rotations_everyone" on "rotations" using btree ("workspace_id") where "rotations"."follows" = 'everyone' and "rotations"."deleted_at" is null;
--> statement-breakpoint
-- Who is in each rotation: its stored members, or, for the everyone rotation, every active owner, admin and member
-- with their stored settings when they have any. `joins_late` marks someone in the everyone rotation with no row who
-- joined the workspace after the rotation was made: they start at the pool's average (spec 0029, AC-730), where the
-- people there from the start begin at 0. Read with the reader's own row level security.
create view rotation_roster with (security_invoker = true) as
  select rm.workspace_id, rm.rotation_id, rm.member_id, rm.weight, rm.priority, rm.daily_cap, rm.weekly_cap,
    rm.is_on, rm.calibration, rm.position, true as stored, false as joins_late
  from rotation_members rm
  join rotations r on r.workspace_id = rm.workspace_id and r.id = rm.rotation_id
  where r.follows is null
  union all
  select r.workspace_id, r.id as rotation_id, m.id as member_id, coalesce(rm.weight, 100::smallint) as weight,
    coalesce(rm.priority, 2::smallint) as priority, rm.daily_cap, rm.weekly_cap, coalesce(rm.is_on, true) as is_on,
    coalesce(rm.calibration, 0) as calibration, coalesce(rm.position, 0::smallint) as position,
    rm.member_id is not null as stored, rm.member_id is null and m.created_at > r.created_at as joins_late
  from rotations r
  join members m on m.workspace_id = r.workspace_id and m.status = 'active'
    and m.role::text in ('owner', 'admin', 'member')
  left join rotation_members rm on rm.workspace_id = r.workspace_id and rm.rotation_id = r.id and rm.member_id = m.id
  where r.follows = 'everyone';
--> statement-breakpoint
-- A view is read only; the default privileges would grant writes too.
revoke all on rotation_roster from crm_app;
--> statement-breakpoint
grant select on rotation_roster to crm_app;
