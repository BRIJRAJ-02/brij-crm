// A lead whose owner waited for its meeting (spec 0037, AC-1372, AC-1427),
// from the booking's side.
//
// When a form's owner is a rotation and the visitor booked a team page that
// uses that same rotation, the host that rotation's seat just picked becomes
// the lead's owner. The booking claims the form's decision row inside its own
// transaction (`claimDecision`, one conditional update), and only on winning
// writes the owner on the record the submission filed into, and only when
// that record has none. The booking's own ledger row is the one count for
// both, so no `form` row is written.
//
// The owner attribute is written here, in the booking, and never under
// `packages/core/src/routing/` (AC-1423): routing only ever claims.
import { and, eq, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { bySlug, ownerValue } from '../engine/filing.ts';
import { updateRecord } from '../engine/records.ts';
import { currentItems, loadAttributes } from '../engine/values.ts';
import type { WriteContext } from '../engine/write.ts';
import { claimDecision } from '../routing/lead-owner.ts';

const { formSubmissionRecords, formSubmissions, forms, routingDecisions } = schema;

/** The wait a booking found: the decision to claim, the rotation the owner follows, and the lead's record. */
interface Waiting {
  readonly decisionId: string;
  readonly rotationId: string;
  readonly recordId: string;
  readonly objectId: string;
}

/** The submission's open claim, its form's owner rotation and the record it filed into; undefined when none waits. */
async function waitingLead(tx: WorkspaceTx, submissionId: string): Promise<Waiting | undefined> {
  const found = await tx
    .select({
      decisionId: routingDecisions.id,
      assignedAt: routingDecisions.assignedAt,
      rotationId: forms.ownerRotationId,
      recordId: formSubmissionRecords.recordId,
      objectId: formSubmissionRecords.objectId,
    })
    .from(routingDecisions)
    .innerJoin(
      formSubmissions,
      and(
        eq(formSubmissions.workspaceId, routingDecisions.workspaceId),
        eq(formSubmissions.id, routingDecisions.submissionId),
      ),
    )
    .innerJoin(forms, and(eq(forms.workspaceId, formSubmissions.workspaceId), eq(forms.id, formSubmissions.formId)))
    .innerJoin(
      formSubmissionRecords,
      and(
        eq(formSubmissionRecords.workspaceId, formSubmissions.workspaceId),
        eq(formSubmissionRecords.submissionId, formSubmissions.id),
        eq(formSubmissionRecords.role, 'main'),
      ),
    )
    .where(and(eq(routingDecisions.surfaceKind, 'form'), eq(routingDecisions.submissionId, submissionId)));
  const row = found[0];
  if (row === undefined || row.assignedAt !== null || row.rotationId === null) return undefined;
  return { decisionId: row.decisionId, rotationId: row.rotationId, recordId: row.recordId, objectId: row.objectId };
}

/**
 * Gives the lead its owner from the booking it waited for (AC-1372). `picks`
 * is the booking's seats, by rotation; the owner is the seat of the form's own
 * rotation. Answers the member who became the owner, or undefined when
 * nothing waited, this booking's rotations aren't the form's, or another path
 * claimed first (a booking that loses still books its host).
 */
export async function claimLeadOwnerAtBooking(
  context: WriteContext,
  input: {
    readonly submissionId: string;
    readonly picks: readonly { readonly rotationId: string; readonly memberId: string }[];
  },
): Promise<string | undefined> {
  const { tx } = context;
  const waiting = await waitingLead(tx, input.submissionId);
  if (waiting === undefined) return undefined;
  const seat = input.picks.find((pick) => pick.rotationId === waiting.rotationId);
  if (seat === undefined) return undefined;
  if (!(await claimDecision(tx, waiting.decisionId, seat.memberId))) return undefined;
  const attributes = await loadAttributes(tx, waiting.objectId);
  const owner = bySlug(attributes, 'owner');
  // No owner field, or one that doesn't name members: the claim stands, so nothing else assigns, but no value lands.
  if (owner !== undefined && owner.type === 'actor_reference') {
    const held = await currentItems(tx, [waiting.recordId], [owner.id]);
    const taken = held.some((item) => item.ownerId === waiting.recordId && !item.isCleared && item.actorId !== null);
    // A record that has an owner keeps them (AC-567); only an unowned lead takes the booking's host.
    if (!taken) {
      const values = ownerValue(attributes, seat.memberId);
      const value = values[owner.id];
      if (value !== undefined)
        await updateRecord(context, { recordId: waiting.recordId, values: { [owner.id]: { value } } });
    }
  }
  await tx
    .update(formSubmissions)
    .set({
      assignment: { memberId: seat.memberId, rotationId: waiting.rotationId, reason: 'booking' },
      updatedAt: sql`now()`,
    })
    .where(eq(formSubmissions.id, input.submissionId));
  return seat.memberId;
}
