// Time a member closes on their own calendar (spec 0027, AC-703 to AC-707,
// AC-712): drawn on Bookings › Calendar as a date and local minutes in the
// member's zone, stored once as an absolute span or every week as local
// minutes, read back as occurrences for the calendar and as busy time (and, for
// a private page, open holds) for the slot engine. A member's own, or (spec
// 0037, AC-1272) made or removed for a colleague they Manage, with their own
// `booking.manage` (AC-1275); never shown to anyone but the member. Every block
// made or removed writes one audit row naming whose time it is (AC-1263).
import { and, asc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { PERMISSIONS, type TimeBlockOccurrence, type TimeBlockView } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { actingFor } from '../access/scheduling.ts';
import { isRefusal, refuse, refuseOn } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { writeAudit } from '../members/audit.ts';
import { toInstant, type Span } from './engine.ts';
import { hostLockKey, lockKey } from './locks.ts';

const { bookingPageMembers, bookingPages, bookingTimeBlocks } = schema;

const NOT_FOUND_MESSAGE = 'That block could not be found.';

/** What a block is drawn as: a date and local minutes in a zone. */
export interface TimeBlockDraft {
  /** Minted by the client once per draw, so a retry gives back the block the first try made. */
  readonly id: string;
  readonly kind: 'block' | 'hold';
  readonly repeat: 'once' | 'weekly';
  readonly date: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly timeZone: string;
  readonly label?: string | undefined;
  readonly pageId?: string | undefined;
  /** Whose time it closes, when not the caller's own: a colleague they Manage (spec 0037, AC-1272). */
  readonly forMemberId?: string | undefined;
}

/** The member the scope acts as; a key or the system has no calendar. */
function blockOwner(scope: EngineScope): string {
  requirePermission(scope, 'booking.manage');
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
  return principal.memberId;
}

/** Local minutes on `day` (a start of day in its zone) to an instant, by the clock (a DST day too); 1440 is the next midnight. */
const at = toInstant;

/** A date's start of day in `zone`, or undefined for a date that isn't one. */
function dayIn(date: string, zone: string): DateTime | undefined {
  const day = DateTime.fromISO(date, { zone }).startOf('day');
  return day.isValid ? day : undefined;
}

type BlockRow = Omit<typeof bookingTimeBlocks.$inferSelect, 'during'>;

const iso = (value: Date) => value.toISOString();

function viewOf(row: BlockRow): TimeBlockView {
  return {
    id: row.id,
    kind: row.kind === 'hold' ? 'hold' : 'block',
    repeat: row.repeat === 'weekly' ? 'weekly' : 'once',
    ...(row.label === null ? {} : { label: row.label }),
    ...(row.pageId === null ? {} : { pageId: row.pageId }),
    ...(row.startsAt === null ? {} : { startsAt: iso(row.startsAt) }),
    ...(row.endsAt === null ? {} : { endsAt: iso(row.endsAt) }),
    ...(row.weekday === null ? {} : { weekday: row.weekday }),
    ...(row.startMinute === null ? {} : { startMinute: row.startMinute }),
    ...(row.endMinute === null ? {} : { endMinute: row.endMinute }),
    ...(row.timeZone === null ? {} : { timeZone: row.timeZone }),
    ...(row.fromDate === null ? {} : { fromDate: row.fromDate }),
  };
}

/**
 * Closes a span on the caller's own calendar (AC-703, AC-704). A hold carved
 * for one page names a live page the caller books; a weekly block repeats on
 * the drawn date's weekday, in the drawn zone, from that date on.
 */
export async function createTimeBlock(scope: EngineScope, draft: TimeBlockDraft): Promise<TimeBlockView> {
  const day = dayIn(draft.date, draft.timeZone);
  if (day === undefined) throw refuseOn('CONFIG_INVALID', 'Pick a date.', 'date');
  const start = at(day, draft.startMinute);
  const end = at(day, draft.endMinute);
  if (end <= start) throw refuseOn('CONFIG_INVALID', 'The end time has to be after the start time.', 'endMinute');
  if (draft.kind === 'hold' && draft.repeat !== 'once') {
    throw refuseOn('CONFIG_INVALID', 'A hold is one span on one date.', 'repeat');
  }
  if (draft.kind !== 'hold' && draft.pageId !== undefined) {
    throw refuseOn('CONFIG_INVALID', 'Only a hold names a page.', 'pageId');
  }
  const label = draft.label?.trim() === '' ? undefined : draft.label?.trim();
  const by = actorRow(scope.actor);
  const actor = blockOwner(scope);
  const member = draft.forMemberId ?? actor;
  return inWorkspace(scope, async (tx) => {
    if (member !== actor) await actingFor(tx, scope, member, 'manage');
    // A visitor's booking rechecks under this lock: the block lands wholly before or after it, never between.
    await lockKey(tx, hostLockKey(scope.workspaceId, member));
    const again = await existing(tx, member, draft.id);
    if (again !== undefined) return again;
    if (draft.pageId !== undefined) await requireOwnPage(tx, member, draft.pageId);
    const shape =
      draft.repeat === 'once'
        ? {
            during: sql`tstzrange(${start.toUTC().toISO()}::timestamptz, ${end.toUTC().toISO()}::timestamptz, '[)')`,
          }
        : {
            weekday: day.weekday % 7,
            startMinute: draft.startMinute,
            endMinute: draft.endMinute,
            timeZone: draft.timeZone,
            fromDate: draft.date,
          };
    const [row] = await tx
      .insert(bookingTimeBlocks)
      .values({
        workspaceId: scope.workspaceId,
        id: draft.id,
        memberId: member,
        kind: draft.kind,
        repeat: draft.repeat,
        ...shape,
        pageId: draft.pageId ?? null,
        label: label ?? null,
        createdByType: by.type,
        createdById: by.id,
        createdByMemberId: by.memberId,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .returning(blockColumns());
    if (row === undefined) throw new Error('booking_time_blocks insert returned no row');
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'block.created',
      targetType: 'member',
      targetId: member,
      after: auditFieldsOf(row),
    });
    return viewOf(row);
  });
}

/** Every column but the range itself (its ends are columns too), for a `returning` or `select`. */
function blockColumns() {
  const { during: _during, ...columns } = getTableColumns(bookingTimeBlocks);
  return columns;
}

/** The member's block with this id, when a retry already made it. */
async function existing(tx: WorkspaceTx, member: string, id: string): Promise<TimeBlockView | undefined> {
  const [row] = await tx
    .select(blockColumns())
    .from(bookingTimeBlocks)
    .where(
      and(
        eq(bookingTimeBlocks.id, id),
        eq(bookingTimeBlocks.memberId, member),
        sql`${bookingTimeBlocks.kind} <> 'away'`,
      ),
    );
  return row === undefined ? undefined : viewOf(row);
}

/** A hold names a live private page the member books, or the hold is refused as if the page weren't there. */
async function requireOwnPage(tx: WorkspaceTx, member: string, pageId: string): Promise<void> {
  const [page] = await tx
    .select({ id: bookingPages.id })
    .from(bookingPages)
    .innerJoin(
      bookingPageMembers,
      and(eq(bookingPageMembers.workspaceId, bookingPages.workspaceId), eq(bookingPageMembers.pageId, bookingPages.id)),
    )
    .where(
      and(
        eq(bookingPages.id, pageId),
        eq(bookingPageMembers.memberId, member),
        eq(bookingPages.isPrivate, true),
        sql`${bookingPages.deletedAt} is null`,
      ),
    )
    .limit(1);
  if (page === undefined) {
    throw refuseOn('NOT_FOUND', 'That booking page doesn’t exist, isn’t private, or isn’t yours.', 'pageId');
  }
}

/**
 * Reopens the time a block closed (AC-705); a weekly block stops every week. The caller's own, or one of a colleague
 * they Manage (spec 0037): a colleague's block outside their See reach answers as one that doesn't exist.
 */
export async function removeTimeBlock(
  scope: EngineScope,
  input: { readonly id: string },
): Promise<{ readonly id: string }> {
  const actor = blockOwner(scope);
  return inWorkspace(scope, async (tx) => {
    const [found] = await tx
      .select({ memberId: bookingTimeBlocks.memberId })
      .from(bookingTimeBlocks)
      .where(and(eq(bookingTimeBlocks.id, input.id), sql`${bookingTimeBlocks.kind} <> 'away'`));
    // Time off is removed through its own service (audited as time off), never as a block.
    if (found === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
    if (found.memberId !== actor) {
      try {
        await actingFor(tx, scope, found.memberId, 'manage');
      } catch (error) {
        // A block of someone the caller can't see is no block at all to them.
        if (isRefusal(error) && error.refusal.code === 'NOT_FOUND') throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
        throw error;
      }
    }
    // The member's lock, as a new block takes, so a booking rechecking under it sees the block or its absence.
    await lockKey(tx, hostLockKey(scope.workspaceId, found.memberId));
    const removed = await tx
      .delete(bookingTimeBlocks)
      .where(
        and(
          eq(bookingTimeBlocks.id, input.id),
          eq(bookingTimeBlocks.memberId, found.memberId),
          sql`${bookingTimeBlocks.kind} <> 'away'`,
        ),
      )
      .returning(blockColumns());
    const [row] = removed;
    if (row === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'block.removed',
      targetType: 'member',
      targetId: found.memberId,
      before: auditFieldsOf(row),
    });
    return { id: input.id };
  });
}

/** What an audit row keeps of a block (AC-1263): whose time and when, never its label. */
function auditFieldsOf(row: BlockRow): Readonly<Record<string, unknown>> {
  return {
    memberId: row.memberId,
    blockId: row.id,
    kind: row.kind,
    repeat: row.repeat,
    ...(row.startsAt === null ? {} : { startsAt: iso(row.startsAt) }),
    ...(row.endsAt === null ? {} : { endsAt: iso(row.endsAt) }),
    ...(row.weekday === null ? {} : { weekday: row.weekday }),
    ...(row.startMinute === null ? {} : { startMinute: row.startMinute }),
    ...(row.endMinute === null ? {} : { endMinute: row.endMinute }),
    ...(row.timeZone === null ? {} : { timeZone: row.timeZone }),
  };
}

/** A member's blocks that can touch `[from, to)`: once ones overlapping it, and every weekly one begun by its end. */
async function blocksTouching(tx: WorkspaceTx, member: string, from: Date, to: Date): Promise<readonly BlockRow[]> {
  return blocksOfMembersTouching(tx, [member], from, to);
}

/** Every block of these members touching [from, to), in one read (a team's slots read every host's at once). */
async function blocksOfMembersTouching(
  tx: WorkspaceTx,
  memberIds: readonly string[],
  from: Date,
  to: Date,
): Promise<readonly BlockRow[]> {
  if (memberIds.length === 0) return [];
  return tx
    .select(blockColumns())
    .from(bookingTimeBlocks)
    .where(
      and(
        inArray(bookingTimeBlocks.memberId, [...memberIds]),
        // Plain comparisons on the stored ends, not `during &&`: under row level security only leakproof operators
        // reach the index, and range overlap isn't one.
        sql`((${bookingTimeBlocks.repeat} = 'once' and ${bookingTimeBlocks.endsAt} > ${from.toISOString()}::timestamptz
            and ${bookingTimeBlocks.startsAt} < ${to.toISOString()}::timestamptz)
          or (${bookingTimeBlocks.repeat} = 'weekly' and ${bookingTimeBlocks.fromDate} <= ${to.toISOString().slice(0, 10)}::date + 1))`,
      ),
    )
    .orderBy(asc(bookingTimeBlocks.id));
}

/** Each turn of a weekly block overlapping `[from, to)`: its weekday's local minutes, in its zone, from its first date. */
export function weeklyTurns(
  block: {
    readonly weekday: number;
    readonly startMinute: number;
    readonly endMinute: number;
    readonly timeZone: string;
    readonly fromDate: string;
  },
  from: Date,
  to: Date,
): readonly { readonly date: string; readonly span: Span }[] {
  const first = dayIn(block.fromDate, block.timeZone);
  if (first === undefined) return [];
  const turns: { date: string; span: Span }[] = [];
  // A day either side, so a zone far from UTC still finds the turns at the range's edges.
  let day = DateTime.fromJSDate(from, { zone: block.timeZone }).startOf('day').minus({ days: 1 });
  const last = DateTime.fromJSDate(to, { zone: block.timeZone }).startOf('day').plus({ days: 1 });
  while (day <= last) {
    if (day.weekday % 7 === block.weekday && day >= first) {
      const start = at(day, block.startMinute).toJSDate();
      const end = at(day, block.endMinute).toJSDate();
      if (start < to && end > from) turns.push({ date: day.toISODate() ?? '', span: { start, end } });
    }
    day = day.plus({ days: 1 }).startOf('day');
  }
  return turns;
}

/** One row's occurrences in `[from, to)`. */
function occurrencesOf(row: BlockRow, from: Date, to: Date): readonly TimeBlockOccurrence[] {
  const kind = row.kind === 'hold' ? 'hold' : row.kind === 'away' ? 'away' : 'block';
  const label = row.label === null ? {} : { label: row.label };
  if (row.repeat !== 'weekly') {
    if (row.startsAt === null || row.endsAt === null) return [];
    // Time off (spec 0037) carries its days, so the week draws it as all day in the zone it was chosen in.
    const days =
      kind === 'away' && row.timeZone !== null
        ? {
            fromDate: DateTime.fromJSDate(row.startsAt, { zone: row.timeZone }).toISODate() ?? '',
            toDate: DateTime.fromJSDate(row.endsAt, { zone: row.timeZone }).minus({ days: 1 }).toISODate() ?? '',
          }
        : {};
    return [
      {
        key: row.id,
        blockId: row.id,
        kind,
        repeat: 'once',
        ...label,
        startsAt: iso(row.startsAt),
        endsAt: iso(row.endsAt),
        ...days,
      },
    ];
  }
  if (row.weekday === null || row.startMinute === null || row.endMinute === null) return [];
  if (row.timeZone === null || row.fromDate === null) return [];
  return weeklyTurns(
    {
      weekday: row.weekday,
      startMinute: row.startMinute,
      endMinute: row.endMinute,
      timeZone: row.timeZone,
      fromDate: row.fromDate,
    },
    from,
    to,
  ).map(({ date, span }) => ({
    key: `${row.id}:${date}`,
    blockId: row.id,
    kind,
    repeat: 'weekly' as const,
    ...label,
    startsAt: span.start.toISOString(),
    endsAt: span.end.toISOString(),
  }));
}

/** The member's blocks in `[from, to)`, one entry per time each closes, by start (the calendar read, AC-705). */
export async function blockOccurrences(
  tx: WorkspaceTx,
  member: string,
  from: Date,
  to: Date,
): Promise<readonly TimeBlockOccurrence[]> {
  const rows = await blocksTouching(tx, member, from, to);
  return rows
    .flatMap((row) => occurrencesOf(row, from, to))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.key.localeCompare(b.key));
}

/**
 * What the member's blocks mean to one page's slots (AC-706, AC-707): every
 * block, and every hold the page can't use, is busy; a private page's usable
 * holds (shared, or carved for it) open as extra windows instead.
 */
export async function blockedTime(
  tx: WorkspaceTx,
  member: string,
  from: Date,
  to: Date,
  page: { readonly id: string; readonly isPrivate: boolean },
): Promise<{ readonly busy: readonly Span[]; readonly openHolds: readonly Span[] }> {
  return (await blockedTimes(tx, [member], from, to, page)).get(member) ?? { busy: [], openHolds: [] };
}

/**
 * `blockedTime` for many members in one read: a team page's slots (every host of "Everyone on the roster") read their
 * blocks together rather than one query per member.
 */
export async function blockedTimes(
  tx: WorkspaceTx,
  memberIds: readonly string[],
  from: Date,
  to: Date,
  page: { readonly id: string; readonly isPrivate: boolean },
): Promise<ReadonlyMap<string, { readonly busy: readonly Span[]; readonly openHolds: readonly Span[] }>> {
  const found = new Map<string, { busy: Span[]; openHolds: Span[] }>(
    memberIds.map((memberId) => [memberId, { busy: [], openHolds: [] }]),
  );
  for (const row of await blocksOfMembersTouching(tx, memberIds, from, to)) {
    const theirs = found.get(row.memberId);
    if (theirs === undefined) continue;
    const usable = row.kind === 'hold' && page.isPrivate && (row.pageId === null || row.pageId === page.id);
    for (const occurrence of occurrencesOf(row, from, to)) {
      const span = { start: new Date(occurrence.startsAt), end: new Date(occurrence.endsAt) };
      (usable ? theirs.openHolds : theirs.busy).push(span);
    }
  }
  return found;
}
