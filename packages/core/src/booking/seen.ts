// Who may see a booking (the owner's ask of 29 October 2026: "don't show
// someone else's booking if they're in the same workspace"): its host, any
// co-host (`booking_hosts`), its page's owner, or a holder of
// `booking.admin`. Everyone else in the workspace meets it as absent on
// Bookings, and as Busy (its time alone, the private meeting's shape) where a
// meeting it made shows on a record. This is the one copy of the rule: the
// Bookings reads, a booking's change target, a record's meetings and
// timeline, Home's Team today and the realtime audience's meeting facts all
// take it from here.
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { Access } from '../access/policy.ts';
import { can } from '../access/policy.ts';

/** Who reads bookings: the member they are, when a member, and whether they see everyone's. */
export interface BookingReader {
  readonly member?: string;
  readonly admin: boolean;
}

/** The reader a principal is: the system and `booking.admin` see every booking; a member sees their own. */
export function bookingReaderOf(access: Access): BookingReader {
  const { principal } = access;
  const member = principal.kind === 'member' ? principal.memberId : undefined;
  const admin = principal.kind === 'system' || can(access, 'booking.admin');
  return { ...(member === undefined ? {} : { member }), admin };
}

/** The columns of the booking a condition is about, as SQL (a Drizzle column, or an alias's column). */
export interface BookingColumns {
  readonly workspaceId: AnyColumn | SQL;
  readonly id: AnyColumn | SQL;
  readonly pageId: AnyColumn | SQL;
  readonly hostMemberId: AnyColumn | SQL;
  /** The page's owner, when the query already joins the page: then no lookup of the page is needed. */
  readonly pageOwnerMemberId?: AnyColumn | SQL;
}

/** A booking aliased `alias` in a raw query, as `seesBookingSql` takes it. */
export function bookingAlias(alias: string): BookingColumns {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error('A booking alias is a plain SQL name.');
  return {
    workspaceId: sql.raw(`${alias}.workspace_id`),
    id: sql.raw(`${alias}.id`),
    pageId: sql.raw(`${alias}.page_id`),
    hostMemberId: sql.raw(`${alias}.host_member_id`),
  };
}

/**
 * True, in SQL, for a booking `reader` may see (`booking.admin`, or the booking's host, co-host or page owner).
 * `everyone: false` asks for the reader's own alone even when they are an admin (Bookings' Mine). A reader who is no
 * member and no admin sees none. Each check is an index lookup: the bookings row, the page's key, `booking_hosts`'
 * key.
 */
export function seesBookingSql(
  reader: BookingReader,
  booking: BookingColumns,
  options: { readonly everyone?: boolean } = {},
): SQL {
  if (reader.admin && options.everyone !== false) return sql`true`;
  if (reader.member === undefined) return sql`false`;
  const me = reader.member;
  const owns =
    booking.pageOwnerMemberId === undefined
      ? sql`exists (
      select 1 from booking_pages sp
      where sp.workspace_id = ${booking.workspaceId} and sp.id = ${booking.pageId} and sp.owner_member_id = ${me}::uuid
    )`
      : sql`${booking.pageOwnerMemberId} = ${me}::uuid`;
  return sql`(
    ${booking.hostMemberId} = ${me}::uuid
    or ${owns}
    or exists (
      select 1 from booking_hosts sh
      where sh.workspace_id = ${booking.workspaceId} and sh.booking_id = ${booking.id} and sh.member_id = ${me}::uuid
    )
  )`;
}

/**
 * True, in SQL, for a meeting aliased `m` that a booking made (the meeting's `booking_id`, or a booking's
 * `meeting_id`) and that `reader` may not see as that booking: they get it as Busy, with no details and no answers.
 */
export function hiddenBookingSql(reader: BookingReader): SQL {
  if (reader.admin) return sql`false`;
  // Two lookups each way, so each takes its index (the bookings key, `bookings_by_meeting`).
  const byId = sql`hb.workspace_id = m.workspace_id and hb.id = m.booking_id`;
  const byMeeting = sql`hb.workspace_id = m.workspace_id and hb.meeting_id = m.id`;
  const sees = seesBookingSql(reader, bookingAlias('hb'));
  return sql`(
    (exists (select 1 from bookings hb where ${byId}) or exists (select 1 from bookings hb where ${byMeeting}))
    and not exists (select 1 from bookings hb where ${byId} and ${sees})
    and not exists (select 1 from bookings hb where ${byMeeting} and ${sees})
  )`;
}

/**
 * Whether `reader` may see a booking already read (its host, page owner and co-hosts in hand): the change target's
 * check, the same rule as `seesBookingSql`.
 */
export function seesBooking(
  reader: BookingReader,
  booking: { readonly hostMemberId: string; readonly ownerMemberId: string; readonly coHostIds: readonly string[] },
): boolean {
  if (reader.admin) return true;
  const me = reader.member;
  if (me === undefined) return false;
  return booking.hostMemberId === me || booking.ownerMemberId === me || booking.coHostIds.includes(me);
}
