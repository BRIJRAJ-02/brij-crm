-- Rotations that follow a team (spec 0037, AC-1327, AC-1442; lane L3b): the way the everyone rotation follows the
-- workspace (migration 0128), a rotation may follow one team. `rotations.follows = 'team'` names it in
-- `follows_team_id`; its members are the team's active owners, admins and members, worked out on every read through
-- `rotation_roster`, so a joiner is bookable at once and a leaver never, with nothing copied when the team changes and
-- no 20 member cap. A `rotation_members` row on it holds only that person's own settings; leaving the team deletes
-- it (`changeTeamMembers`), so rejoining starts afresh.
--
-- Someone with no row is switched on when they have hours or a calendar (spec 0029's warning otherwise). Once the
-- rotation has given out work, everyone switched on has a row (`keepRosterRows` stores them all under the rotation's
-- lock before each ledger row), so someone with no row then arrived since: they start at the pool's average
-- (`joins_late`, spec 0029, AC-730), never at 0.
alter table "rotations" add column "follows_team_id" uuid;
--> statement-breakpoint
alter table "rotations" drop constraint "rotations_follows";
--> statement-breakpoint
alter table "rotations" add constraint "rotations_follows" check (
  ("rotations"."follows" is null and "rotations"."follows_team_id" is null)
  or ("rotations"."follows" = 'everyone' and "rotations"."follows_team_id" is null)
  or ("rotations"."follows" = 'team' and "rotations"."follows_team_id" is not null)
);
--> statement-breakpoint
-- A team a rotation follows can't go (spec 0031 AC-826 as widened: `deleteTeam` answers TEAM_IN_USE first).
alter table "rotations" add constraint "rotations_follows_team" foreign key ("workspace_id", "follows_team_id")
  references "teams" ("workspace_id", "id") on delete restrict;
--> statement-breakpoint
-- The rotations following a team: a membership change's leavers, a team's delete guard, and the foreign key's check.
create index "rotations_by_team" on "rotations" using btree ("workspace_id", "follows_team_id")
  where "rotations"."follows_team_id" is not null;
--> statement-breakpoint
create or replace view rotation_roster with (security_invoker = true) as
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
  where r.follows = 'everyone'
  union all
  select r.workspace_id, r.id as rotation_id, m.id as member_id, coalesce(rm.weight, 100::smallint) as weight,
    coalesce(rm.priority, 2::smallint) as priority, rm.daily_cap, rm.weekly_cap,
    coalesce(
      rm.is_on,
      exists (select 1 from availability_schedules h where h.workspace_id = m.workspace_id and h.member_id = m.id)
        or exists (
          select 1 from calendar_connections c
          where c.workspace_id = m.workspace_id and c.member_id = m.id and c.status in ('syncing', 'connected')
        )
    ) as is_on,
    coalesce(rm.calibration, 0) as calibration, coalesce(rm.position, 0::smallint) as position,
    rm.member_id is not null as stored,
    rm.member_id is null and exists (
      select 1 from rotation_assignments a
      where a.workspace_id = r.workspace_id and a.rotation_id = r.id and a.voided_at is null
    ) as joins_late
  from rotations r
  join team_members tm on tm.workspace_id = r.workspace_id and tm.team_id = r.follows_team_id
  join members m on m.workspace_id = tm.workspace_id and m.id = tm.member_id and m.status = 'active'
    and m.role::text in ('owner', 'admin', 'member')
  left join rotation_members rm on rm.workspace_id = r.workspace_id and rm.rotation_id = r.id and rm.member_id = m.id
  where r.follows = 'team';
--> statement-breakpoint
-- A view is read only; the default privileges would grant writes too. `create or replace` keeps the grants it had.
revoke all on rotation_roster from crm_app;
--> statement-breakpoint
grant select on rotation_roster to crm_app;
