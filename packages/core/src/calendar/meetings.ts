// Reading meetings (spec 0024, Reads): `listMeetingsForRecord` pages a
// record's meetings through the access door, and `meetingViews` builds what
// a reader may see of each (the timeline's meeting source uses it too). The
// record must be live and visible to the reader; a meeting on it is then
// visible too, but a private one (AC-611, AC-612) shows its details only to
// the members whose connections hold it: to everyone else it is "Private
// meeting" with its time, and no attendees, location or link. A meeting a
// booking made shows the same way to anyone but the booking's host, a
// co-host, its page's owner or a holder of `booking.admin` (`seen.ts`, the
// owner's ask of 29 October 2026), so a colleague's booking is never read
// off the visitor's record. An attendee's
// person shows only when the reader may see that person (hidden is absent).
import { sql } from 'drizzle-orm';
import {
  MEETING_PAGE,
  MeetingCursor,
  PRIVATE_MEETING_TITLE,
  type AttendeeMatch,
  type AttendeeResponse,
  type MeetingAttendeeView,
  type MeetingPage,
  type MeetingView,
} from '@crm/contracts';
import type { RecordRefDisplay } from '@crm/contracts/values';
import type { WorkspaceTx } from '@crm/db';
import { checkScope, type EngineScope } from '../access/mint.ts';
import { isOpen, type Access } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { UNKNOWN_RECORD, visibleRecords } from '../access/visibility.ts';
import { checkId, uuidList } from '../engine/ids.ts';
import { readRecords } from '../engine/records.ts';
import { bookingReaderOf, hiddenBookingSql } from '../booking/seen.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';

/** What a cursor the server didn't make answers, on the `cursor` field. */
export const MEETING_CURSOR_MESSAGE = 'That meeting cursor is not valid here. Start again from the top.';

/** A page of a record's meetings (`calendar.meetings.forRecord`). */
export interface ListMeetingsInput {
  readonly recordId: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/** A moment as fixed width UTC text with milliseconds, as `MeetingView` carries it. */
const millis = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
/** A moment with microseconds, for cursors and timeline keys. */
export const micros = (column: string) =>
  sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** The member the reader is, when a member: holders see their private meetings in full. */
const memberOf = (access: Access) => (access.principal.kind === 'member' ? access.principal.memberId : undefined);

interface MeetingRow extends Record<string, unknown> {
  readonly id: string;
  readonly title: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly all_day: boolean;
  readonly status: MeetingView['status'];
  readonly is_private: boolean;
  readonly location: string | null;
  readonly video_url: string | null;
  readonly holds: boolean;
  /** A booking made it, and the reader is not its host, a co-host, its page's owner or an admin (`seen.ts`). */
  readonly booking_hidden: boolean;
}

/** Whether the reader gets a meeting as Busy: private and not theirs, or a booking that isn't theirs to see. */
const hiddenFrom = (row: MeetingRow) => (row.is_private && !row.holds) || row.booking_hidden;

interface AttendeeRowRead extends Record<string, unknown> {
  readonly meeting_id: string;
  readonly email: string;
  readonly name: string | null;
  readonly response: AttendeeResponse;
  readonly is_organizer: boolean;
  readonly match: AttendeeMatch;
  readonly member_id: string | null;
  readonly person_record_id: string | null;
}

/**
 * The meetings among `ids` as the reader may see them, in the order of
 * `ids`; missing ones are left out. The caller has checked the reader may see
 * a record each one shows on.
 */
export async function meetingViews(
  tx: WorkspaceTx,
  access: Access,
  ids: readonly string[],
): Promise<readonly MeetingView[]> {
  if (ids.length === 0) return [];
  const me = memberOf(access) ?? null;
  const found = await tx.execute<MeetingRow>(sql`
    select m.id::text as id, m.title, ${millis('m.starts_at')} as starts_at, ${millis('m.ends_at')} as ends_at,
      m.all_day, m.status, m.is_private, m.location, m.video_url,
      exists (
        select 1 from meeting_sources s
        join calendar_connections c on c.workspace_id = s.workspace_id and c.id = s.connection_id
        where s.workspace_id = m.workspace_id and s.meeting_id = m.id and c.member_id = ${me}::uuid
      ) as holds,
      ${hiddenBookingSql(bookingReaderOf(access))} as booking_hidden
    from meetings m where m.id = any(${uuidList(ids)})
  `);
  const shown = new Map(found.rows.map((row) => [row.id, row]));
  const open = found.rows.filter((row) => !hiddenFrom(row)).map((row) => row.id);
  const attendees =
    open.length === 0
      ? []
      : (
          await tx.execute<AttendeeRowRead>(sql`
            select meeting_id::text as meeting_id, email, name, response, is_organizer, match,
              member_id::text as member_id, person_record_id::text as person_record_id
            from meeting_attendees where meeting_id = any(${uuidList(open)})
            order by meeting_id, position
          `)
        ).rows;
  // Only the people the reader may see, live: hidden is absent (the attendee shows by email alone).
  const personIds = [
    ...new Set(attendees.flatMap((row) => (row.person_record_id === null ? [] : [row.person_record_id]))),
  ];
  const people = new Map<string, RecordRefDisplay>(
    (await readRecords(tx, access, personIds, { attributeIds: [] })).map((view) => [view.id, view.display]),
  );
  const byMeeting = new Map<string, MeetingAttendeeView[]>();
  for (const row of attendees) {
    const person = row.person_record_id === null ? undefined : people.get(row.person_record_id);
    const view: MeetingAttendeeView = {
      email: row.email,
      ...(row.name === null ? {} : { name: row.name }),
      response: row.response,
      isOrganizer: row.is_organizer,
      // A linked person the reader can't see reads as unknown, never as someone hidden.
      match: row.match === 'linked' && person === undefined ? 'unknown' : row.match,
      ...(row.member_id === null ? {} : { memberId: row.member_id }),
      ...(person === undefined ? {} : { person }),
    };
    byMeeting.set(row.meeting_id, [...(byMeeting.get(row.meeting_id) ?? []), view]);
  }
  return ids.flatMap((id) => {
    const row = shown.get(id);
    if (row === undefined) return [];
    const hidden = hiddenFrom(row);
    const view: MeetingView = {
      id: row.id,
      title: hidden ? PRIVATE_MEETING_TITLE : row.title,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      allDay: row.all_day,
      status: row.status,
      // A colleague's booking reads exactly as a private meeting does (the owner's ask of 29 October 2026).
      isPrivate: row.is_private || row.booking_hidden,
      detailsHidden: hidden,
      ...(hidden || row.location === null ? {} : { location: row.location }),
      ...(hidden || row.video_url === null ? {} : { videoUrl: row.video_url }),
      attendees: hidden ? [] : (byMeeting.get(id) ?? []),
    };
    return [view];
  });
}

/**
 * Refuses `NOT_FOUND` "That record does not exist." unless the record is
 * live, on a live object the reader may see, and inside their record rule.
 */
export async function checkMeetingRecord(tx: WorkspaceTx, access: Access, recordId: string): Promise<void> {
  const rows = await tx.execute<{ object_id: string }>(sql`
    select r.object_id::text as object_id
    from records r join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id
    where r.id = ${recordId}::uuid and r.deleted_at is null and o.archived_at is null
  `);
  const [row] = rows.rows;
  if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
  if (isOpen(access)) return;
  const seen = await visibleRecords(tx, access, [{ objectId: row.object_id, recordId }]);
  if (!seen.has(recordId)) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
}

/** Encodes where a page ended as the opaque cursor: base64url JSON. */
function encodeMeetingCursor(cursor: MeetingCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** Decodes a cursor the server made, refusing anything else (400 `INPUT_INVALID` on `cursor`). */
function decodeMeetingCursor(cursor: string): MeetingCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw inputInvalid('cursor', MEETING_CURSOR_MESSAGE);
  }
  const bound = MeetingCursor.safeParse(parsed);
  if (!bound.success) throw inputInvalid('cursor', MEETING_CURSOR_MESSAGE);
  for (const moment of [bound.data.now, bound.data.startsAt]) {
    const stamp = Date.parse(moment);
    if (Number.isNaN(stamp) || moment.startsWith('0000')) throw inputInvalid('cursor', MEETING_CURSOR_MESSAGE);
  }
  return bound.data;
}

interface PageRow extends Record<string, unknown> {
  readonly id: string;
  readonly starts_at: string;
}

/**
 * One page of a record's meetings (AC-608): the upcoming ones first, soonest
 * first, then the past ones, newest first, 20 a page, read from
 * `meeting_records_by_record`. The first page fixes "now" in its cursor, so a
 * meeting never moves between the halves while someone pages. A hidden or
 * trashed record is `NOT_FOUND`; a cursor the server didn't make is 400
 * `INPUT_INVALID` on `cursor`.
 */
export async function listMeetingsForRecord(scope: EngineScope, input: ListMeetingsInput): Promise<MeetingPage> {
  checkScope(scope);
  const limit = input.limit ?? MEETING_PAGE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MEETING_PAGE) {
    throw inputInvalid('limit', `Ask for 1 to ${String(MEETING_PAGE)} meetings.`);
  }
  const after = input.cursor === undefined ? undefined : decodeMeetingCursor(input.cursor);
  const recordId = checkId(input.recordId, UNKNOWN_RECORD);
  return inWorkspace(scope, async (tx) => {
    await checkMeetingRecord(tx, scope.access, recordId);
    const nowRows = await tx.execute<{ now: string }>(sql`select ${micros('now()')} as now`);
    const now = after?.now ?? nowRows.rows[0]?.now ?? new Date().toISOString();
    const rows: { readonly row: PageRow; readonly phase: 'upcoming' | 'past' }[] = [];
    if (after === undefined || after.phase === 'upcoming') {
      // Soonest first: the index read backwards (start ascending, then id descending).
      const bound =
        after === undefined
          ? sql``
          : sql` and (l.starts_at > ${after.startsAt}::timestamptz or (l.starts_at = ${after.startsAt}::timestamptz and l.meeting_id < ${after.id}::uuid))`;
      const upcoming = await tx.execute<PageRow>(sql`
        select l.meeting_id::text as id, ${micros('l.starts_at')} as starts_at from meeting_records l
        where l.record_id = ${recordId}::uuid and l.starts_at >= ${now}::timestamptz${bound}
        order by l.starts_at asc, l.meeting_id desc
        limit ${limit + 1}
      `);
      rows.push(...upcoming.rows.map((row) => ({ row, phase: 'upcoming' as const })));
    }
    if (rows.length <= limit) {
      const bound =
        after?.phase === 'past'
          ? sql` and (l.starts_at < ${after.startsAt}::timestamptz or (l.starts_at = ${after.startsAt}::timestamptz and l.meeting_id > ${after.id}::uuid))`
          : sql``;
      const past = await tx.execute<PageRow>(sql`
        select l.meeting_id::text as id, ${micros('l.starts_at')} as starts_at from meeting_records l
        where l.record_id = ${recordId}::uuid and l.starts_at < ${now}::timestamptz${bound}
        order by l.starts_at desc, l.meeting_id asc
        limit ${limit + 1 - rows.length}
      `);
      rows.push(...past.rows.map((row) => ({ row, phase: 'past' as const })));
    }
    const page = rows.slice(0, limit);
    const items = await meetingViews(
      tx,
      scope.access,
      page.map((each) => each.row.id),
    );
    const last = page.at(-1);
    const more = rows.length > limit && last !== undefined;
    return {
      items: [...items],
      ...(more
        ? {
            nextCursor: encodeMeetingCursor({ now, phase: last.phase, startsAt: last.row.starts_at, id: last.row.id }),
          }
        : {}),
    };
  });
}
