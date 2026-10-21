// A page's slots (spec 0025, AC-629, AC-631): the page row read inside the
// workspace, its hours turned into the engine's minutes, the host's calendars
// read through the `BusyReader`, the host's confirmed bookings read from
// Postgres, then the pure engine. Shared by the public slots read and the
// booking's recheck under the host lock.
import { and, asc, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm';
import {
  BookingLocation,
  isTimeZone,
  minutesOf,
  WEEKDAYS,
  type BookingAvailability,
  type BookingPageSettings,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { resolveMany, virtualDefault, type ResolvedSchedule } from '../availability/resolve.ts';
import { FREE_BUSY_MAX_DAYS } from '../calendar/events.ts';
import { refuse } from '../engine/refusals.ts';
import { blockedTime } from './blocks.ts';
import type { BusyReader } from './calendar.ts';
import { computeSlots, type BookedSpan, type DateOverride, type Span, type WeeklyRule } from './engine.ts';

const { bookingPageMembers, bookingPages, bookings } = schema;

/** A page as the services read it: its row, the settings parsed, and the hours it books by. */
export interface PageRecord extends BookingPageSettings {
  /**
   * The hours the page books by (spec 0035, AC-965): its schedule's, else its
   * owner's default's, else the virtual default in `fallbackZone`.
   */
  readonly availability: BookingAvailability;
  /** That schedule's name ("Working hours" for the virtual default), for the page's views. */
  readonly scheduleName: string;
  /** The zone the virtual default takes on this page: its own stored hours' zone (its creator's, AC-963). */
  readonly fallbackZone: string;
  readonly id: string;
  readonly publicKey: string;
  readonly kind: 'personal' | 'collective' | 'round_robin';
  readonly ownerMemberId: string;
  readonly isDeleted: boolean;
  /** A private page books inside its host's holds and waives its minimum notice (spec 0027, AC-707). */
  readonly isPrivate: boolean;
  /** Paused by the system because its last host was removed (spec 0031, AC-814); absent otherwise. */
  readonly pausedReason?: 'host_removed';
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const SLOT_STEPS = new Set([15, 30, 60]);
const KINDS = new Set(['personal', 'collective', 'round_robin']);

/** A page's stored row (`booking_pages`). */
export type PageRow = typeof bookingPages.$inferSelect;

/**
 * The zone of a page's own stored hours, which the virtual default takes on it (UTC when they are damaged). Read
 * with no schema: only the zone matters, and a page whose old hours no longer parse still has one. `known` holds
 * the zones one call already checked, so a list of pages checks each zone once (a check builds an `Intl` format).
 */
export function fallbackZoneOf(row: Pick<PageRow, 'availability'>, known?: Map<string, boolean>): string {
  const stored: unknown = row.availability;
  const zone =
    typeof stored === 'object' && stored !== null && 'timeZone' in stored && typeof stored.timeZone === 'string'
      ? stored.timeZone
      : undefined;
  if (zone === undefined) return 'UTC';
  const valid = known?.get(zone) ?? isTimeZone(zone);
  known?.set(zone, valid);
  return valid ? zone : 'UTC';
}

/**
 * A stored row as a `PageRecord`, given the schedule it books by and its zone for the virtual default (`pagesOf`
 * resolves both): settings parsed with the shared schemas.
 */
export function pageOf(
  row: PageRow,
  schedule: Pick<ResolvedSchedule, 'name' | 'availability'>,
  fallbackZone: string = fallbackZoneOf(row),
): PageRecord {
  const step = row.slotStep;
  return {
    id: row.id,
    publicKey: row.publicKey,
    kind: KINDS.has(row.kind) ? (row.kind as PageRecord['kind']) : 'personal',
    ownerMemberId: row.ownerMemberId,
    title: row.title,
    description: row.description,
    slug: row.slug,
    durations: row.durations.filter((minutes): minutes is 15 | 30 | 45 | 60 | 90 =>
      [15, 30, 45, 60, 90].includes(minutes),
    ),
    location: BookingLocation.parse(row.location),
    availability: schedule.availability,
    scheduleName: schedule.name,
    fallbackZone,
    scheduleId: row.scheduleId,
    bufferBefore: row.bufferBefore,
    bufferAfter: row.bufferAfter,
    minNoticeMinutes: row.minNoticeMinutes,
    windowDays: row.windowDays,
    dailyLimit: row.dailyLimit,
    slotStep: step !== null && SLOT_STEPS.has(step) ? (step as 15 | 30 | 60) : null,
    status: row.status === 'paused' ? 'paused' : 'live',
    isDeleted: row.deletedAt !== null,
    isPrivate: row.isPrivate,
    ...(row.pausedReason === 'host_removed' ? { pausedReason: 'host_removed' as const } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Stored rows as `PageRecord`s, in order, each with the hours it books by
 * (spec 0035, AC-965): the schedule it names when that is its owner's, else
 * whichever schedule is the owner's default now, else the virtual default
 * (weekdays 09:00 to 17:00) in the page's own zone. One query for them all.
 */
export async function pagesOf(tx: WorkspaceTx, rows: readonly PageRow[]): Promise<readonly PageRecord[]> {
  const known = new Map<string, boolean>();
  const zones = rows.map((row) => fallbackZoneOf(row, known));
  const hours = await resolveMany(
    tx,
    rows.map((row, index) => ({
      memberId: row.ownerMemberId,
      scheduleId: row.scheduleId ?? undefined,
      fallbackZone: zones[index] ?? 'UTC',
    })),
  );
  return rows.map((row, index) => {
    const zone = zones[index] ?? 'UTC';
    return pageOf(row, hours[index] ?? virtualDefault(zone), zone);
  });
}

/** One page by id, deleted ones too, or undefined, with the hours it books by (`pagesOf`). */
export async function loadPage(tx: WorkspaceTx, pageId: string): Promise<PageRecord | undefined> {
  const [row] = await tx.select().from(bookingPages).where(eq(bookingPages.id, pageId));
  if (row === undefined) return undefined;
  const [page] = await pagesOf(tx, [row]);
  return page;
}

/** The page's hours as the engine takes them: weekday ranges (0 Sunday) and date overrides, in minutes. */
export function engineHours(availability: BookingAvailability): {
  readonly rules: readonly WeeklyRule[];
  readonly overrides: readonly DateOverride[];
} {
  const rules = WEEKDAYS.flatMap((day, index) =>
    availability.weekly[day].map(([start, end]) => ({
      // WEEKDAYS is Monday first; the engine's 0 is Sunday.
      dayOfWeek: (index + 1) % 7,
      startMinute: minutesOf(start),
      endMinute: minutesOf(end),
    })),
  );
  const overrides = availability.overrides.map((override) => ({
    date: override.date,
    windows: override.ranges.map(([start, end]) => ({ startMinute: minutesOf(start), endMinute: minutesOf(end) })),
  }));
  return { rules, overrides };
}

/** The page's required members in order (the owner alone on a personal page). */
export async function membersOf(tx: WorkspaceTx, page: PageRecord): Promise<readonly string[]> {
  const rows = await tx
    .select({ memberId: bookingPageMembers.memberId })
    .from(bookingPageMembers)
    .where(eq(bookingPageMembers.pageId, page.id))
    .orderBy(asc(bookingPageMembers.position));
  return rows.length === 0 ? [page.ownerMemberId] : rows.map((row) => row.memberId);
}

/**
 * Who hosts a slot: the owner of a personal page, the first required member
 * (the event's organiser) of a collective one. Round robin waits for #58's
 * `assignOwner`, so it is refused.
 */
export function pickHost(page: PageRecord, members: readonly string[]): string {
  if (page.kind === 'round_robin') throw refuse('BOOKING_CLOSED', 'This page can’t take bookings yet.');
  return page.kind === 'collective' ? (members[0] ?? page.ownerMemberId) : page.ownerMemberId;
}

/** The members' confirmed bookings whose blocked range touches [from, to), as the engine reads them. */
export async function bookedSpans(
  tx: WorkspaceTx,
  memberIds: readonly string[],
  pageId: string,
  from: Date,
  to: Date,
  /** A booking being moved: its own time never blocks it. */
  except?: string,
): Promise<readonly BookedSpan[]> {
  const rows = await tx
    .select({
      pageId: bookings.pageId,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      blockStart: sql<string>`lower(${bookings.during})`,
      blockEnd: sql<string>`upper(${bookings.during})`,
    })
    .from(bookings)
    .where(
      and(
        inArray(bookings.hostMemberId, [...memberIds]),
        eq(bookings.status, 'confirmed'),
        ...(except === undefined ? [] : [ne(bookings.id, except)]),
        lt(bookings.startsAt, new Date(to.getTime() + 86_400_000)),
        gt(bookings.endsAt, new Date(from.getTime() - 86_400_000)),
      ),
    );
  return rows.map((row) => ({
    start: row.startsAt,
    end: row.endsAt,
    blockStart: new Date(row.blockStart),
    blockEnd: new Date(row.blockEnd),
    countsToLimit: row.pageId === pageId,
  }));
}

/** The time the members closed themselves (spec 0027): busy for this page, and the holds it may book inside. */
export interface MembersClosed {
  readonly busy: readonly Span[];
  readonly openHolds: readonly Span[];
}

/** Every member's blocks and holds touching [from, to), as they apply to `page` (AC-706, AC-707). */
export async function membersClosed(
  tx: WorkspaceTx,
  memberIds: readonly string[],
  page: Pick<PageRecord, 'id' | 'isPrivate'>,
  from: Date,
  to: Date,
): Promise<MembersClosed> {
  const each = await Promise.all(memberIds.map((member) => blockedTime(tx, member, from, to, page)));
  return {
    busy: each.flatMap((closed) => closed.busy),
    // A collective page's hold must be every member's: only the first member's (the host's) holds open anything.
    openHolds: page.isPrivate && memberIds.length === 1 ? (each[0]?.openHolds ?? []) : [],
  };
}

/** What the members' calendars said, together: their busy spans, and whether any refused us until reconnected. */
export interface MembersBusy {
  readonly busy: readonly Span[];
  readonly blocked: boolean;
  /** No member has a calendar connected (AC-631: the builder warns). */
  readonly noCalendar: boolean;
}

/** Every member's busy times over [from, to), each read once, through the reader the api passed in. */
export async function membersBusy(
  read: BusyReader,
  workspaceId: string,
  memberIds: readonly string[],
  from: Date,
  to: Date,
): Promise<MembersBusy> {
  // A reader answers at most 62 days at once; a page's 62 day chunk plus its margins can be a few hours more
  // (any read made before 06:00 in the visitor's zone), so a longer range is read in pieces.
  const windows = busyWindows(from, to);
  const answers = await Promise.all(
    memberIds.flatMap((memberId) =>
      windows.map((window) =>
        read({ workspaceId, memberId, from: window.from.toISOString(), to: window.to.toISOString() }),
      ),
    ),
  );
  return {
    busy: answers.flatMap((answer) =>
      answer.status === 'read'
        ? answer.busy.map((each) => ({ start: new Date(each.start), end: new Date(each.end) }))
        : [],
    ),
    blocked: answers.some((answer) => answer.status === 'blocked'),
    noCalendar: answers.every((answer) => answer.status === 'none'),
  };
}

/** [from, to) cut into back to back pieces no longer than one free and busy read takes. */
export function busyWindows(from: Date, to: Date): readonly { readonly from: Date; readonly to: Date }[] {
  const most = FREE_BUSY_MAX_DAYS * 86_400_000;
  const pieces: { readonly from: Date; readonly to: Date }[] = [];
  for (let start = from.getTime(); start < to.getTime(); start += most) {
    pieces.push({ from: new Date(start), to: new Date(Math.min(start + most, to.getTime())) });
  }
  return pieces.length === 0 ? [{ from, to }] : pieces;
}

/** The margin read around a range for busy times and bookings: a slot's buffers reach past it. */
export const BUSY_MARGIN_MS = 3 * 60 * 60_000;

/** The page's slots of one length in [from, to): its hours, minus busy times and bookings, by the engine. */
export function pageSlots(
  page: PageRecord,
  input: {
    readonly duration: number;
    readonly from: Date;
    readonly to: Date;
    readonly now: Date;
    readonly busy: MembersBusy;
    readonly bookings: readonly BookedSpan[];
    /** The members' own blocks and holds; none when absent. */
    readonly closed?: MembersClosed;
  },
): readonly Span[] {
  if (input.busy.blocked) return [];
  const { rules, overrides } = engineHours(page.availability);
  const closed = input.closed ?? { busy: [], openHolds: [] };
  return computeSlots({
    rules,
    overrides,
    busy: [...input.busy.busy, ...closed.busy],
    extraWindows: closed.openHolds,
    bookings: input.bookings,
    durationMinutes: input.duration,
    bufferBefore: page.bufferBefore,
    bufferAfter: page.bufferAfter,
    hostZone: page.availability.timeZone,
    now: input.now,
    from: input.from,
    to: input.to,
    minNoticeMinutes: page.isPrivate ? 0 : page.minNoticeMinutes,
    windowDays: page.windowDays,
    ...(page.dailyLimit === null ? {} : { dailyLimit: page.dailyLimit }),
    ...(page.slotStep === null ? {} : { slotStepMinutes: page.slotStep }),
  });
}
