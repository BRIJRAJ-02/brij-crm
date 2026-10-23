// Writing a batch of synced events (spec 0024, Sync): one transaction per
// batch, set based, so a 5,000 event first sync is a few dozen statements per
// batch rather than a few per event. For each event of one connection: skip
// it by AC-605 (or drop this connection's copy when it was cancelled); else
// upsert the meeting by its iCalendar UID and original start (AC-603), this
// connection's source, the attendees (replaced), and the records it shows on
// (rewritten). A meeting goes with its last source. Every meeting touched
// lands in the change with every record it showed on before or after, so the
// outbox stores one `meetings` row for the batch (AC-610).
//
// Milestone 5: a batch is one calendar's, and a source is that calendar's
// copy. A calendar is pulled when it syncs meetings or shows on the member's
// week; only a meeting some syncing calendar holds (or that the CRM made)
// shows on records (AC-1002), and only a syncing calendar makes people for
// unknown attendees, so a calendar the member only shows on their week never
// reaches the CRM's records.
import { sql } from 'drizzle-orm';
import { EmailTimeZone } from '@crm/contracts/emails';
import type { WorkspaceTx } from '@crm/db';
import { queueEmails } from '../emails/queue.ts';
import { uuidList } from '../engine/ids.ts';
import type { MeetingChange, WriteContext } from '../engine/write.ts';
import {
  isBusyOnly,
  matchEvent,
  readLookups,
  recordsOf,
  shouldSync,
  textList,
  type AttendeeRow,
  type MeetingLink,
} from './match.ts';
import { createsUnknownPeople, fileUnknownAttendees } from './people.ts';
import type { ProviderEvent } from './provider.ts';

/** The calendar a batch syncs for: its connection, member and provider calendar id, and what it may do. */
export interface SyncedConnection {
  /** The connection's id. */
  readonly id: string;
  readonly memberId: string;
  /** The provider's calendar id. */
  readonly calendarId: string;
  /** Its meetings reach records (the calendar's Sync meetings, AC-1002). */
  readonly syncs: boolean;
  /** The event is one `createEvent` made (milestone 3): its copy is marked, and it shows on records. */
  readonly madeByCrm?: boolean;
}

/** The longest title, location and video link kept (the table's checks). */
const TITLE_MAX = 1024;
const LOCATION_MAX = 500;
const URL_MAX = 2048;

/** What an event with no title shows as. */
export const UNTITLED_MEETING = 'Untitled meeting';

/** A video link worth keeping: an http or https address of a sane length. */
function videoUrlOf(value: string | undefined): string | null {
  if (value === undefined || value.length > URL_MAX || !URL.canParse(value)) return null;
  const { protocol } = new URL(value);
  return protocol === 'https:' || protocol === 'http:' ? value : null;
}

/** A moment as Postgres takes it back, so a key built in JS and one read from a row agree. */
const moment = (iso: string) => new Date(iso).toISOString();

/** The key a meeting is one by (AC-603): its UID and, for a recurring instance, its original start. */
const keyOf = (icalUid: string, originalStart: string | null) => JSON.stringify([icalUid, originalStart]);

/** One meeting row to upsert, with what the batch learned about it. */
interface Planned {
  readonly key: string;
  readonly eventId: string;
  readonly etag: string | null;
  readonly markedPrivate: boolean;
  readonly row: {
    readonly k: string;
    readonly ical_uid: string;
    readonly original_start: string | null;
    readonly title: string;
    readonly starts_at: string;
    readonly ends_at: string;
    readonly all_day: boolean;
    readonly location: string | null;
    readonly video_url: string | null;
    readonly status: 'confirmed' | 'tentative';
    readonly organizer_email: string | null;
    readonly is_internal: boolean;
  };
  readonly attendees: readonly AttendeeRow[];
  readonly links: readonly MeetingLink[];
}

/**
 * Sets each meeting's `is_private` from its sources (AC-611, AC-612): true
 * when any holding connection is private, or any copy is marked private.
 */
export async function recomputePrivacy(tx: WorkspaceTx, meetingIds: readonly string[]): Promise<void> {
  if (meetingIds.length === 0) return;
  await tx.execute(sql`
    update meetings m set is_private = exists (
      select 1 from meeting_sources s
      join calendar_connections c on c.workspace_id = s.workspace_id and c.id = s.connection_id
      where s.workspace_id = m.workspace_id and s.meeting_id = m.id and (s.marked_private or c.sharing = 'private')
    )
    where m.id = any(${uuidList(meetingIds)})
  `);
}

/** A busy time's event id worth keeping: the table's bound. */
const EVENT_ID_MAX = 1024;

/**
 * Keeps the batch's busy only events (the owner's call, 20 October 2026) as
 * this connection's busy times, start and end only, and drops the busy time
 * of every other event in the batch (cancelled, declined, now with someone
 * invited, or shown as free).
 */
async function writeBusyTimes(context: WriteContext, calendar: SyncedConnection, events: readonly ProviderEvent[]) {
  const { tx } = context;
  const busy = new Map<string, { event_id: string; starts_at: string; ends_at: string }>();
  for (const event of events) {
    if (event.id.length > EVENT_ID_MAX) continue;
    if (!isBusyOnly(event) || event.start === undefined || event.end === undefined) {
      busy.delete(event.id);
      continue;
    }
    busy.set(event.id, { event_id: event.id, starts_at: moment(event.start.at), ends_at: moment(event.end.at) });
  }
  const others = events.map((event) => event.id).filter((id) => !busy.has(id));
  if (others.length > 0) {
    await tx.execute(sql`
      delete from calendar_busy_times
      where connection_id = ${calendar.id}::uuid and calendar_id = ${calendar.calendarId}
        and provider_event_id = any(${textList(others)})
    `);
  }
  if (busy.size === 0) return;
  await tx.execute(sql`
    insert into calendar_busy_times (workspace_id, connection_id, calendar_id, provider_event_id, starts_at, ends_at)
    select ${context.scope.workspaceId}::uuid, ${calendar.id}::uuid, ${calendar.calendarId}, x.event_id, x.starts_at,
      x.ends_at
    from jsonb_to_recordset(${JSON.stringify([...busy.values()])}::jsonb) as x(event_id text, starts_at timestamptz, ends_at timestamptz)
    on conflict (workspace_id, connection_id, calendar_id, provider_event_id) do update set
      starts_at = excluded.starts_at, ends_at = excluded.ends_at, updated_at = now()
  `);
}

/**
 * After a full sync: drops this calendar's busy times in the window whose
 * events the provider no longer listed; with `all`, every one it holds (it
 * stopped being pulled, or the provider removed it).
 */
export async function dropBusyTimes(
  tx: WorkspaceTx,
  connectionId: string,
  calendarId: string,
  where: { readonly allBut: readonly string[]; readonly from: string; readonly to: string } | 'all',
): Promise<void> {
  await tx.execute(
    where === 'all'
      ? sql`delete from calendar_busy_times where connection_id = ${connectionId}::uuid and calendar_id = ${calendarId}`
      : sql`
        delete from calendar_busy_times
        where connection_id = ${connectionId}::uuid and calendar_id = ${calendarId}
          and starts_at < ${where.to}::timestamptz and ends_at >= ${where.from}::timestamptz
          and not (provider_event_id = any(${textList(where.allBut)}))
      `,
  );
}

/**
 * Removes one calendar's copies of the events `eventIds` names (or, after a
 * full sync, of every event in the window but `allBut`; or, with `all`,
 * every copy it holds), and with them each meeting no source holds any more.
 * A meeting some other calendar still holds may stop showing on records
 * (when no syncing calendar holds it now). Answers the meetings touched,
 * each with the records it showed on (before the removal).
 */
export async function dropSources(
  tx: WorkspaceTx,
  connectionId: string,
  calendarId: string,
  where:
    | { readonly eventIds: readonly string[] }
    | { readonly allBut: readonly string[]; readonly from: string; readonly to: string }
    | 'all',
  options: { readonly cancelBookings?: boolean } = {},
): Promise<readonly MeetingChange[]> {
  const dropped = await tx.execute<{ meeting_id: string; created_by_crm: boolean }>(
    where === 'all'
      ? sql`
        delete from meeting_sources
        where connection_id = ${connectionId}::uuid and calendar_id = ${calendarId}
        returning meeting_id::text as meeting_id, created_by_crm`
      : 'eventIds' in where
        ? sql`
        delete from meeting_sources
        where connection_id = ${connectionId}::uuid and calendar_id = ${calendarId}
          and provider_event_id = any(${textList(where.eventIds)})
        returning meeting_id::text as meeting_id, created_by_crm`
        : sql`
        delete from meeting_sources s using meetings m
        where s.connection_id = ${connectionId}::uuid and s.calendar_id = ${calendarId}
          and m.workspace_id = s.workspace_id and m.id = s.meeting_id
          and m.starts_at < ${where.to}::timestamptz and m.ends_at >= ${where.from}::timestamptz
          and not (s.provider_event_id = any(${textList(where.allBut)}))
        returning s.meeting_id::text as meeting_id, s.created_by_crm`,
  );
  const meetingIds = [...new Set(dropped.rows.map((row) => row.meeting_id))];
  if (meetingIds.length === 0) return [];
  const before = await recordsOf(tx, meetingIds);
  if (options.cancelBookings !== false) {
    const origins = [...new Set(dropped.rows.filter((row) => row.created_by_crm).map((row) => row.meeting_id))];
    await cancelRemovedBookings(tx, origins, meetingIds);
  }
  // A meeting goes with its last source (its attendees and record links go with it).
  const gone = await tx.execute<{ id: string }>(sql`
    delete from meetings m where m.id = any(${uuidList(meetingIds)})
      and not exists (select 1 from meeting_sources s where s.workspace_id = m.workspace_id and s.meeting_id = m.id)
    returning m.id::text as id
  `);
  // A booking never points at a meeting that is gone (by `bookings_by_meeting`).
  if (gone.rows.length > 0) {
    await tx.execute(sql`
      update bookings set meeting_id = null
      where meeting_id = any(${uuidList(gone.rows.map((row) => row.id))})
    `);
  }
  if (options.cancelBookings !== false) await releaseCancelled(tx, meetingIds);
  await recomputePrivacy(tx, meetingIds);
  // Those another calendar still holds show on records only while a syncing calendar (or the CRM) holds them.
  await unlinkUnsynced(tx, meetingIds);
  return meetingIds.map((meetingId) => ({ meetingId, recordIds: before.get(meetingId) ?? [] }));
}

/**
 * Lets go of the meetings among `meetingIds` that a calendar still holds but
 * whose every booking is cancelled (the owner's report of 23 October 2026):
 * the meeting is no longer the booking's or the CRM's, and the booking no
 * longer points at it, so the calendar reads show it as the event it still
 * is. It runs in the drop's transaction, the meeting recorded as the
 * calendar and the booking as the system (bookings admit no `calendar`
 * actor). Only a booking the calendar cancelled (no `cancelled_by`, or
 * `calendar`) lets go: one a host or guest cancelled from Timefix keeps its
 * link, so its event's cancel (`cancelEvent`, which needs the CRM's meeting
 * and drops without this) can still be retried, and its guest email reads it.
 */
async function releaseCancelled(tx: WorkspaceTx, meetingIds: readonly string[]): Promise<void> {
  await tx.execute(sql`
    with freed as (
      update meetings m set booking_id = null, created_by_crm = false, updated_at = now(),
        updated_by_type = 'calendar', updated_by_id = null, updated_by_member_id = null
      where m.id = any(${uuidList(meetingIds)})
        and exists (select 1 from meeting_sources s where s.workspace_id = m.workspace_id and s.meeting_id = m.id)
        and exists (
          select 1 from bookings b
          where b.workspace_id = m.workspace_id and (b.id = m.booking_id or b.meeting_id = m.id)
            and b.status = 'cancelled' and (b.cancelled_by is null or b.cancelled_by = 'calendar')
        )
        and not exists (
          select 1 from bookings b
          where b.workspace_id = m.workspace_id and (b.id = m.booking_id or b.meeting_id = m.id)
            and b.status <> 'cancelled'
        )
      returning m.workspace_id, m.id
    )
    update bookings b set meeting_id = null,
      updated_at = now(), updated_by_type = 'system', updated_by_id = null, updated_by_member_id = null
    from freed where b.workspace_id = freed.workspace_id and b.meeting_id = freed.id and b.status = 'cancelled'
  `);
}

/** Among `meetingIds`, the meetings that show on records: a syncing calendar holds them, or the CRM made them. */
export async function linkedMeetings(tx: WorkspaceTx, meetingIds: readonly string[]): Promise<ReadonlySet<string>> {
  if (meetingIds.length === 0) return new Set();
  const rows = await tx.execute<{ id: string }>(sql`
    select m.id::text as id from meetings m
    where m.id = any(${uuidList(meetingIds)}) and (
      m.created_by_crm or exists (
        select 1 from meeting_sources s
        join calendar_calendars k on k.workspace_id = s.workspace_id and k.connection_id = s.connection_id
          and k.provider_calendar_id = s.calendar_id
        where s.workspace_id = m.workspace_id and s.meeting_id = m.id and (k.sync or s.created_by_crm)
      )
    )
  `);
  return new Set(rows.rows.map((row) => row.id));
}

/**
 * Takes the meetings among `meetingIds` that no syncing calendar holds off every record (AC-1002): they stay for
 * the member's own week while a calendar that shows there holds them. Answers the meetings it took off, each with
 * the records it showed on.
 */
export async function unlinkUnsynced(
  tx: WorkspaceTx,
  meetingIds: readonly string[],
): Promise<readonly MeetingChange[]> {
  if (meetingIds.length === 0) return [];
  const linked = await linkedMeetings(tx, meetingIds);
  const unlinked = meetingIds.filter((id) => !linked.has(id));
  if (unlinked.length === 0) return [];
  const before = await recordsOf(tx, unlinked);
  const gone = await tx.execute<{ meeting_id: string }>(sql`
    delete from meeting_records where meeting_id = any(${uuidList(unlinked)}) returning meeting_id::text as meeting_id
  `);
  const touched = new Set(gone.rows.map((row) => row.meeting_id));
  return unlinked
    .filter((id) => touched.has(id))
    .map((meetingId) => ({ meetingId, recordIds: before.get(meetingId) ?? [] }));
}

/** Why a booking whose event the host removed from their calendar is cancelled. */
export const REMOVED_FROM_CALENDAR = 'Removed from the host calendar';

/**
 * Cancels the upcoming confirmed bookings whose event just left the host's
 * calendar (spec 0025, the owner's report of 20 October 2026): the dropped
 * copy was the one the CRM made (`origins`, in the calendar the booking went
 * to, AC-998) and no calendar of the host's that is pulled (syncs or shows on
 * their week) still holds the meeting, or no calendar holds it any more.
 * Another copy going while that one stays changes nothing (a co host's, or
 * another calendar of the host's), nor does the booking's copy going while
 * another of the host's calendars keeps the meeting (the owner's report of
 * 23 October 2026), and a booking that already began stays as it was. The slot frees with the status (the
 * exclusion constraint holds confirmed bookings only). It runs in the
 * sync's own transaction, recorded as the system: the bookings table admits
 * no `calendar` actor. The host is told by email, queued in the same
 * transaction (`booking_calendar_removed`); the guest gets nothing from
 * Timefix: Google already offered to tell the attendees when the host deleted
 * the event.
 */
async function cancelRemovedBookings(tx: WorkspaceTx, origins: readonly string[], meetingIds: readonly string[]) {
  // The bookings these meetings are for, each found by an index: the booking's meeting, or the meeting's booking.
  const cancelled = await tx.execute<{ id: string }>(sql`
    update bookings b set status = 'cancelled', cancel_reason = ${REMOVED_FROM_CALENDAR},
      updated_at = now(), updated_by_type = 'system', updated_by_id = null, updated_by_member_id = null
    from meetings m
    where m.id = any(${uuidList(meetingIds)}) and m.workspace_id = b.workspace_id
      and b.id in (
        select x.id from bookings x where x.meeting_id = any(${uuidList(meetingIds)})
        union
        select y.booking_id from meetings y where y.id = any(${uuidList(meetingIds)}) and y.booking_id is not null
      )
      and (b.meeting_id = m.id or m.booking_id = b.id)
      and b.status = 'confirmed' and b.starts_at > now()
      and (
        -- The booking's own copy went, and none of the host's pulled calendars holds the meeting now.
        (m.id = any(${uuidList(origins)}) and not exists (
          select 1 from meeting_sources s
          join calendar_calendars k on k.workspace_id = s.workspace_id and k.connection_id = s.connection_id
            and k.provider_calendar_id = s.calendar_id
          where s.workspace_id = m.workspace_id and s.meeting_id = m.id
            and k.member_id = b.host_member_id and (k.sync or k.show_in_week)
        ))
        or not exists (select 1 from meeting_sources s where s.workspace_id = m.workspace_id and s.meeting_id = m.id)
      )
    returning b.id::text as id
  `);
  await tellHostsOfRemoved(
    tx,
    cancelled.rows.map((row) => row.id),
  );
}

/** A cancelled booking as its host's notice states it. */
interface RemovedBooking extends Record<string, unknown> {
  readonly id: string;
  readonly host_member_id: string;
  readonly title: string;
  readonly visitor_name: string;
  readonly visitor_email: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly time_zone: string | null;
  readonly slug: string;
}

/**
 * Queues each host's notice that a booking left with its calendar event
 * (`booking_calendar_removed`, once per booking), in the sync's transaction.
 * The time is stated in the page's zone: its owner's hours when it follows
 * them, else its own.
 */
async function tellHostsOfRemoved(tx: WorkspaceTx, bookingIds: readonly string[]): Promise<void> {
  if (bookingIds.length === 0) return;
  const found = await tx.execute<RemovedBooking>(sql`
    select b.id::text as id, b.host_member_id::text as host_member_id, p.title, b.visitor_name, b.visitor_email,
      to_json(b.starts_at)#>>'{}' as starts_at, to_json(b.ends_at)#>>'{}' as ends_at,
      coalesce(case when p.hours_mode = 'mine' then h.availability->>'timeZone' end, p.availability->>'timeZone') as time_zone,
      w.slug
    from bookings b
    join booking_pages p on p.workspace_id = b.workspace_id and p.id = b.page_id
    join workspaces w on w.id = b.workspace_id
    left join booking_member_hours h on h.workspace_id = p.workspace_id and h.member_id = p.owner_member_id
    where b.id = any(${uuidList(bookingIds)})
  `);
  // One insert and one queue call however many bookings left; a notice its schema refuses is left out, never
  // undoing the sync's write.
  await queueEmails(
    tx,
    found.rows.map((row) => {
      const zone = EmailTimeZone.safeParse(row.time_zone);
      return {
        kind: 'booking_calendar_removed' as const,
        ids: [row.id],
        to: { memberId: row.host_member_id },
        params: {
          title: row.title,
          guestName: row.visitor_name,
          guestEmail: row.visitor_email,
          startsAt: new Date(row.starts_at).toISOString(),
          endsAt: new Date(row.ends_at).toISOString(),
          timeZone: zone.success ? zone.data : 'UTC',
          bookingsPath: `/w/${encodeURIComponent(row.slug)}/bookings/list`,
        },
      };
    }),
  );
}

/** Plans the upserts for the events that sync, the last copy of a key winning within the batch. */
function plan(
  events: readonly ProviderEvent[],
  connection: SyncedConnection,
  lookups: Awaited<ReturnType<typeof readLookups>>,
): ReadonlyMap<string, Planned> {
  const planned = new Map<string, Planned>();
  for (const event of events) {
    if (!shouldSync(event) || event.icalUid === undefined || event.start === undefined || event.end === undefined) {
      continue;
    }
    const icalUid = event.icalUid.slice(0, TITLE_MAX);
    const originalStart = event.originalStart === undefined ? null : moment(event.originalStart);
    const key = keyOf(icalUid, originalStart);
    const startsAt = moment(event.start.at);
    const endsAt = moment(event.end.at) < startsAt ? startsAt : moment(event.end.at);
    const { attendees, isInternal, links } = matchEvent(event, connection.memberId, lookups);
    const title = event.title?.trim().slice(0, TITLE_MAX);
    const location = event.location?.trim().slice(0, LOCATION_MAX);
    planned.set(key, {
      key,
      eventId: event.id,
      etag: event.etag ?? null,
      markedPrivate: event.isPrivate,
      row: {
        k: key,
        ical_uid: icalUid,
        original_start: originalStart,
        title: title === undefined || title === '' ? UNTITLED_MEETING : title,
        starts_at: startsAt,
        ends_at: endsAt,
        all_day: event.start.allDay,
        location: location === undefined || location === '' ? null : location,
        video_url: videoUrlOf(event.videoUrl),
        status: event.status === 'tentative' ? 'tentative' : 'confirmed',
        organizer_email:
          event.organizerEmail === undefined ? null : event.organizerEmail.trim().toLowerCase().slice(0, 320),
        is_internal: isInternal,
      },
      attendees,
      links,
    });
  }
  return planned;
}

/**
 * Applies one batch of a calendar's events in the write's transaction. The
 * connection and the calendar are locked `for key share` first, so a
 * disconnect or a switch turned off waits for the batch (and the batch sees
 * it gone, writing nothing, once it ran first). Answers how many events it
 * kept, or `gone` when the connection no longer syncs or the calendar is no
 * longer pulled (an event the CRM made is written whatever its calendar's
 * switches).
 */
export async function applyEvents(
  context: WriteContext,
  connection: SyncedConnection,
  events: readonly ProviderEvent[],
  isFreeDomain: (domain: string) => boolean,
): Promise<number | 'gone'> {
  const { tx } = context;
  const held = await tx.execute<{ status: string; sharing: string }>(sql`
    select status, sharing from calendar_connections where id = ${connection.id}::uuid for key share
  `);
  const status = held.rows[0]?.status;
  const isPrivateCalendar = held.rows[0]?.sharing === 'private';
  if (status !== 'syncing' && status !== 'connected' && status !== 'failed') return 'gone';
  const madeByCrm = connection.madeByCrm === true;
  if (!madeByCrm) {
    const calendar = await tx.execute<{ pulled: boolean }>(sql`
      select (sync or show_in_week) as pulled from calendar_calendars
      where connection_id = ${connection.id}::uuid and provider_calendar_id = ${connection.calendarId}
      for key share
    `);
    if (calendar.rows[0]?.pulled !== true) return 'gone';
  }

  await writeBusyTimes(context, connection, events);
  const syncing = events.filter(shouldSync);
  let lookups = await readLookups(tx, syncing, isFreeDomain);
  // The workspace makes people for unknown attendees (AC-609): made first, so the meetings link them. Never from
  // a private calendar or a private event (AC-611, AC-612): a person made from one would tell everyone who it was
  // with; nor from a calendar that only shows on the member's week (AC-1002).
  const shareable =
    isPrivateCalendar || !(connection.syncs || madeByCrm) ? [] : syncing.filter((event) => !event.isPrivate);
  if (shareable.length > 0 && (await createsUnknownPeople(tx))) {
    const made = await fileUnknownAttendees(context, shareable, connection.memberId, lookups);
    if (made > 0) lookups = await readLookups(tx, syncing, isFreeDomain);
  }
  const planned = plan(events, connection, lookups);
  // Events that no longer sync here (cancelled, declined, alone): this connection's copies go.
  const keptIds = new Set([...planned.values()].map((each) => each.eventId));
  const changes: MeetingChange[] = [
    ...(await dropSources(tx, connection.id, connection.calendarId, {
      eventIds: events.map((event) => event.id).filter((id) => !keptIds.has(id)),
    })),
  ];
  if (planned.size === 0) {
    context.record({ meetings: changes });
    return 0;
  }

  const rows = [...planned.values()];
  const upserted = await tx.execute<{ k: string; id: string }>(sql`
    with x as (
      select * from jsonb_to_recordset(${JSON.stringify(rows.map((each) => each.row))}::jsonb) as x(
        k text, ical_uid text, original_start timestamptz, title text, starts_at timestamptz, ends_at timestamptz,
        all_day boolean, location text, video_url text, status text, organizer_email text, is_internal boolean)
    ),
    up as (
      insert into meetings (workspace_id, ical_uid, original_start, title, starts_at, ends_at, all_day, location,
        video_url, status, organizer_email, is_internal, created_by_type, updated_by_type)
      select ${context.scope.workspaceId}::uuid, x.ical_uid, x.original_start, x.title, x.starts_at, x.ends_at,
        x.all_day, x.location, x.video_url, x.status::meeting_status, x.organizer_email, x.is_internal,
        'calendar', 'calendar'
      from x
      on conflict (workspace_id, ical_uid, coalesce(original_start, 'epoch'::timestamptz)) do update set
        title = excluded.title, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
        all_day = excluded.all_day, location = excluded.location, video_url = excluded.video_url,
        status = excluded.status, organizer_email = excluded.organizer_email, is_internal = excluded.is_internal,
        updated_at = now(), updated_by_type = 'calendar', updated_by_id = null, updated_by_member_id = null
      returning id, ical_uid, original_start
    )
    select x.k, up.id::text as id from x
    join up on up.ical_uid = x.ical_uid and up.original_start is not distinct from x.original_start
  `);
  const idOf = new Map(upserted.rows.map((row) => [row.k, row.id]));
  const meetingIds = rows.flatMap((each) => {
    const id = idOf.get(each.key);
    return id === undefined ? [] : [id];
  });
  const before = await recordsOf(tx, meetingIds);

  // This connection's copy of each: an event id that moved to another meeting (its UID changed) leaves the old one.
  const sources = rows.flatMap((each) => {
    const meetingId = idOf.get(each.key);
    return meetingId === undefined
      ? []
      : [{ meeting_id: meetingId, event_id: each.eventId, etag: each.etag, marked_private: each.markedPrivate }];
  });
  const moved = await tx.execute<{ meeting_id: string }>(sql`
    delete from meeting_sources s using jsonb_to_recordset(${JSON.stringify(sources)}::jsonb) as x(meeting_id uuid, event_id text)
    where s.connection_id = ${connection.id}::uuid and s.calendar_id = ${connection.calendarId}
      and s.provider_event_id = x.event_id and s.meeting_id <> x.meeting_id
    returning s.meeting_id::text as meeting_id
  `);
  await tx.execute(sql`
    insert into meeting_sources (workspace_id, meeting_id, connection_id, provider_event_id, calendar_id, etag,
      marked_private, created_by_crm)
    select ${context.scope.workspaceId}::uuid, x.meeting_id, ${connection.id}::uuid, x.event_id, ${connection.calendarId},
      x.etag, x.marked_private, ${madeByCrm}
    from jsonb_to_recordset(${JSON.stringify(sources)}::jsonb) as x(meeting_id uuid, event_id text, etag text, marked_private boolean)
    on conflict (workspace_id, meeting_id, connection_id, calendar_id) do update set
      provider_event_id = excluded.provider_event_id, etag = excluded.etag, marked_private = excluded.marked_private,
      created_by_crm = meeting_sources.created_by_crm or excluded.created_by_crm, updated_at = now()
  `);
  if (moved.rows.length > 0) {
    changes.push(
      ...(await dropOrphans(
        tx,
        moved.rows.map((row) => row.meeting_id),
      )),
    );
  }

  // Attendees, replaced: whichever holding connection synced last says who comes.
  await tx.execute(sql`delete from meeting_attendees where meeting_id = any(${uuidList(meetingIds)})`);
  const attendees = rows.flatMap((each) => {
    const meetingId = idOf.get(each.key);
    return meetingId === undefined
      ? []
      : each.attendees.map((attendee) => ({
          meeting_id: meetingId,
          email: attendee.email,
          name: attendee.name,
          position: attendee.position,
          response: attendee.response,
          is_organizer: attendee.isOrganizer,
          member_id: attendee.memberId,
          person_record_id: attendee.personRecordId,
          match: attendee.match,
        }));
  });
  if (attendees.length > 0) {
    await tx.execute(sql`
      insert into meeting_attendees (workspace_id, meeting_id, email, name, position, response, is_organizer, member_id,
        person_record_id, match)
      select ${context.scope.workspaceId}::uuid, x.meeting_id, x.email, x.name, x.position, x.response::attendee_response,
        x.is_organizer, x.member_id, x.person_record_id, x.match::attendee_match
      from jsonb_to_recordset(${JSON.stringify(attendees)}::jsonb) as x(meeting_id uuid, email text, name text,
        position smallint, response text, is_organizer boolean, member_id uuid, person_record_id uuid, match text)
    `);
  }

  // The records each shows on, rewritten, with its start (what timelines page by): only a meeting a syncing calendar
  // holds, or that the CRM made, shows on any (AC-1002).
  await tx.execute(sql`delete from meeting_records where meeting_id = any(${uuidList(meetingIds)})`);
  const linked = madeByCrm || connection.syncs ? undefined : await linkedMeetings(tx, meetingIds);
  const links = rows.flatMap((each) => {
    const meetingId = idOf.get(each.key);
    return meetingId === undefined || (linked !== undefined && !linked.has(meetingId))
      ? []
      : each.links.map((link) => ({
          meeting_id: meetingId,
          record_id: link.recordId,
          via: link.via,
          starts_at: each.row.starts_at,
        }));
  });
  if (links.length > 0) {
    await tx.execute(sql`
      insert into meeting_records (workspace_id, meeting_id, record_id, via, starts_at)
      select ${context.scope.workspaceId}::uuid, x.meeting_id, x.record_id, x.via::meeting_link_via, x.starts_at
      from jsonb_to_recordset(${JSON.stringify(links)}::jsonb) as x(meeting_id uuid, record_id uuid, via text, starts_at timestamptz)
    `);
  }
  await recomputePrivacy(tx, meetingIds);

  const after = new Map<string, string[]>();
  for (const link of links) after.set(link.meeting_id, [...(after.get(link.meeting_id) ?? []), link.record_id]);
  changes.push(
    ...meetingIds.map((meetingId) => ({
      meetingId,
      recordIds: [...new Set([...(before.get(meetingId) ?? []), ...(after.get(meetingId) ?? [])])],
    })),
  );
  context.record({ meetings: changes });
  return planned.size;
}

/** Deletes the meetings among `ids` no source holds, answering each touched one with the records it showed on. */
async function dropOrphans(tx: WorkspaceTx, ids: readonly string[]): Promise<readonly MeetingChange[]> {
  const meetingIds = [...new Set(ids)];
  const before = await recordsOf(tx, meetingIds);
  await tx.execute(sql`
    delete from meetings m where m.id = any(${uuidList(meetingIds)})
      and not exists (select 1 from meeting_sources s where s.workspace_id = m.workspace_id and s.meeting_id = m.id)
  `);
  await recomputePrivacy(tx, meetingIds);
  return meetingIds.map((meetingId) => ({ meetingId, recordIds: before.get(meetingId) ?? [] }));
}
