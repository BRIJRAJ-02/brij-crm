// Writing a batch of synced events (spec 0024, Sync): one transaction per
// batch, set based, so a 5,000 event first sync is a few dozen statements per
// batch rather than a few per event. For each event of one connection: skip
// it by AC-605 (or drop this connection's copy when it was cancelled); else
// upsert the meeting by its iCalendar UID and original start (AC-603), this
// connection's source, the attendees (replaced), and the records it shows on
// (rewritten). A meeting goes with its last source. Every meeting touched
// lands in the change with every record it showed on before or after, so the
// outbox stores one `meetings` row for the batch (AC-610).
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
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

/** The connection a batch syncs for: what the writes need of it. */
export interface SyncedConnection {
  readonly id: string;
  readonly memberId: string;
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
async function writeBusyTimes(context: WriteContext, connectionId: string, events: readonly ProviderEvent[]) {
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
      where connection_id = ${connectionId}::uuid and provider_event_id = any(${textList(others)})
    `);
  }
  if (busy.size === 0) return;
  await tx.execute(sql`
    insert into calendar_busy_times (workspace_id, connection_id, provider_event_id, starts_at, ends_at)
    select ${context.scope.workspaceId}::uuid, ${connectionId}::uuid, x.event_id, x.starts_at, x.ends_at
    from jsonb_to_recordset(${JSON.stringify([...busy.values()])}::jsonb) as x(event_id text, starts_at timestamptz, ends_at timestamptz)
    on conflict (workspace_id, connection_id, provider_event_id) do update set
      starts_at = excluded.starts_at, ends_at = excluded.ends_at, updated_at = now()
  `);
}

/**
 * After a full sync: drops this connection's busy times in the window whose
 * events the provider no longer listed.
 */
export async function dropBusyTimes(
  tx: WorkspaceTx,
  connectionId: string,
  where: { readonly allBut: readonly string[]; readonly from: string; readonly to: string },
): Promise<void> {
  await tx.execute(sql`
    delete from calendar_busy_times
    where connection_id = ${connectionId}::uuid
      and starts_at < ${where.to}::timestamptz and ends_at >= ${where.from}::timestamptz
      and not (provider_event_id = any(${textList(where.allBut)}))
  `);
}

/**
 * Removes this connection's copies of the events `eventIds` names, and with
 * them each meeting no source holds any more. Answers the meetings touched,
 * each with the records it showed on (before the removal).
 */
export async function dropSources(
  tx: WorkspaceTx,
  connectionId: string,
  where:
    | { readonly eventIds: readonly string[] }
    | { readonly allBut: readonly string[]; readonly from: string; readonly to: string },
  options: { readonly cancelBookings?: boolean } = {},
): Promise<readonly MeetingChange[]> {
  const dropped = await tx.execute<{ meeting_id: string }>(
    'eventIds' in where
      ? sql`
        delete from meeting_sources
        where connection_id = ${connectionId}::uuid and provider_event_id = any(${textList(where.eventIds)})
        returning meeting_id::text as meeting_id`
      : sql`
        delete from meeting_sources s using meetings m
        where s.connection_id = ${connectionId}::uuid and m.workspace_id = s.workspace_id and m.id = s.meeting_id
          and m.starts_at < ${where.to}::timestamptz and m.ends_at >= ${where.from}::timestamptz
          and not (s.provider_event_id = any(${textList(where.allBut)}))
        returning s.meeting_id::text as meeting_id`,
  );
  const meetingIds = [...new Set(dropped.rows.map((row) => row.meeting_id))];
  if (meetingIds.length === 0) return [];
  const before = await recordsOf(tx, meetingIds);
  if (options.cancelBookings !== false) await cancelRemovedBookings(tx, connectionId, meetingIds);
  // A meeting goes with its last source (its attendees and record links go with it).
  const gone = await tx.execute<{ id: string }>(sql`
    delete from meetings m where m.id = any(${uuidList(meetingIds)})
      and not exists (select 1 from meeting_sources s where s.workspace_id = m.workspace_id and s.meeting_id = m.id)
    returning m.id::text as id
  `);
  // A booking never points at a meeting that is gone.
  if (gone.rows.length > 0) {
    await tx.execute(sql`
      update bookings set meeting_id = null
      where meeting_id = any(${uuidList(gone.rows.map((row) => row.id))})
    `);
  }
  await recomputePrivacy(tx, meetingIds);
  return meetingIds.map((meetingId) => ({ meetingId, recordIds: before.get(meetingId) ?? [] }));
}

/** Why a booking whose event the host removed from their calendar is cancelled. */
export const REMOVED_FROM_CALENDAR = 'Removed from the host calendar';

/**
 * Cancels the upcoming confirmed bookings whose event just left the host's
 * calendar (spec 0025, the owner's report of 20 October 2026): the dropped
 * copy was the host's own, or no calendar holds the meeting any more. A co
 * host's copy going while the host's stays changes nothing, and a booking
 * that already began stays as it was. The slot frees with the status (the
 * exclusion constraint holds confirmed bookings only). It runs in the
 * sync's own transaction, recorded as the system: the bookings table admits
 * no `calendar` actor. No email is sent from here: Google already offered to
 * tell the attendees when the host deleted the event.
 */
async function cancelRemovedBookings(tx: WorkspaceTx, connectionId: string, meetingIds: readonly string[]) {
  await tx.execute(sql`
    update bookings b set status = 'cancelled', cancel_reason = ${REMOVED_FROM_CALENDAR},
      updated_at = now(), updated_by_type = 'system', updated_by_id = null, updated_by_member_id = null
    from meetings m
    where m.id = any(${uuidList(meetingIds)}) and m.workspace_id = b.workspace_id
      and (b.meeting_id = m.id or m.booking_id = b.id)
      and b.status = 'confirmed' and b.starts_at > now()
      and (
        b.host_member_id = (select c.member_id from calendar_connections c where c.id = ${connectionId}::uuid)
        or not exists (select 1 from meeting_sources s where s.workspace_id = m.workspace_id and s.meeting_id = m.id)
      )
  `);
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
 * Applies one batch of a connection's events in the write's transaction. The
 * connection is locked `for key share` first, so a disconnect waits for the
 * batch (and the batch sees it gone, writing nothing, once it ran first).
 * Answers how many events it kept, or `gone` when the connection no longer
 * syncs.
 */
export async function applyEvents(
  context: WriteContext,
  connection: SyncedConnection,
  events: readonly ProviderEvent[],
  isFreeDomain: (domain: string) => boolean,
): Promise<number | 'gone'> {
  const { tx } = context;
  const held = await tx.execute<{ status: string }>(sql`
    select status from calendar_connections where id = ${connection.id}::uuid for key share
  `);
  const status = held.rows[0]?.status;
  if (status !== 'syncing' && status !== 'connected' && status !== 'failed') return 'gone';

  await writeBusyTimes(context, connection.id, events);
  const syncing = events.filter(shouldSync);
  let lookups = await readLookups(tx, syncing, isFreeDomain);
  // The workspace makes people for unknown attendees (AC-609): made first, so the meetings link them.
  if (syncing.length > 0 && (await createsUnknownPeople(tx))) {
    const made = await fileUnknownAttendees(context, syncing, connection.memberId, lookups);
    if (made > 0) lookups = await readLookups(tx, syncing, isFreeDomain);
  }
  const planned = plan(events, connection, lookups);
  // Events that no longer sync here (cancelled, declined, alone): this connection's copies go.
  const keptIds = new Set([...planned.values()].map((each) => each.eventId));
  const changes: MeetingChange[] = [
    ...(await dropSources(tx, connection.id, {
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
    where s.connection_id = ${connection.id}::uuid and s.provider_event_id = x.event_id and s.meeting_id <> x.meeting_id
    returning s.meeting_id::text as meeting_id
  `);
  await tx.execute(sql`
    insert into meeting_sources (workspace_id, meeting_id, connection_id, provider_event_id, calendar_id, etag, marked_private)
    select ${context.scope.workspaceId}::uuid, x.meeting_id, ${connection.id}::uuid, x.event_id, 'primary', x.etag, x.marked_private
    from jsonb_to_recordset(${JSON.stringify(sources)}::jsonb) as x(meeting_id uuid, event_id text, etag text, marked_private boolean)
    on conflict (workspace_id, meeting_id, connection_id) do update set
      provider_event_id = excluded.provider_event_id, etag = excluded.etag, marked_private = excluded.marked_private,
      updated_at = now()
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

  // The records each shows on, rewritten, with its start (what timelines page by).
  await tx.execute(sql`delete from meeting_records where meeting_id = any(${uuidList(meetingIds)})`);
  const links = rows.flatMap((each) => {
    const meetingId = idOf.get(each.key);
    return meetingId === undefined
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
