// Why a booking went to its host (spec 0029, AC-742, AC-753; spec 0037,
// AC-1262): the booking's ledger rows, for anyone whose scheduling reach sees
// its host (the host themself, a delegate, owners and admins), each row only
// about a member the reader may see. Anyone else finds no such booking
// (hidden means absent).
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AssignmentReason, type BookingAssignment } from '@crm/contracts';
import { schema } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { canActFor, managesPageOf, schedulingReach } from '../access/scheduling.ts';
import { inWorkspace } from '../access/run.ts';
import { refuse } from '../engine/refusals.ts';
import { pageManagerColumn } from '../booking/seen.ts';

const { bookingPages, bookings, members, rotationAssignments, rotations } = schema;

const REASONS: ReadonlySet<string> = new Set(AssignmentReason.options);

/** The compared entry of the chosen member in a ledger row's detail, read defensively. */
function chosenOf(detail: unknown, memberId: string): { count?: number; weight?: number; windowDays?: number } {
  if (typeof detail !== 'object' || detail === null) return {};
  const { compared, windowDays } = detail as { readonly compared?: unknown; readonly windowDays?: unknown };
  const days = typeof windowDays === 'number' ? { windowDays } : {};
  if (!Array.isArray(compared)) return days;
  const found: unknown = compared.find(
    (each: unknown) =>
      typeof each === 'object' && each !== null && (each as { memberId?: unknown }).memberId === memberId,
  );
  if (typeof found !== 'object' || found === null) return days;
  const { count, weight } = found as { readonly count?: unknown; readonly weight?: unknown };
  return {
    ...days,
    ...(typeof count === 'number' ? { count } : {}),
    ...(typeof weight === 'number' ? { weight } : {}),
  };
}

/**
 * A booking's ledger rows, newest first (AC-742): for a reader whose See reach covers its host (themself, a
 * delegate, owners and admins), else NOT_FOUND; rows about members outside that reach are left out (AC-752).
 */
export async function bookingAssignments(
  scope: EngineScope,
  input: { readonly bookingId: string },
): Promise<readonly BookingAssignment[]> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const [booking] = await tx
      // A workspace link's maker manages nothing by it (`pageManagerColumn`).
      .select({ hostMemberId: bookings.hostMemberId, ownerMemberId: pageManagerColumn })
      .from(bookings)
      .innerJoin(
        bookingPages,
        and(eq(bookingPages.workspaceId, bookings.workspaceId), eq(bookingPages.id, bookings.pageId)),
      )
      .where(eq(bookings.id, input.bookingId));
    const reach = await schedulingReach(tx, scope);
    // The page's managers act on its bookings (decision 12); anyone else needs See over its host.
    const manages = booking !== undefined && managesPageOf(booking, scope.access);
    if (booking === undefined || (!manages && !canActFor(reach, booking.hostMemberId, 'view'))) {
      throw refuse('NOT_FOUND', 'That booking doesn’t exist, or isn’t yours.');
    }
    // A page's managers and a reach over everyone, every row; otherwise the reader and the members they reach.
    const seen =
      !manages && reach.all === undefined
        ? [...(reach.self === undefined ? [] : [reach.self]), ...reach.members.keys()].filter((id) =>
            canActFor(reach, id, 'view'),
          )
        : undefined;
    const rows = await tx
      .select({
        id: rotationAssignments.id,
        rotationId: rotationAssignments.rotationId,
        rotationName: rotations.name,
        memberId: rotationAssignments.memberId,
        memberName: members.name,
        reason: rotationAssignments.reason,
        detail: rotationAssignments.detail,
        assignedAt: rotationAssignments.assignedAt,
        voidedAt: rotationAssignments.voidedAt,
      })
      .from(rotationAssignments)
      .innerJoin(
        rotations,
        and(
          eq(rotations.workspaceId, rotationAssignments.workspaceId),
          eq(rotations.id, rotationAssignments.rotationId),
        ),
      )
      .innerJoin(
        members,
        and(eq(members.workspaceId, rotationAssignments.workspaceId), eq(members.id, rotationAssignments.memberId)),
      )
      .where(
        and(
          eq(rotationAssignments.bookingId, input.bookingId),
          // Only members the reader may see (AC-752): a host reads their own rows, a delegate those of whom they reach.
          seen === undefined ? undefined : inArray(rotationAssignments.memberId, seen),
        ),
      )
      .orderBy(desc(rotationAssignments.assignedAt), desc(rotationAssignments.id))
      .limit(50);
    return rows.flatMap((row): BookingAssignment[] =>
      REASONS.has(row.reason)
        ? [
            {
              id: row.id,
              rotationId: row.rotationId,
              rotationName: row.rotationName,
              memberId: row.memberId,
              memberName: row.memberName,
              reason: row.reason as BookingAssignment['reason'],
              ...chosenOf(row.detail, row.memberId),
              assignedAt: row.assignedAt.toISOString(),
              ...(row.voidedAt === null ? {} : { voidedAt: row.voidedAt.toISOString() }),
            },
          ]
        : [],
    );
  });
}
