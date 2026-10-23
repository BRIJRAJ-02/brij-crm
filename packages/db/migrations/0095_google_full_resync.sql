-- Every pulled Google calendar syncs in full once more (owner report of 23 October 2026). Google's adapter now counts
-- an invite's organiser as an attendee when only this calendar was invited, and this calendar as the organiser of
-- its own event that lists guests without it, so such an event is a meeting rather than a Busy block. An incremental
-- sync only reaches an event Google lists again, so one made before the fix and never changed since would stay
-- Busy. Dropping the stored syncToken makes the next run of each such calendar a full sync of its window (90 days
-- back, 180 ahead): every event there is written again, by its iCalendar UID and its copy's event id, so nothing
-- doubles; an event that is now a meeting leaves calendar_busy_times as it becomes one, and a copy the provider no
-- longer lists in the window is dropped, as after Google's own 410. Outlook calendars, and calendars neither synced
-- nor shown on the week, keep their state.
--
-- Hand written, data only. Migrations run as the owner, past row level security, so this reaches every workspace,
-- each row keeping its own. Row security off: a role it would filter fails here rather than clearing nothing, like
-- 0082 and 0090. A calendar with no token (never synced, or reset) is left as it is.
set local row_security = off;
--> statement-breakpoint
update calendar_calendars k
set sync_state = k.sync_state - 'syncToken'
from calendar_connections c
where c.workspace_id = k.workspace_id and c.id = k.connection_id
  and c.provider = 'google'
  and (k.sync or k.show_in_week)
  and k.sync_state ? 'syncToken';
