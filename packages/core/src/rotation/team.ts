// A team page's hosts and their slots (spec 0029, AC-734 to AC-736; spec
// 0037, AC-1319, AC-1320, AC-1325, AC-1326): who a round robin or collective
// page books, each member's own hours, bookings (every page they are on,
// through `booking_hosts`), blocks and calendar busy times, and the engine
// run once per member. Shared by the public slots read, the booking's
// recheck under the host locks, and a move.
//
// A round robin page has 0 to 7 fixed hosts, who attend every meeting, and 1
// to 3 rotations, one host from each. A time is offered when every fixed host
// is free and each rotation can be given a different free member: switched
// on, not a fixed host, not waiting under Even, and under their daily and
// weekly caps that day (counted in their own zone, Monday to Sunday).
//
// Hours come from spec 0035's schedules: a round robin page books each member
// by their own default schedule (spec 0037; the virtual weekdays 09:00 to
// 17:00 in the page's zone until they save one); a collective page books
// everyone by the page's own hours.
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { defaultAvailability, type BookingAvailability } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { resolveMany } from '../availability/resolve.ts';
import { blockedTimes } from '../booking/blocks.ts';
import type { BusyReader } from '../booking/calendar.ts';
import type { BookedSpan, Span } from '../booking/engine.ts';
import {
  memberBookings,
  membersOf,
  pageSlots,
  type MembersBusy,
  type MembersClosed,
  type PageRecord,
} from '../booking/slots.ts';
import { intersectSlots, unionSlots } from './combine.ts';
import { capStarts, windowCounts, windowStart, type WindowCount } from './ledger.ts';
import { evenWaiting, hallHolds, type Candidate, type PickRules } from './pick.ts';
import { rosterCalibration } from './roster.ts';

const { bookingPageRotations, members, rotationRoster, rotations } = schema;

/** The roles that may take bookings from a rotation: guests never (spec 0037, AC-729 narrowed); unknown roles fail closed. */
export const ROTATION_ROLES: readonly string[] = ['owner', 'admin', 'member'];

/** The most fixed hosts, rotations and hosts in all on one round robin page (spec 0037, AC-1319). */
export const TEAM_LIMITS = { fixed: 7, rotations: 3, hosts: 8 } as const;

/** A rotation as booking reads it. */
export interface RotationRules extends PickRules {
  readonly id: string;
  readonly name: string;
  readonly evenGap: number;
  readonly windowDays: number;
}

/** One switched on member of a rotation, with what the rotation knows of them. */
export interface RotationMember {
  readonly memberId: string;
  readonly weight: number;
  readonly priority: number;
  readonly dailyCap: number | null;
  readonly weeklyCap: number | null;
  readonly calibration: number;
  /**
   * Their settings are stored. Always so in a rotation of chosen people; in "Everyone on the roster" someone with no
   * row yet takes the pool's average on read (`rosterCalibration`) until their first assignment stores it.
   */
  readonly stored?: boolean;
  /** No row yet, and joined the workspace after "Everyone on the roster" was made (`rosterCalibration`). */
  readonly joinsLate?: boolean;
}

/** A rotation a round robin page books from, and its members who may take work now. */
export interface PageRotation {
  readonly rules: RotationRules;
  readonly members: readonly RotationMember[];
}

/** Who a team page books: a collective page's required members, or a round robin page's fixed hosts and rotations. */
export type Team =
  | { readonly kind: 'collective'; readonly required: readonly string[] }
  | {
      readonly kind: 'round_robin';
      readonly fixed: readonly string[];
      readonly rotations: readonly PageRotation[];
    };

/** Everyone a team page might book, each once: required members, or fixed hosts then every rotation's members. */
export function teamMemberIds(team: Team): readonly string[] {
  if (team.kind === 'collective') return team.required;
  return [
    ...new Set([...team.fixed, ...team.rotations.flatMap((rotation) => rotation.members.map((m) => m.memberId))]),
  ];
}

/** A stored strategy and returning rule, read safely. */
const strategyOf = (value: string): RotationRules['strategy'] =>
  value === 'priority' || value === 'even' ? value : 'fair';
const returningOf = (value: string): RotationRules['returning'] =>
  value === 'last_host' || value === 'none' ? value : 'owner';

/** A rotation row as booking reads it. */
export function rulesOf(row: typeof rotations.$inferSelect): RotationRules {
  return {
    id: row.id,
    name: row.name,
    strategy: strategyOf(row.strategy),
    evenGap: row.evenGap,
    windowDays: row.windowDays,
    returning: returningOf(row.returning),
  };
}

/** A round robin page's live rotations, by position (`booking_page_rotations`, AC-1428: the only place they live). */
export async function pageRotations(tx: WorkspaceTx, pageId: string): Promise<readonly RotationRules[]> {
  const rows = await tx
    .select({ rotation: rotations })
    .from(bookingPageRotations)
    .innerJoin(
      rotations,
      and(
        eq(rotations.workspaceId, bookingPageRotations.workspaceId),
        eq(rotations.id, bookingPageRotations.rotationId),
      ),
    )
    .where(and(eq(bookingPageRotations.pageId, pageId), isNull(rotations.deletedAt)))
    .orderBy(asc(bookingPageRotations.position));
  return rows.map((row) => rulesOf(row.rotation));
}

/**
 * Each rotation's members who may take work now (AC-729, AC-731): switched
 * on, active in the workspace, and not a guest, in the rotation's order. Read
 * through `rotation_roster`, so "Everyone on the roster" (the workspace link)
 * holds every such member, whether or not they have settings of their own.
 */
export async function eligibleMembers(
  tx: WorkspaceTx,
  rotationIds: readonly string[],
): Promise<ReadonlyMap<string, readonly RotationMember[]>> {
  const found = new Map<string, RotationMember[]>(rotationIds.map((id) => [id, []]));
  if (rotationIds.length === 0) return found;
  const rows = await tx
    .select({
      rotationId: rotationRoster.rotationId,
      memberId: rotationRoster.memberId,
      weight: rotationRoster.weight,
      priority: rotationRoster.priority,
      dailyCap: rotationRoster.dailyCap,
      weeklyCap: rotationRoster.weeklyCap,
      calibration: rotationRoster.calibration,
      stored: rotationRoster.stored,
      joinsLate: rotationRoster.joinsLate,
    })
    .from(rotationRoster)
    .innerJoin(
      members,
      and(eq(members.workspaceId, rotationRoster.workspaceId), eq(members.id, rotationRoster.memberId)),
    )
    .where(
      and(
        inArray(rotationRoster.rotationId, [...rotationIds]),
        eq(rotationRoster.isOn, true),
        eq(members.status, 'active'),
        sql`${members.role}::text in (${sql.join(
          ROTATION_ROLES.map((role) => sql`${role}`),
          sql`, `,
        )})`,
      ),
    )
    .orderBy(asc(rotationRoster.position), asc(members.name), asc(rotationRoster.memberId));
  for (const { rotationId, ...member } of rows) found.get(rotationId)?.push(member);
  return found;
}

/** A round robin page's fixed hosts, active and not guests, by position (`booking_page_members`). */
async function fixedHosts(tx: WorkspaceTx, page: PageRecord): Promise<readonly string[]> {
  const rows = await tx.execute<{ member_id: string }>(sql`
    select pm.member_id::text as member_id
    from booking_page_members pm
    join members m on m.workspace_id = pm.workspace_id and m.id = pm.member_id
    where pm.page_id = ${page.id}::uuid and m.status = 'active'
      and m.role::text in (${sql.join(
        ROTATION_ROLES.map((role) => sql`${role}`),
        sql`, `,
      )})
    order by pm.position, pm.member_id
  `);
  return rows.rows.map((row) => row.member_id);
}

/** Who a team page books, or undefined for a personal page. */
export async function loadTeam(tx: WorkspaceTx, page: PageRecord): Promise<Team | undefined> {
  if (page.kind === 'collective') return { kind: 'collective', required: await membersOf(tx, page) };
  if (page.kind !== 'round_robin') return undefined;
  const rules = await pageRotations(tx, page.id);
  const eligible = await eligibleMembers(
    tx,
    rules.map((rule) => rule.id),
  );
  return {
    kind: 'round_robin',
    fixed: await fixedHosts(tx, page),
    rotations: rules.map((rule) => ({ rules: rule, members: eligible.get(rule.id) ?? [] })),
  };
}

/** Each member's hours as the page books them, and the zone their own day is counted in (caps). */
export interface MemberHours {
  readonly hours: ReadonlyMap<string, BookingAvailability>;
  readonly zones: ReadonlyMap<string, string>;
}

/**
 * Each member's hours and zone, read once: on a round robin page their own default schedule (spec 0037, AC-1326's
 * zone; spec 0029 notes the open question), on a collective page the page's hours. Zones are always the member's.
 */
export async function memberHours(
  tx: WorkspaceTx,
  page: PageRecord,
  memberIds: readonly string[],
): Promise<MemberHours> {
  const fallbackZone = page.availability.timeZone;
  const resolved = await resolveMany(
    tx,
    memberIds.map((memberId) => ({ memberId, fallbackZone })),
  );
  const own = new Map(memberIds.map((memberId, index) => [memberId, resolved[index]?.availability]));
  return {
    hours: new Map(
      memberIds.map((memberId) => [
        memberId,
        page.kind === 'round_robin' ? (own.get(memberId) ?? defaultAvailability(fallbackZone)) : page.availability,
      ]),
    ),
    zones: new Map(memberIds.map((memberId) => [memberId, own.get(memberId)?.timeZone ?? fallbackZone])),
  };
}

/** Each member's blocks, and the holds a private page may book inside (spec 0027), touching [from, to). */
export async function memberClosed(
  tx: WorkspaceTx,
  memberIds: readonly string[],
  page: Pick<PageRecord, 'id' | 'isPrivate'>,
  from: Date,
  to: Date,
): Promise<ReadonlyMap<string, MembersClosed>> {
  // One read for every member: "Everyone on the roster" may be the whole workspace.
  const closed = await blockedTimes(tx, memberIds, from, to, page);
  return new Map(
    memberIds.map((memberId) => {
      const theirs = closed.get(memberId) ?? { busy: [], openHolds: [] };
      return [memberId, { busy: theirs.busy, openHolds: page.isPrivate ? theirs.openHolds : [] }] as const;
    }),
  );
}

/**
 * How many members' calendars one read asks at once: a team page's 20 in three rounds, and "Everyone on the
 * roster" on a big workspace never a burst of a hundred calls at the providers.
 */
const BUSY_READS_AT_ONCE = 8;

/** Each member's calendars, read once each, `BUSY_READS_AT_ONCE` at a time, outside any transaction. */
export async function memberBusy(
  read: BusyReader,
  workspaceId: string,
  memberIds: readonly string[],
  from: Date,
  to: Date,
): Promise<ReadonlyMap<string, MembersBusy>> {
  const readOne = async (memberId: string) => {
    const answer = await read({ workspaceId, memberId, from: from.toISOString(), to: to.toISOString() });
    const busy: MembersBusy = {
      busy:
        answer.status === 'read'
          ? answer.busy.map((each) => ({ start: new Date(each.start), end: new Date(each.end) }))
          : [],
      blocked: answer.status === 'blocked',
      noCalendar: answer.status === 'none',
    };
    return [memberId, busy] as const;
  };
  const answers: (readonly [string, MembersBusy])[] = [];
  for (let start = 0; start < memberIds.length; start += BUSY_READS_AT_ONCE) {
    answers.push(...(await Promise.all(memberIds.slice(start, start + BUSY_READS_AT_ONCE).map(readOne))));
  }
  return new Map(answers);
}

const DAY_MS = 86_400_000;

/** One rotation's standing: its members' live counts in the window, and the times their live assignments count on. */
export interface RotationStanding {
  readonly counts: ReadonlyMap<string, WindowCount>;
  /** Each member's assignments' meeting starts (a booking's) or assignment times (a lead's), for the caps. */
  readonly starts: ReadonlyMap<string, readonly Date[]>;
}

/** What the team's slots were computed from, per member and per rotation. */
export interface TeamReads {
  readonly hours: ReadonlyMap<string, BookingAvailability>;
  readonly zones: ReadonlyMap<string, string>;
  readonly busy: ReadonlyMap<string, MembersBusy>;
  readonly bookings: ReadonlyMap<string, readonly BookedSpan[]>;
  readonly closed: ReadonlyMap<string, MembersClosed>;
  /** By rotation id (round robin only). */
  readonly standing: ReadonlyMap<string, RotationStanding>;
}

/** One member's slots of one length in [from, to): the page's rules, the member's hours, busy times and bookings. */
export function memberSlots(
  page: PageRecord,
  memberId: string,
  reads: Pick<TeamReads, 'hours' | 'busy' | 'bookings' | 'closed'>,
  input: { readonly duration: number; readonly from: Date; readonly to: Date; readonly now: Date },
): readonly Span[] {
  const busy = reads.busy.get(memberId) ?? { busy: [], blocked: false, noCalendar: true };
  return pageSlots(
    { ...page, availability: reads.hours.get(memberId) ?? page.availability },
    {
      ...input,
      busy,
      bookings: reads.bookings.get(memberId) ?? [],
      closed: reads.closed.get(memberId) ?? { busy: [], openHolds: [] },
    },
  );
}

/** A rotation's members as the pick reads them: their counts in the window and calibration. */
export function candidatesOf(rotation: PageRotation, standing: RotationStanding | undefined): readonly Candidate[] {
  const calibrated = rosterCalibration(
    rotation.members.map((member) => ({ ...member, count: standing?.counts.get(member.memberId)?.count ?? 0 })),
  );
  return rotation.members.map((member, index) => {
    const counted = standing?.counts.get(member.memberId);
    return {
      memberId: member.memberId,
      count: counted?.count ?? 0,
      calibration: calibrated[index] ?? member.calibration,
      weight: member.weight,
      priority: member.priority,
      ...(counted === undefined ? {} : { lastAssignedAt: counted.lastAssignedAt }),
    };
  });
}

/** Whether a member is under their daily and weekly caps (AC-731, AC-1326) on the day of `at`, in their zone. */
export function underCaps(member: RotationMember, starts: readonly Date[], zone: string, at: Date): boolean {
  return capCheck(member, starts, zone)(at);
}

/**
 * A member's cap check, their starts counted once by day and by ISO week (Luxon's weeks start on Monday, as the caps
 * count) in their zone, so checking a slot is two lookups rather than a pass over every start.
 */
function capCheck(member: RotationMember, starts: readonly Date[], zone: string): (at: Date) => boolean {
  const { dailyCap, weeklyCap } = member;
  if (dailyCap === null && weeklyCap === null) return () => true;
  const days = new Map<string, number>();
  const weeks = new Map<string, number>();
  const keysOf = (date: Date) => {
    const local = DateTime.fromJSDate(date, { zone });
    return { day: local.toISODate() ?? '', week: local.startOf('week').toISODate() ?? '' };
  };
  for (const start of starts) {
    const keys = keysOf(start);
    days.set(keys.day, (days.get(keys.day) ?? 0) + 1);
    weeks.set(keys.week, (weeks.get(keys.week) ?? 0) + 1);
  }
  return (at) => {
    const keys = keysOf(at);
    return (
      (dailyCap === null || (days.get(keys.day) ?? 0) < dailyCap) &&
      (weeklyCap === null || (weeks.get(keys.week) ?? 0) < weeklyCap)
    );
  };
}

/** What every slot's candidates read per rotation, worked out once: who waits under Even, and each member's cap check. */
export interface PreparedRotations {
  readonly waiting: readonly ReadonlySet<string>[];
  readonly caps: readonly ReadonlyMap<string, (at: Date) => boolean>[];
}

/** Prepares the team's rotations for many slots' candidates (the slots read checks thousands of slots). */
export function prepareRotations(
  team: Extract<Team, { kind: 'round_robin' }>,
  reads: Pick<TeamReads, 'zones' | 'standing'>,
): PreparedRotations {
  return {
    waiting: team.rotations.map((rotation) =>
      rotation.rules.strategy === 'even'
        ? evenWaiting(candidatesOf(rotation, reads.standing.get(rotation.rules.id)), rotation.rules.evenGap)
        : new Set<string>(),
    ),
    caps: team.rotations.map((rotation) => {
      const standing = reads.standing.get(rotation.rules.id);
      return new Map(
        rotation.members.map((member) => [
          member.memberId,
          capCheck(member, standing?.starts.get(member.memberId) ?? [], reads.zones.get(member.memberId) ?? 'UTC'),
        ]),
      );
    }),
  };
}

/** A team slot: its time, and each rotation's members free for it (empty for a collective page). */
export interface TeamSlot extends Span {
  readonly candidates: readonly (readonly string[])[];
}

/** The team's slots, and whether its calendars close the page. */
export interface TeamSlots {
  readonly slots: readonly TeamSlot[];
  /** Nothing is offered because calendars refuse us. */
  readonly blocked: boolean;
}

/**
 * Each rotation's candidates at one slot (AC-1320): switched on members free
 * then, not a fixed host, not waiting under Even, and under their caps.
 */
export function slotCandidates(
  team: Extract<Team, { kind: 'round_robin' }>,
  reads: Pick<TeamReads, 'zones' | 'standing'>,
  freeAt: (memberId: string) => boolean,
  at: Date,
  prepared: PreparedRotations = prepareRotations(team, reads),
): readonly (readonly string[])[] {
  const fixed = new Set(team.fixed);
  return team.rotations.map((rotation, index) => {
    const waiting = prepared.waiting[index];
    const caps = prepared.caps[index];
    return rotation.members
      .filter(
        (member) =>
          !fixed.has(member.memberId) &&
          waiting?.has(member.memberId) !== true &&
          freeAt(member.memberId) &&
          caps?.get(member.memberId)?.(at) !== false,
      )
      .map((member) => member.memberId);
  });
}

/**
 * The team's slots (AC-734 to AC-736, AC-1320). Collective: the
 * intersection, closed when any required member's calendar refuses us. Round
 * robin: every fixed host free, and the rotations' candidates able to fill a
 * seat each; a member whose calendar refuses us is left out (the page closes
 * when a fixed host's does, or a rotation has nobody left).
 */
export function teamSlots(
  page: PageRecord,
  team: Team,
  reads: TeamReads,
  input: { readonly duration: number; readonly from: Date; readonly to: Date; readonly now: Date },
): TeamSlots {
  const ids = teamMemberIds(team);
  const isBlocked = (memberId: string) => reads.busy.get(memberId)?.blocked === true;
  if (team.kind === 'collective') {
    if (ids.some(isBlocked) || ids.length === 0) return { slots: [], blocked: ids.some(isBlocked) };
    const perMember = new Map(ids.map((memberId) => [memberId, memberSlots(page, memberId, reads, input)]));
    return {
      slots: intersectSlots(perMember, ids).map((slot) => ({ start: slot.start, end: slot.end, candidates: [] })),
      blocked: false,
    };
  }
  const closed =
    team.rotations.length === 0 ||
    team.fixed.some(isBlocked) ||
    team.rotations.some(
      (rotation) => rotation.members.length > 0 && rotation.members.every((member) => isBlocked(member.memberId)),
    );
  if (closed) return { slots: [], blocked: team.rotations.length > 0 };
  const open = ids.filter((memberId) => !isBlocked(memberId));
  const perMember = new Map(open.map((memberId) => [memberId, memberSlots(page, memberId, reads, input)]));
  const union = unionSlots(perMember);
  const prepared = prepareRotations(team, reads);
  const slots: TeamSlot[] = [];
  for (const slot of union) {
    const free = new Set(slot.memberIds);
    if (!team.fixed.every((memberId) => free.has(memberId))) continue;
    const candidates = slotCandidates(team, reads, (memberId) => free.has(memberId), slot.start, prepared);
    if (hallHolds(candidates)) slots.push({ start: slot.start, end: slot.end, candidates });
  }
  return { slots, blocked: false };
}

/** Everything a team's slots read from the database for [from, to), the busy times passed in. */
export async function readTeam(
  tx: WorkspaceTx,
  page: PageRecord,
  team: Team,
  busy: ReadonlyMap<string, MembersBusy>,
  range: {
    readonly from: Date;
    readonly to: Date;
    readonly margin: number;
    readonly now: Date;
    readonly except?: string;
    /** Only these members (a recheck reads its candidates); everyone on the page when absent. */
    readonly only?: readonly string[];
  },
): Promise<TeamReads> {
  const memberIds = range.only ?? teamMemberIds(team);
  const from = new Date(range.from.getTime() - range.margin);
  const to = new Date(range.to.getTime() + range.margin);
  const { hours, zones } = await memberHours(tx, page, memberIds);
  const standing = new Map<string, RotationStanding>();
  if (team.kind === 'round_robin') {
    for (const rotation of team.rotations) {
      const ids = rotation.members.map((member) => member.memberId);
      standing.set(rotation.rules.id, {
        counts: await windowCounts(tx, rotation.rules.id, windowStart(range.now, rotation.rules.windowDays)),
        // A week either side, so the weekly cap counts the whole of each week the range touches.
        starts: await capStarts(
          tx,
          rotation.rules.id,
          ids,
          new Date(range.from.getTime() - 8 * DAY_MS),
          new Date(range.to.getTime() + 8 * DAY_MS),
          range.except,
        ),
      });
    }
  }
  return {
    hours,
    zones,
    busy,
    // A day either side, so the daily limit counts the whole of each day the range touches.
    bookings: await memberBookings(
      tx,
      memberIds,
      page.id,
      new Date(range.from.getTime() - DAY_MS),
      new Date(range.to.getTime() + DAY_MS),
      range.except,
    ),
    closed: await memberClosed(tx, memberIds, page, from, to),
    standing,
  };
}
