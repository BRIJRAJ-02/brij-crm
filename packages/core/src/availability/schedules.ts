// Availability schedules (spec 0035): list, read, make, rename and change,
// set as default, duplicate and delete a member's schedules. A member reads
// their own with `booking.manage` and changes them with `availability.own`
// too (spec 0037, AC-1260: without it their hours are set by others); a
// colleague's are read with See reach and changed with Manage (`canActFor`,
// AC-971 as spec 0037 replaces it). A schedule the reader may not see answers
// as absent (NOT_FOUND). Every write is audited (`schedule.changed`) and, when
// someone else made it, queues the member's notice (AC-1263, AC-1264, AC-1444).
// Every write takes the member's schedules lock (the 20 limit, the one
// default, the names) and records `Change.schedules`, so the outbox stores
// one `schedules` row (ids only) and the member's other tabs read again
// (AC-977). A change applies to the next slot read of every page using the
// schedule; bookings already made never move (AC-968).
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  DEFAULT_SCHEDULE_NAME,
  PERMISSIONS,
  SCHEDULES_MAX,
  type BookingAvailability,
  type ScheduleList,
  type ScheduleMembers,
  type ScheduleUser,
  type ScheduleView,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { canActFor, schedulingReach, type SchedulingReach } from '../access/scheduling.ts';
import { inWorkspace } from '../access/run.ts';
import { isUuidV7, newId } from '../engine/ids.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { writeAudit } from '../members/audit.ts';
import {
  queueSchedulingNotice,
  SCHEDULE_AUDIT_FIELDS,
  type ScheduleAudited,
  type ScheduleAuditEntry,
} from '../scheduling/notice.ts';
import { lockKey } from '../booking/locks.ts';
import { hoursOf, virtualDefault, withoutNotes } from './resolve.ts';
import { fallbackZoneOf } from '../booking/slots.ts';

const { availabilitySchedules, bookingPageMembers, bookingPages, members } = schema;

type ScheduleRow = typeof availabilitySchedules.$inferSelect;

const NOT_FOUND_MESSAGE = 'That schedule doesn’t exist, or isn’t yours.';
const LIMIT_MESSAGE = `You have ${String(SCHEDULES_MAX)} schedules. Delete one to make another.`;

/** The member the scope acts for, or undefined (a key, the system). */
function memberOf(scope: EngineScope): string | undefined {
  return scope.access.principal.kind === 'member' ? scope.access.principal.memberId : undefined;
}

/**
 * Whether the reader may change their own schedules: `booking.manage` and `availability.own` (spec 0037, AC-1260),
 * the one place a member's own edit is decided.
 */
export function mayEditOwnHours(scope: EngineScope): boolean {
  return can(scope.access, 'booking.manage') && can(scope.access, 'availability.own');
}

/** Why the reader can't change their own hours: no `booking.manage`, or hours set by others (AC-1260). */
function ownHoursRefusal(scope: EngineScope) {
  return can(scope.access, 'booking.manage')
    ? refuse('FORBIDDEN', HOURS_SET_BY_OTHERS)
    : refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
}

/** A member without `availability.own` reads this on their own hours and on every write to them (AC-1260). */
export const HOURS_SET_BY_OTHERS = PERMISSIONS['availability.own'].message;

/**
 * Whether the reader may change `memberId`'s schedules: their own (`mayEditOwnHours`), or a colleague's they
 * manage (`canActFor` over their hours, spec 0037: owners and admins everyone's, delegates whom they name).
 */
function mayChange(scope: EngineScope, reach: SchedulingReach, memberId: string): boolean {
  return memberId === memberOf(scope) ? mayEditOwnHours(scope) : canActFor(reach, memberId, 'manage', 'hours');
}

/** Whether `memberId` is an active member of the workspace. */
async function isActive(tx: WorkspaceTx, memberId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.status, 'active')));
  return row !== undefined;
}

/** Refused when the reader may see a colleague's scheduling but not change it (spec 0037, AC-1258). */
const seeOnly = () => refuse('FORBIDDEN', 'You can see this person’s scheduling but not change it.');

const NO_MEMBER_MESSAGE = 'That member isn’t in this workspace.';

/**
 * The member whose schedules a call is about: the caller (`booking.manage`, and to write `mayEditOwnHours`), or
 * with `memberId` an active colleague in the reader's reach (`canActFor`): outside it, or not active, NOT_FOUND,
 * the same as a member who doesn't exist; seen but not managed, FORBIDDEN for a write.
 */
async function targetMember(
  tx: WorkspaceTx,
  scope: EngineScope,
  memberId: string | undefined,
  use: 'read' | 'write',
): Promise<string> {
  const caller = memberOf(scope);
  if (memberId === undefined || memberId === caller) {
    if (caller === undefined) throw refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
    if (use === 'write' && !mayEditOwnHours(scope)) throw ownHoursRefusal(scope);
    return caller;
  }
  const reach = await schedulingReach(tx, scope);
  if (!canActFor(reach, memberId, 'view')) throw refuse('NOT_FOUND', NO_MEMBER_MESSAGE);
  const [row] = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.status, 'active')));
  if (row === undefined) throw refuse('NOT_FOUND', NO_MEMBER_MESSAGE);
  // Hours (spec 0037, AC-1255): Manage from a member's own grant doesn't change hours set by others.
  if (use === 'write' && !canActFor(reach, memberId, 'manage', 'hours')) throw seeOnly();
  return row.id;
}

/**
 * What one schedule write changed, for the seam after it: whose schedules, the kind of write, and each schedule it
 * touched as it was and as it is now (no `before` on a schedule it made, no `after` on one it deleted).
 */
interface ScheduleChange {
  readonly kind: 'create' | 'update' | 'set_default' | 'duplicate' | 'delete' | 'default_hours';
  readonly memberId: string;
  readonly schedules: readonly { readonly id: string; readonly before?: ScheduleRow; readonly after?: ScheduleRow }[];
}

/**
 * After a schedule write, inside its transaction, with what it changed (spec 0037, AC-1444): one `schedule.changed`
 * audit row (AC-1263) naming the member and, per schedule, the fields that changed before and after (a day off's
 * note never: it is the member's alone); and, when the actor isn't the schedule's member, their notice queued
 * (AC-1264), which gathers ten minutes of one actor's changes into one email.
 */
async function afterScheduleChange(context: WriteContext, scope: EngineScope, change: ScheduleChange): Promise<void> {
  const sides = scheduleAuditSides(change);
  if (sides === undefined) return;
  await writeAudit(context.tx, scope.workspaceId, scope.actor, {
    action: 'schedule.changed',
    targetType: 'member',
    targetId: change.memberId,
    before: sides.before,
    after: sides.after,
  });
  const actor = memberOf(scope);
  if (actor !== undefined && actor !== change.memberId) await queueSchedulingNotice(context.tx, actor, change.memberId);
}

/** A stored schedule as an audit row keeps it: its name, default mark, week and overrides, notes left out. */
function auditedOf(row: ScheduleRow): ScheduleAudited {
  const hours = withoutNotes(hoursOf(row.availability, 'UTC'));
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    timeZone: hours.timeZone,
    weekly: hours.weekly,
    overrides: hours.overrides,
  };
}

/**
 * The audit row's two sides for one write: each schedule it touched, before and after, with only the fields that
 * changed (and its name, which a line needs), or undefined when nothing did.
 */
function scheduleAuditSides(
  change: ScheduleChange,
): { readonly before: Record<string, unknown>; readonly after: Record<string, unknown> } | undefined {
  const before: ScheduleAuditEntry[] = [];
  const after: ScheduleAuditEntry[] = [];
  for (const each of change.schedules) {
    const was = each.before === undefined ? undefined : auditedOf(each.before);
    const now = each.after === undefined ? undefined : auditedOf(each.after);
    if (was === undefined || now === undefined) {
      if (was !== undefined) before.push(was);
      if (now !== undefined) after.push(now);
      continue;
    }
    const fields = SCHEDULE_AUDIT_FIELDS.filter((field) => JSON.stringify(was[field]) !== JSON.stringify(now[field]));
    if (fields.length === 0) continue;
    const pick = (side: ScheduleAudited): ScheduleAuditEntry => ({
      id: side.id,
      name: side.name,
      ...Object.fromEntries(fields.map((field) => [field, side[field]])),
    });
    before.push(pick(was));
    after.push(pick(now));
  }
  if (before.length === 0 && after.length === 0) return undefined;
  const base = { memberId: change.memberId, kind: change.kind };
  return { before: { ...base, schedules: before }, after: { ...base, schedules: after } };
}

/**
 * Every schedule write's one way in (spec 0037, AC-1444): `body` runs as one write and answers what it changed;
 * the outbox records its schedule ids (one `schedules` row) and `afterScheduleChange` sees it, in the same
 * transaction. A write that changes nothing (a retried create, the default set as default) answers no change.
 */
async function writeSchedules<T>(
  scope: EngineScope,
  hooks: readonly AfterWrite[],
  body: (context: WriteContext) => Promise<{ readonly result: T; readonly change?: ScheduleChange }>,
): Promise<T> {
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { result: answer, change } = await body(context);
      if (change !== undefined) {
        context.record({ schedules: change.schedules.map((each) => each.id) });
        await afterScheduleChange(context, scope, change);
      }
      return answer;
    },
    hooks,
  );
  return result;
}

/** The lock on one member's schedules: every write to them takes it, so the limit, default and names hold. */
const schedulesLock = (tx: WorkspaceTx, workspaceId: string, memberId: string) =>
  lockKey(tx, `availability:schedules:${workspaceId}:${memberId}`);

/** The member's live pages and the schedule each names (null: the default), for "Used by" (AC-969). */
async function pagesOfMember(
  tx: WorkspaceTx,
  memberId: string,
): Promise<readonly { readonly id: string; readonly title: string; readonly scheduleId: string | null }[]> {
  return tx
    .select({ id: bookingPages.id, title: bookingPages.title, scheduleId: bookingPages.scheduleId })
    .from(bookingPages)
    .where(and(eq(bookingPages.ownerMemberId, memberId), isNull(bookingPages.deletedAt)))
    .orderBy(asc(bookingPages.title), asc(bookingPages.id))
    .limit(500);
}

/** The pages booking by one schedule: those naming it, and for the default those following the default. */
function usersOf(
  pages: Awaited<ReturnType<typeof pagesOfMember>>,
  schedule: { readonly id: string | null; readonly isDefault: boolean },
): ScheduleUser[] {
  return pages
    .filter((page) => (page.scheduleId === null ? schedule.isDefault : page.scheduleId === schedule.id))
    .map((page) => ({ id: page.id, title: page.title }));
}

/** A stored schedule as `reader` sees it: a day off's note only for the schedule's own member (AC-971). */
function viewOf(
  row: ScheduleRow,
  pages: Awaited<ReturnType<typeof pagesOfMember>>,
  reader: string | undefined,
): ScheduleView {
  const hours = hoursOf(row.availability, 'UTC');
  return {
    id: row.id,
    memberId: row.memberId,
    name: row.name,
    isDefault: row.isDefault,
    availability: reader === row.memberId ? hours : withoutNotes(hours),
    pages: usersOf(pages, row),
    updatedAt: row.updatedAt.toISOString(),
    // "Changed by Priya, 2 hours ago" (spec 0037, AC-1265): last changed by someone other than its member.
    ...(row.updatedByMemberId === null || row.updatedByMemberId === row.memberId
      ? {}
      : { changedBy: { memberId: row.updatedByMemberId, at: row.updatedAt.toISOString() } }),
  };
}

/**
 * Hours written by someone other than the schedule's member (an admin,
 * AC-971), who never saw its notes: each date the write keeps takes its
 * stored note back, so their save never wipes the member's reasons.
 */
function withNotesKept(written: BookingAvailability, stored: BookingAvailability): BookingAvailability {
  const notes = new Map(
    stored.overrides.flatMap((override) => (override.note === undefined ? [] : [[override.date, override.note]])),
  );
  if (notes.size === 0) return written;
  return {
    ...written,
    overrides: written.overrides.map((override) => {
      const note = override.note ?? notes.get(override.date);
      return note === undefined ? override : { ...override, note };
    }),
  };
}

/** The member's stored schedules: the default first, then by name ignoring case (AC-969). */
async function storedOf(tx: WorkspaceTx, memberId: string): Promise<readonly ScheduleRow[]> {
  return tx
    .select()
    .from(availabilitySchedules)
    .where(eq(availabilitySchedules.memberId, memberId))
    .orderBy(
      sql`${availabilitySchedules.isDefault} desc`,
      sql`lower(${availabilitySchedules.name})`,
      asc(availabilitySchedules.id),
    );
}

/** The member's schedules as `reader` lists them, with the virtual default first while none is stored. */
async function listOf(
  tx: WorkspaceTx,
  memberId: string,
  timeZone: string,
  reader: string | undefined,
): Promise<ScheduleList> {
  const [rows, pages] = await Promise.all([storedOf(tx, memberId), pagesOfMember(tx, memberId)]);
  const views = rows.map((row) => viewOf(row, pages, reader));
  const hasDefault = rows.some((row) => row.isDefault);
  const virtual = virtualDefault(timeZone);
  const virtualView: ScheduleView = {
    id: null,
    memberId,
    name: virtual.name,
    isDefault: true,
    availability: virtual.availability,
    pages: usersOf(pages, { id: null, isDefault: true }),
    updatedAt: null,
  };
  return { memberId, schedules: hasDefault ? views : [virtualView, ...views] };
}

/**
 * Whose schedules the reader may view (AC-971), by name: themselves, and with
 * `booking.admin` every active member, the same check `targetMember` makes.
 * The Viewing Select reads it, so spec 0037's reach changes it here alone.
 */
export async function listScheduleMembers(scope: EngineScope): Promise<ScheduleMembers> {
  requirePermission(scope, 'booking.manage');
  const caller = memberOf(scope);
  if (caller === undefined) throw refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
  return inWorkspace(scope, async (tx) => {
    const reach = await schedulingReach(tx, scope);
    // Everyone when the reach is; else the reader and the colleagues it names (spec 0037: teams, delegations).
    const named = [caller, ...[...reach.members.keys()].filter((id) => canActFor(reach, id, 'view'))];
    const rows = await tx
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(and(eq(members.status, 'active'), reach.all === undefined ? inArray(members.id, named) : undefined))
      .orderBy(sql`lower(${members.name})`, asc(members.id))
      .limit(1000);
    return { members: rows };
  });
}

/**
 * A member's schedules (AC-969): the caller's own, or another's with
 * `booking.admin`. A member who never saved hours sees the virtual default,
 * "Working hours" in `timeZone` (AC-963). Reads only: nothing is stored.
 */
export async function listSchedules(
  scope: EngineScope,
  input: { readonly memberId?: string | undefined; readonly timeZone: string },
): Promise<ScheduleList> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const memberId = await targetMember(tx, scope, input.memberId, 'read');
    return listOf(tx, memberId, input.timeZone, memberOf(scope));
  });
}

/**
 * The live pages the reader books on that use the schedule (AC-971): a
 * collective page's member may read the hours it books by, and sees only
 * those pages among its users, never the owner's others.
 */
async function pagesReaderBooksOn(
  tx: WorkspaceTx,
  reader: string,
  row: ScheduleRow,
): Promise<Awaited<ReturnType<typeof pagesOfMember>>> {
  return tx
    .select({ id: bookingPages.id, title: bookingPages.title, scheduleId: bookingPages.scheduleId })
    .from(bookingPages)
    .innerJoin(
      bookingPageMembers,
      and(eq(bookingPageMembers.workspaceId, bookingPages.workspaceId), eq(bookingPageMembers.pageId, bookingPages.id)),
    )
    .where(
      and(
        eq(bookingPageMembers.memberId, reader),
        isNull(bookingPages.deletedAt),
        eq(bookingPages.ownerMemberId, row.memberId),
        row.isDefault
          ? sql`(${bookingPages.scheduleId} = ${row.id} or ${bookingPages.scheduleId} is null)`
          : eq(bookingPages.scheduleId, row.id),
      ),
    )
    .orderBy(asc(bookingPages.title), asc(bookingPages.id))
    .limit(500);
}

/**
 * One schedule: the caller's own, anyone's with `booking.admin` (with every
 * page using it), or one a page they book on uses (with only those pages,
 * AC-971). Any other answers as absent.
 */
export async function getSchedule(scope: EngineScope, input: { readonly id: string }): Promise<ScheduleView> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const [row] = await tx.select().from(availabilitySchedules).where(eq(availabilitySchedules.id, input.id));
    if (row === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
    const reader = memberOf(scope);
    const reach = await schedulingReach(tx, scope);
    const isOwn = row.memberId === reader;
    if (isOwn || (canActFor(reach, row.memberId, 'view') && (await isActive(tx, row.memberId)))) {
      return viewOf(row, await pagesOfMember(tx, row.memberId), reader);
    }
    const through = reader === undefined ? [] : await pagesReaderBooksOn(tx, reader, row);
    if (through.length === 0) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
    return viewOf(row, through, reader);
  });
}

/**
 * The schedule, locked `for no key update`, with its member's schedules lock taken first; NOT_FOUND unless the
 * reader may change it. That lock lets a page write naming it (`checkPageSchedule`, `for key share`) go on, so a
 * delete never deadlocks with a page write that holds its page's row: the delete's repoint waits for that page.
 */
async function scheduleToChange(tx: WorkspaceTx, scope: EngineScope, id: string): Promise<ScheduleRow> {
  const [peek] = await tx
    .select({ memberId: availabilitySchedules.memberId })
    .from(availabilitySchedules)
    .where(eq(availabilitySchedules.id, id));
  const reach = await schedulingReach(tx, scope);
  if (peek === undefined || !canActFor(reach, peek.memberId, 'view')) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
  // A colleague's only while they are an active member, as `targetMember` holds a list to.
  if (peek.memberId !== memberOf(scope) && !(await isActive(tx, peek.memberId))) {
    throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
  }
  if (!mayChange(scope, reach, peek.memberId))
    throw peek.memberId === memberOf(scope) ? ownHoursRefusal(scope) : seeOnly();
  await schedulesLock(tx, scope.workspaceId, peek.memberId);
  const [row] = await tx
    .select()
    .from(availabilitySchedules)
    .where(eq(availabilitySchedules.id, id))
    .for('no key update');
  if (row === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
  return row;
}

/** NAME_TAKEN on `name` when another of the member's schedules has it, ignoring case. */
async function checkNameFree(tx: WorkspaceTx, memberId: string, name: string, except?: string): Promise<void> {
  const [clash] = await tx
    .select({ id: availabilitySchedules.id })
    .from(availabilitySchedules)
    .where(
      and(
        eq(availabilitySchedules.memberId, memberId),
        sql`lower(${availabilitySchedules.name}) = lower(${name})`,
        except === undefined ? undefined : ne(availabilitySchedules.id, except),
      ),
    )
    .limit(1);
  if (clash !== undefined) throw nameTaken(name);
}

const nameTaken = (name: string) => refuseOn('NAME_TAKEN', `Another schedule is called ${name}.`, 'name');

/** Translates the unique name index's refusal, should a race reach it, into NAME_TAKEN. */
function nameClash(error: unknown, name: string): unknown {
  return postgresError(error)?.constraint === 'availability_schedules_name' ? nameTaken(name) : error;
}

/** SCHEDULE_LIMIT unless the member has room for `adding` more of `SCHEDULES_MAX` (AC-961), counted under their lock. */
async function checkRoom(tx: WorkspaceTx, memberId: string, adding = 1): Promise<void> {
  const [counted] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(availabilitySchedules)
    .where(eq(availabilitySchedules.memberId, memberId));
  if ((counted?.count ?? 0) + adding > SCHEDULES_MAX) throw refuse('SCHEDULE_LIMIT', LIMIT_MESSAGE);
}

/** The member's stored default, if any. */
async function storedDefault(tx: WorkspaceTx, memberId: string): Promise<ScheduleRow | undefined> {
  const [row] = await tx
    .select()
    .from(availabilitySchedules)
    .where(and(eq(availabilitySchedules.memberId, memberId), eq(availabilitySchedules.isDefault, true)));
  return row;
}

/**
 * Clears the member's default mark, so another may take it (one transaction with the new mark, AC-962), and answers
 * the schedule it cleared, as it was and as it is.
 */
async function clearDefault(
  tx: WorkspaceTx,
  memberId: string,
): Promise<readonly { readonly id: string; readonly before: ScheduleRow; readonly after: ScheduleRow }[]> {
  const before = await storedDefault(tx, memberId);
  if (before === undefined) return [];
  const [after] = await tx
    .update(availabilitySchedules)
    .set({ isDefault: false })
    .where(eq(availabilitySchedules.id, before.id))
    .returning();
  return after === undefined ? [] : [{ id: before.id, before, after }];
}

/** Inserts one schedule as the scope's actor. */
async function insertSchedule(
  tx: WorkspaceTx,
  scope: EngineScope,
  values: {
    readonly id: string;
    readonly memberId: string;
    readonly name: string;
    readonly isDefault: boolean;
    readonly availability: BookingAvailability;
  },
): Promise<ScheduleRow> {
  const by = actorRow(scope.actor);
  try {
    const [row] = await tx
      .insert(availabilitySchedules)
      .values({
        workspaceId: scope.workspaceId,
        ...values,
        createdByType: by.type,
        createdById: by.id,
        createdByMemberId: by.memberId,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .returning();
    if (row === undefined) throw new Error('The schedule was not created.');
    return row;
  } catch (error) {
    throw nameClash(error, values.name);
  }
}

/** The zone of the member's newest live page: the zone its virtual default books in until they store one. */
async function newestPageZone(tx: WorkspaceTx, memberId: string): Promise<string | undefined> {
  const [page] = await tx
    .select({ availability: bookingPages.availability })
    .from(bookingPages)
    .where(and(eq(bookingPages.ownerMemberId, memberId), isNull(bookingPages.deletedAt)))
    .orderBy(sql`${bookingPages.createdAt} desc`, sql`${bookingPages.id} desc`)
    .limit(1);
  return page === undefined ? undefined : fallbackZoneOf(page);
}

/**
 * Stores the member's virtual default (AC-963): "Working hours", weekdays
 * 09:00 to 17:00 in `timeZone`, marked default. Should a schedule of theirs
 * already have that name, it takes the first free "Working hours 2", "… 3".
 */
async function storeVirtualDefault(
  tx: WorkspaceTx,
  scope: EngineScope,
  memberId: string,
  timeZone: string,
): Promise<ScheduleRow> {
  const taken = new Set((await storedOf(tx, memberId)).map((each) => each.name.toLowerCase()));
  let name = DEFAULT_SCHEDULE_NAME;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${DEFAULT_SCHEDULE_NAME} ${String(n)}`;
  return insertSchedule(tx, scope, {
    id: newId(),
    memberId,
    name,
    isDefault: true,
    availability: virtualDefault(timeZone).availability,
  });
}

/**
 * A new schedule (AC-964): the name given, and the hours given or else the
 * default's (the virtual default's in `timeZone` while none is stored). With
 * `isDefault` it takes the default mark: how the virtual default is saved
 * the first time (AC-963). Without it, a member with no stored default has
 * the virtual one stored beside it, so they always keep one default. The
 * same id again answers the schedule it made.
 */
export async function createSchedule(
  scope: EngineScope,
  input: {
    readonly id: string;
    readonly memberId?: string | undefined;
    readonly name: string;
    readonly timeZone: string;
    readonly availability?: BookingAvailability | undefined;
    readonly isDefault?: boolean | undefined;
  },
  hooks: readonly AfterWrite[] = [],
): Promise<ScheduleView> {
  requirePermission(scope, 'booking.manage');
  if (!isUuidV7(input.id)) throw refuse('CONFIG_INVALID', 'The schedule id must be a UUID v7.');
  const name = input.name.trim();
  return writeSchedules(scope, hooks, async (context) => {
    const { tx } = context;
    const memberId = await targetMember(tx, scope, input.memberId, 'write');
    await schedulesLock(tx, scope.workspaceId, memberId);
    const [earlier] = await tx.select().from(availabilitySchedules).where(eq(availabilitySchedules.id, input.id));
    if (earlier !== undefined) {
      if (earlier.memberId !== memberId) throw refuse('ID_TAKEN', 'A schedule with that id already exists.');
      return { result: viewOf(earlier, await pagesOfMember(tx, memberId), memberOf(scope)) };
    }
    const isDefault = input.isDefault === true;
    const current = await storedDefault(tx, memberId);
    // The virtual default's zone: the caller's own for their schedules; for a colleague's (an admin, AC-971), the
    // zone their pages already book the virtual default in, so storing it moves none of their slots.
    const zone =
      memberId === memberOf(scope) ? input.timeZone : ((await newestPageZone(tx, memberId)) ?? input.timeZone);
    // The first schedule a member adds beside the virtual default stores that default too, "Working hours" in
    // their zone (AC-963: stored the first time they change anything), so it stays in their list as the default.
    const keepsVirtual = !isDefault && current === undefined;
    // A member's first default is never refused for room (pages from before spec 0035 may have filled it); a
    // schedule added beside the virtual default needs room for both.
    if (!(isDefault && current === undefined)) await checkRoom(tx, memberId, keepsVirtual ? 2 : 1);
    const kept = keepsVirtual ? await storeVirtualDefault(tx, scope, memberId, zone) : undefined;
    await checkNameFree(tx, memberId, name);
    const availability =
      input.availability ??
      (current === undefined ? virtualDefault(zone).availability : hoursOf(current.availability, zone));
    const cleared = isDefault ? await clearDefault(tx, memberId) : [];
    const row = await insertSchedule(tx, scope, { id: input.id, memberId, name, isDefault, availability });
    return {
      result: viewOf(row, await pagesOfMember(tx, memberId), memberOf(scope)),
      change: {
        kind: 'create',
        memberId,
        schedules: [
          { id: row.id, after: row },
          ...(kept === undefined ? [] : [{ id: kept.id, after: kept }]),
          ...cleared,
        ],
      },
    };
  });
}

/**
 * Renames a schedule or replaces its hours (AC-970), refused `STALE` when it
 * changed since `updatedAt` (the editor's draft began), so a save never
 * silently overwrites another tab's. Applies to the next slot read (AC-968).
 */
export async function updateSchedule(
  scope: EngineScope,
  input: {
    readonly id: string;
    readonly name?: string | undefined;
    readonly availability?: BookingAvailability | undefined;
    readonly updatedAt: string;
  },
  hooks: readonly AfterWrite[] = [],
): Promise<ScheduleView> {
  requirePermission(scope, 'booking.manage');
  const name = input.name?.trim();
  return writeSchedules(scope, hooks, async (context) => {
    const { tx } = context;
    const row = await scheduleToChange(tx, scope, input.id);
    if (row.updatedAt.getTime() !== Date.parse(input.updatedAt)) {
      throw refuse('STALE', 'This schedule was changed in another tab or by someone else. Reload it to see.');
    }
    if (name !== undefined && name !== row.name) await checkNameFree(tx, row.memberId, name, row.id);
    const by = actorRow(scope.actor);
    const availability =
      input.availability === undefined || row.memberId === memberOf(scope)
        ? input.availability
        : withNotesKept(input.availability, hoursOf(row.availability, input.availability.timeZone));
    try {
      const [updated] = await tx
        .update(availabilitySchedules)
        .set({
          ...(name === undefined ? {} : { name }),
          ...(availability === undefined ? {} : { availability }),
          updatedAt: sql`now()`,
          updatedByType: by.type,
          updatedById: by.id,
          updatedByMemberId: by.memberId,
        })
        .where(eq(availabilitySchedules.id, row.id))
        .returning();
      if (updated === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
      return {
        result: viewOf(updated, await pagesOfMember(tx, updated.memberId), memberOf(scope)),
        change: { kind: 'update', memberId: row.memberId, schedules: [{ id: row.id, before: row, after: updated }] },
      };
    } catch (error) {
      throw nameClash(error, name ?? row.name);
    }
  });
}

/**
 * Makes a schedule its member's default (AC-962): the old mark is cleared and
 * the new one set in one transaction, so every page following the default
 * books by it from the next slot read (AC-965).
 */
export async function setDefaultSchedule(
  scope: EngineScope,
  input: { readonly id: string },
  hooks: readonly AfterWrite[] = [],
): Promise<ScheduleView> {
  requirePermission(scope, 'booking.manage');
  return writeSchedules(scope, hooks, async (context) => {
    const { tx } = context;
    const row = await scheduleToChange(tx, scope, input.id);
    if (row.isDefault) return { result: viewOf(row, await pagesOfMember(tx, row.memberId), memberOf(scope)) };
    const cleared = await clearDefault(tx, row.memberId);
    const by = actorRow(scope.actor);
    const [updated] = await tx
      .update(availabilitySchedules)
      .set({
        isDefault: true,
        updatedAt: sql`now()`,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .where(eq(availabilitySchedules.id, row.id))
      .returning();
    if (updated === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
    return {
      result: viewOf(updated, await pagesOfMember(tx, updated.memberId), memberOf(scope)),
      change: {
        kind: 'set_default',
        memberId: row.memberId,
        schedules: [{ id: row.id, before: row, after: updated }, ...cleared],
      },
    };
  });
}

/** "<name> copy", or "<name> copy 2", "… 3", the first free one, within 60 characters. */
function copyName(name: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n += 1) {
    const suffix = n === 1 ? ' copy' : ` copy ${String(n)}`;
    const wanted = `${name.slice(0, 60 - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(wanted.toLowerCase())) return wanted;
  }
}

/** A copy of a schedule, "<name> copy", with the same hours and overrides, never the default (AC-964). */
export async function duplicateSchedule(
  scope: EngineScope,
  input: { readonly id: string; readonly newId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<ScheduleView> {
  requirePermission(scope, 'booking.manage');
  if (!isUuidV7(input.newId)) throw refuse('CONFIG_INVALID', 'The schedule id must be a UUID v7.');
  return writeSchedules(scope, hooks, async (context) => {
    const { tx } = context;
    const row = await scheduleToChange(tx, scope, input.id);
    const [earlier] = await tx.select().from(availabilitySchedules).where(eq(availabilitySchedules.id, input.newId));
    if (earlier !== undefined) {
      if (earlier.memberId !== row.memberId) throw refuse('ID_TAKEN', 'A schedule with that id already exists.');
      return { result: viewOf(earlier, await pagesOfMember(tx, row.memberId), memberOf(scope)) };
    }
    await checkRoom(tx, row.memberId);
    const taken = new Set((await storedOf(tx, row.memberId)).map((each) => each.name.toLowerCase()));
    const copy = await insertSchedule(tx, scope, {
      id: input.newId,
      memberId: row.memberId,
      name: copyName(row.name, taken),
      isDefault: false,
      availability: hoursOf(row.availability, 'UTC'),
    });
    return {
      result: viewOf(copy, await pagesOfMember(tx, row.memberId), memberOf(scope)),
      change: { kind: 'duplicate', memberId: row.memberId, schedules: [{ id: copy.id, after: copy }] },
    };
  });
}

/**
 * Deletes a schedule that isn't the default (AC-962, AC-967): the pages
 * naming it follow the default from then on, in the same transaction, and
 * the answer says how many moved. Bookings already made stay (AC-968).
 */
export async function deleteSchedule(
  scope: EngineScope,
  input: { readonly id: string },
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly id: string; readonly repointed: { readonly pages: number } }> {
  requirePermission(scope, 'booking.manage');
  return writeSchedules(scope, hooks, async (context) => {
    const { tx } = context;
    const row = await scheduleToChange(tx, scope, input.id);
    if (row.isDefault) throw refuse('DEFAULT_SCHEDULE', 'Set another schedule as default first.');
    const by = actorRow(scope.actor);
    // Deleted pages too: none may name a schedule that is gone, and the foreign key would only null it anyway.
    const moved = await tx
      .update(bookingPages)
      .set({
        scheduleId: null,
        hoursMode: 'mine',
        updatedAt: sql`now()`,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .where(eq(bookingPages.scheduleId, row.id))
      .returning({ id: bookingPages.id, deletedAt: bookingPages.deletedAt });
    await tx.delete(availabilitySchedules).where(eq(availabilitySchedules.id, row.id));
    return {
      result: { id: row.id, repointed: { pages: moved.filter((page) => page.deletedAt === null).length } },
      change: { kind: 'delete', memberId: row.memberId, schedules: [{ id: row.id, before: row }] },
    };
  });
}

/**
 * Whether `scheduleId` may be a page's (AC-966): a schedule of the page's
 * owner. Refuses `SCHEDULE_NOT_ALLOWED` on `scheduleId` otherwise, the same
 * for a schedule that doesn't exist, so nothing says whose it is.
 */
export async function checkPageSchedule(tx: WorkspaceTx, ownerMemberId: string, scheduleId: string): Promise<void> {
  // Held `for key share` until the page's write commits: a delete of the schedule meanwhile waits, then points
  // the page at the default, rather than the page's foreign key refusing the write.
  const [row] = await tx
    .select({ id: availabilitySchedules.id })
    .from(availabilitySchedules)
    .where(and(eq(availabilitySchedules.id, scheduleId), eq(availabilitySchedules.memberId, ownerMemberId)))
    .for('key share');
  if (row === undefined) {
    throw refuseOn('SCHEDULE_NOT_ALLOWED', 'A page books by a schedule of its owner only.', 'scheduleId');
  }
}

/**
 * Replaces the caller's default schedule's hours (Bookings › Availability
 * before the list, and `bookings.setHours`): their stored default, or, the
 * first time, a new default "Working hours" with them (AC-963).
 */
export async function saveDefaultHours(
  scope: EngineScope,
  input: { readonly availability: BookingAvailability },
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly availability: BookingAvailability }> {
  requirePermission(scope, 'booking.manage');
  return writeSchedules(scope, hooks, async (context) => {
    const { tx } = context;
    const caller = await targetMember(tx, scope, undefined, 'write');
    await schedulesLock(tx, scope.workspaceId, caller);
    const current = await storedDefault(tx, caller);
    if (current === undefined) {
      // A member's first default is never refused for room (pages from before spec 0035 may have filled it).
      await checkNameFree(tx, caller, DEFAULT_SCHEDULE_NAME);
      const row = await insertSchedule(tx, scope, {
        id: newId(),
        memberId: caller,
        name: DEFAULT_SCHEDULE_NAME,
        isDefault: true,
        availability: input.availability,
      });
      return {
        result: { availability: input.availability },
        change: { kind: 'default_hours', memberId: caller, schedules: [{ id: row.id, after: row }] },
      };
    }
    const by = actorRow(scope.actor);
    const [updated] = await tx
      .update(availabilitySchedules)
      .set({
        availability: input.availability,
        updatedAt: sql`now()`,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .where(eq(availabilitySchedules.id, current.id))
      .returning();
    return {
      result: { availability: input.availability },
      change: {
        kind: 'default_hours',
        memberId: caller,
        schedules: [{ id: current.id, before: current, ...(updated === undefined ? {} : { after: updated }) }],
      },
    };
  });
}

/** The caller's default schedule's hours; never saved, weekdays 09:00 to 17:00 in `timeZone` (AC-963). */
export async function readDefaultHours(
  scope: EngineScope,
  input: { readonly timeZone: string },
): Promise<{ readonly availability: BookingAvailability }> {
  requirePermission(scope, 'booking.manage');
  const caller = memberOf(scope);
  if (caller === undefined) throw refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
  return inWorkspace(scope, async (tx) => {
    const current = await storedDefault(tx, caller);
    return {
      availability:
        current === undefined
          ? virtualDefault(input.timeZone).availability
          : hoursOf(current.availability, input.timeZone),
    };
  });
}
