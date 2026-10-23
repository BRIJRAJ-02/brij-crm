// Which synced meetings the calendar reads show as events (spec 0025, the
// owner's report of 23 October 2026). A meeting a confirmed booking owns
// shows as that booking instead, and so does one the CRM made with no
// booking at all. A cancelled booking no longer owns anything: its event,
// still in the host's calendar, shows as an ordinary event beside the
// struck-through booking, so a meeting that lives in Google is never hidden.
import { sql, type SQL } from 'drizzle-orm';

/**
 * The calendar reads' rule for a meeting aliased `m` (Bookings' week, the
 * meetings list and Home's team today): true unless a confirmed booking owns
 * it (the meeting's `booking_id`, or a booking's `meeting_id`), or the CRM made
 * it and no booking points either way. Each check is an index lookup (the
 * bookings key and `bookings_by_meeting`).
 */
export function shownAsEvent(): SQL {
  return sql`not exists (
      select 1 from bookings o
      where o.workspace_id = m.workspace_id and o.id = m.booking_id and o.status = 'confirmed'
    )
    and not exists (
      select 1 from bookings o
      where o.workspace_id = m.workspace_id and o.meeting_id = m.id and o.status = 'confirmed'
    )
    and (
      not m.created_by_crm or m.booking_id is not null
      or exists (
        select 1 from bookings o
        where o.workspace_id = m.workspace_id and o.meeting_id is not null and o.meeting_id = m.id
      )
    )`;
}
