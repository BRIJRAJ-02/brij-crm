// Who may see a booking (the owner's ask of 29 October 2026: "don't show
// someone else's booking if they're in the same workspace"; spec 0037's
// Booking actions table, AC-1262): its host, any co-host (`booking_hosts`),
// its page's owner and editors (AC-1331), a holder of `booking.admin`, and anyone whose scheduling
// reach covers its host or a co-host (See shows it with the guest's name,
// page title, time and status only; Manage acts on it as the host does).
// Everyone else in the workspace meets it as absent on Bookings, and as Busy
// (its time alone, the private meeting's shape) where a meeting it made shows
// on a record. This is the one copy of the rule: the Bookings reads, a
// booking's change target, a record's meetings and timeline, Home's Team today
// and the realtime audience's meeting facts all take it from here.
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import type { Access } from '../access/policy.ts';
import { can } from '../access/policy.ts';
import { canActFor, schedulingReach, type SchedulingLevel, type SchedulingReach } from '../access/scheduling.ts';
import { uuidList } from '../engine/ids.ts';
import { editedBy } from '../scheduling/editor-rows.ts';

/**
 * Who reads bookings: the member they are, when a member, whether they see everyone's (`booking.admin`), and the
 * hosts their scheduling reach covers (spec 0037): `sees` at See or Manage, `manages` at Manage, and `everyone`
 * when the reach covers every member. A reader made without the reach (`bookingReaderOf`) has none of the three.
 */
export interface BookingReader {
  readonly member?: string;
  readonly admin: boolean;
  /** Members (not the reader) whose bookings the reach shows: See or Manage over them. */
  readonly sees?: readonly string[];
  /** Of those, the members the reader Manages. */
  readonly manages?: readonly string[];
  /** The reach over every member, when there is one. */
  readonly everyone?: SchedulingLevel;
  /** The pages the reader edits (spec 0037, AC-1331): they manage those pages' bookings as the page's owner does. */
  readonly edits?: readonly string[];
}

/** The reader a principal is, without scheduling reach: the system and `booking.admin` see every booking. */
export function bookingReaderOf(access: Access): BookingReader {
  const { principal } = access;
  const member = principal.kind === 'member' ? principal.memberId : undefined;
  const admin = principal.kind === 'system' || can(access, 'booking.admin');
  return { ...(member === undefined ? {} : { member }), admin };
}

/** The reader with a reach already read (pure): the hosts it covers, by level. */
export function bookingReaderWith(access: Access, reach: SchedulingReach): BookingReader {
  const base = bookingReaderOf(access);
  if (base.admin) return base;
  const others = [...reach.members.keys()].filter((id) => id !== base.member);
  return {
    ...base,
    sees: others.filter((id) => canActFor(reach, id, 'view')),
    manages: others.filter((id) => canActFor(reach, id, 'manage')),
    ...(reach.all === undefined ? {} : { everyone: reach.all }),
  };
}

/**
 * The reader with their scheduling reach (spec 0037, AC-1262), read in the caller's transaction: one query, skipped
 * for `booking.admin` and the system, who see every booking anyway.
 */
export async function bookingReaderIn(tx: WorkspaceTx, scope: EngineScope): Promise<BookingReader> {
  const base = bookingReaderOf(scope.access);
  if (base.admin || base.member === undefined) return base;
  const edits = [...(await editedBy(tx, scope, 'booking_page'))];
  return {
    ...bookingReaderWith(scope.access, await schedulingReach(tx, scope)),
    ...(edits.length === 0 ? {} : { edits }),
  };
}

/**
 * The page's owner as access reads it, for a query that joins `booking_pages`: its owner on a person's page, and
 * nobody (null) on a workspace link, whose `owner_member_id` only made it and manages nothing (workspace link,
 * 30 Oct 2026). Every Bookings read takes its page owner through this.
 */
export const pageManagerColumn = sql<
  string | null
>`case when ${schema.bookingPages.scope} = 'member' then ${schema.bookingPages.ownerMemberId} end`;

/** A page's owner as access reads it: undefined on a workspace link (`pageManagerColumn`, in TypeScript). */
export function pageManagerOf(page: { readonly scope: string; readonly ownerMemberId: string }): string | undefined {
  return page.scope === 'member' ? page.ownerMemberId : undefined;
}

/** The columns of the booking a condition is about, as SQL (a Drizzle column, or an alias's column). */
export interface BookingColumns {
  readonly workspaceId: AnyColumn | SQL;
  readonly id: AnyColumn | SQL;
  readonly pageId: AnyColumn | SQL;
  readonly hostMemberId: AnyColumn | SQL;
  /**
   * The page's owner, when the query already joins the page (`pageManagerColumn`, null on a workspace link): then no
   * lookup of the page is needed.
   */
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
 * True, in SQL, for a booking `reader` may see (`booking.admin`; the booking's host, co-host or page owner; or a
 * host or co-host in the reader's scheduling reach). `everyone: false` asks for the reader's own alone even when
 * they are an admin or reach others (Bookings' Mine). `level: 'act'` counts only Manage reach, for what See doesn't
 * show (the guest's email and answers, a meeting's details on a record). A reader who is no member and no admin
 * sees none. Each check is an index lookup: the bookings row, the page's key, `booking_hosts`' key.
 */
export function seesBookingSql(
  reader: BookingReader,
  booking: BookingColumns,
  options: { readonly everyone?: boolean; readonly level?: 'see' | 'act' } = {},
): SQL {
  const all = options.everyone !== false;
  if (reader.admin && all) return sql`true`;
  if (reader.member === undefined) return sql`false`;
  const act = options.level === 'act';
  if (all && (act ? reader.everyone === 'manage' : reader.everyone !== undefined)) return sql`true`;
  const me = reader.member;
  const owns =
    booking.pageOwnerMemberId === undefined
      ? sql`exists (
      select 1 from booking_pages sp
      where sp.workspace_id = ${booking.workspaceId} and sp.id = ${booking.pageId} and sp.owner_member_id = ${me}::uuid
        and sp.scope = 'member'
    )`
      : sql`${booking.pageOwnerMemberId} = ${me}::uuid`;
  const reached = all ? ((act ? reader.manages : reader.sees) ?? []) : [];
  const hosts = reached.length === 0 ? sql`${me}::uuid` : sql`any(${uuidList([me, ...reached])})`;
  // A page the reader edits is theirs to manage, as its owner's is (AC-1331).
  const edits = all ? (reader.edits ?? []) : [];
  const edited = edits.length === 0 ? sql`false` : sql`${booking.pageId} = any(${uuidList(edits)})`;
  return sql`(
    ${booking.hostMemberId} = ${hosts}
    or ${edited}
    or ${owns}
    or exists (
      select 1 from booking_hosts sh
      where sh.workspace_id = ${booking.workspaceId} and sh.booking_id = ${booking.id} and sh.member_id = ${hosts}
    )
  )`;
}

/**
 * True, in SQL, for a meeting aliased `m` that a booking made (the meeting's `booking_id`, or a booking's
 * `meeting_id`) and that `reader` may not act on as that booking: they get it as Busy, with no details and no
 * answers. See reach alone doesn't open it: a meeting's attendees and answers are what See leaves out (AC-1262).
 */
export function hiddenBookingSql(reader: BookingReader): SQL {
  if (reader.admin) return sql`false`;
  // Two lookups each way, so each takes its index (the bookings key, `bookings_by_meeting`).
  const byId = sql`hb.workspace_id = m.workspace_id and hb.id = m.booking_id`;
  const byMeeting = sql`hb.workspace_id = m.workspace_id and hb.meeting_id = m.id`;
  const sees = seesBookingSql(reader, bookingAlias('hb'), { level: 'act' });
  return sql`(
    (exists (select 1 from bookings hb where ${byId}) or exists (select 1 from bookings hb where ${byMeeting}))
    and not exists (select 1 from bookings hb where ${byId} and ${sees})
    and not exists (select 1 from bookings hb where ${byMeeting} and ${sees})
  )`;
}

/** A booking already read, as the row checks take it: its host, its page's owner and its co-hosts. */
export interface BookingHeld {
  readonly hostMemberId: string;
  /** Its page, when the caller has it: a page the reader edits makes them its manager (AC-1331). */
  readonly pageId?: string;
  /** Its page's owner; null or undefined on a workspace link, which nobody owns (`pageManagerOf`). */
  readonly ownerMemberId: string | null | undefined;
  readonly coHostIds: readonly string[];
}

/**
 * What `reader` may do with a booking already read (spec 0037's Booking actions table, AC-1262): `act` (its host,
 * a co-host, its page's owner, `booking.admin`, or Manage over its host or a co-host: see the guest's email and
 * answers, cancel, move, mark a no show), `see` (See over its host or a co-host: the guest's name, the page's
 * title, the time and status only), or undefined (absent).
 */
export function bookingAccess(reader: BookingReader, booking: BookingHeld): 'act' | 'see' | undefined {
  if (reader.admin) return 'act';
  const me = reader.member;
  if (me === undefined) return undefined;
  const hosts = [booking.hostMemberId, ...booking.coHostIds];
  if (hosts.includes(me) || booking.ownerMemberId === me) return 'act';
  if (booking.pageId !== undefined && reader.edits?.includes(booking.pageId) === true) return 'act';
  if (reader.everyone === 'manage' || hosts.some((id) => reader.manages?.includes(id) === true)) return 'act';
  if (reader.everyone !== undefined || hosts.some((id) => reader.sees?.includes(id) === true)) return 'see';
  return undefined;
}

/**
 * Whether `reader` may see a booking already read (its host, page owner and co-hosts in hand): the same rule as
 * `seesBookingSql`.
 */
export function seesBooking(reader: BookingReader, booking: BookingHeld): boolean {
  return bookingAccess(reader, booking) !== undefined;
}
