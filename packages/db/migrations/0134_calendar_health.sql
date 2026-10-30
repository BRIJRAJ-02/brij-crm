-- Calendar health for teams (spec 0037, job J8, AC-1310 and AC-1311). A connection that moves to `expired` (the grant
-- was refused) or `failed` (6 hours of errors) starts a broken episode, and its member gets two emails for it at most:
-- one when it starts and one reminder 7 days on if it is still broken. Three nullable times on calendar_connections
-- hold the episode: `health_broken_at` (when it began, also the episode's identity in the emails' keys),
-- `health_notified_at` (the first email queued) and `health_reminded_at` (the reminder queued).
--
-- The trigger crm_calendar_health_episode keeps them whatever code moves the status: the move into expired or failed
-- opens an episode when none is open (failed then expired is one episode), and the move to connected closes it,
-- clearing all three, so a later break is a new episode. A new grant closes it too: an expired or revoked connection
-- only syncs again once its member reconnected it, so its move to syncing ends the episode whether or not the first
-- sync then works. (A failed one retries by itself, so failed to syncing is the same episode.)
--
-- crm_calendar_health_candidates(max) is the sweep's read (the worker's `crm_cron_calendar_health`): across every
-- workspace, ids and counts only, the broken connections owed their first email or their reminder, oldest first and
-- first emails ahead of reminders, at most `max` (1 to 200), each row saying whether it is `fresh` (broke in the last
-- hour, no email yet: what a mass outage holds) and carrying the sweep's two counts: `checked` (every connection of an
-- active member in a live workspace, revoked ones aside) and `newly_broken` (the fresh ones; the hour is the hourly
-- floor's window on brij-crm, where the sweep runs once an hour). It reaches across workspaces, so it is
-- the worker's alone (crm_worker), owned by crm_sweep like crm_workspace_ids, with select on just the columns it reads.
--
-- Existing broken connections were already told by the sync's inline email, so their episodes start as notified, and
-- as reminded too once they are older than 7 days: no deploy sends a burst of first emails.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "health_broken_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "health_notified_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "health_reminded_at" timestamp (6) with time zone;--> statement-breakpoint
update calendar_connections set
  health_broken_at = coalesce(failing_since, updated_at),
  health_notified_at = coalesce(failing_since, updated_at),
  health_reminded_at = case when coalesce(failing_since, updated_at) <= now() - interval '7 days' then now() end
where status in ('expired', 'failed');
--> statement-breakpoint
create function crm_calendar_health_episode()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $function$
begin
  if new.status = 'connected'
    or (tg_op = 'UPDATE' and new.status = 'syncing' and old.status in ('expired', 'revoked')) then
    new.health_broken_at := null;
    new.health_notified_at := null;
    new.health_reminded_at := null;
  elsif new.status in ('expired', 'failed') and new.health_broken_at is null then
    new.health_broken_at := pg_catalog.now();
    new.health_notified_at := null;
    new.health_reminded_at := null;
  end if;
  return new;
end;
$function$;
--> statement-breakpoint
revoke all on function crm_calendar_health_episode() from public;
--> statement-breakpoint
create trigger calendar_connections_health_episode
  before insert or update of status on calendar_connections
  for each row execute function crm_calendar_health_episode();
--> statement-breakpoint
grant select (workspace_id, id, member_id, status, health_broken_at, health_notified_at, health_reminded_at)
  on calendar_connections to crm_sweep;
--> statement-breakpoint
create function crm_calendar_health_candidates(max integer)
  returns table (
    workspace_id uuid,
    connection_id uuid,
    episode timestamptz,
    reminder boolean,
    fresh boolean,
    checked integer,
    newly_broken integer
  )
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 200
begin atomic
  with live as (
    select c.workspace_id, c.id, c.status::text as status, c.health_broken_at, c.health_notified_at,
      c.health_reminded_at
    from public.calendar_connections c
    join public.members m on m.workspace_id = c.workspace_id and m.id = c.member_id
    join public.workspaces w on w.id = c.workspace_id
    where m.status = 'active' and w.deleted_at is null and c.status::text <> 'revoked'
  ),
  counts as (
    select pg_catalog.count(*)::integer as checked,
      (pg_catalog.count(*) filter (
        where l.status in ('expired', 'failed') and l.health_notified_at is null
          and l.health_broken_at > pg_catalog.now() - interval '1 hour'
      ))::integer as newly_broken
    from live l
  )
  select l.workspace_id, l.id, l.health_broken_at, l.health_notified_at is not null,
    l.health_notified_at is null and l.health_broken_at > pg_catalog.now() - interval '1 hour', k.checked,
    k.newly_broken
  from live l cross join counts k
  where l.status in ('expired', 'failed') and l.health_broken_at is not null
    and (
      l.health_notified_at is null
      or (l.health_reminded_at is null and l.health_notified_at <= pg_catalog.now() - interval '7 days')
    )
  order by l.health_notified_at is not null, l.health_broken_at, l.workspace_id, l.id
  limit least(greatest(crm_calendar_health_candidates.max, 1), 200);
end;
--> statement-breakpoint
revoke all on function crm_calendar_health_candidates(integer) from public;
--> statement-breakpoint
grant execute on function crm_calendar_health_candidates(integer) to crm_worker;
--> statement-breakpoint
grant crm_sweep to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_sweep;
--> statement-breakpoint
alter function crm_calendar_health_candidates(integer) owner to crm_sweep;
--> statement-breakpoint
revoke create on schema public from crm_sweep;
--> statement-breakpoint
revoke crm_sweep from current_user;
