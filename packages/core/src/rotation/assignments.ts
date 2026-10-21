// Why a booking went to its host (spec 0029, AC-742, AC-753): the booking's
// ledger rows, for its host (who sees why it came to them) and `booking.admin`.
// Anyone else finds no such booking (hidden means absent).
import { and, desc, eq } from 'drizzle-orm';
import { AssignmentReason, type BookingAssignment } from '@crm/contracts';
import { schema } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { refuse } from '../engine/refusals.ts';

const { bookings, members, rotationAssignments, rotations } = schema;

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

/** A booking's ledger rows, newest first (AC-742): its host and `booking.admin` only, else NOT_FOUND. */
export async function bookingAssignments(
  scope: EngineScope,
  input: { readonly bookingId: string },
): Promise<readonly BookingAssignment[]> {
  requirePermission(scope, 'booking.manage');
  const { principal } = scope.access;
  const me = principal.kind === 'member' ? principal.memberId : undefined;
  return inWorkspace(scope, async (tx) => {
    const [booking] = await tx
      .select({ hostMemberId: bookings.hostMemberId })
      .from(bookings)
      .where(eq(bookings.id, input.bookingId));
    if (booking === undefined || (!can(scope.access, 'booking.admin') && booking.hostMemberId !== me)) {
      throw refuse('NOT_FOUND', 'That booking doesn’t exist, or isn’t yours.');
    }
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
          // Only `booking.admin` sees other members' counts and reasons (AC-752): a host reads their own rows.
          can(scope.access, 'booking.admin') || me === undefined ? undefined : eq(rotationAssignments.memberId, me),
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
