// A lead whose owner waited for its meeting (spec 0037, AC-1372, AC-1391,
// AC-1427), from the booking's side.
//
// When a form's owner is a rotation and the visitor booked a team page that
// uses that same rotation, the host that rotation's seat just picked becomes
// the lead's owner. The booking claims the form's decision row inside its own
// transaction (`claimDecision`, one conditional update), and only on winning
// writes the owner on the record the submission filed into, and only when
// that record has none. The booking's own ledger row is the one count for
// both, so no `form` row is written.
//
// The owner then hears of the lead, which is the notice AC-1391 holds back
// from submit — but not from inside the booking: a notice reads each member
// through the access door, and only the system may read another member's
// scope (`memberScopeIn`). So the claim answers who it gave the lead to, and
// `tellLeadOwner` sends the notice after the booking has committed, in a
// write of the system's own (`telling` in `public.ts`). A notice that fails
// is left out; it never decides whether the booking stands.
//
// The claim and the owner write run together in a savepoint
// (`context.perRecord`), which matters twice over:
//
//   - a refusal leaves the booking, its hosts and its ledger rows standing. A
//     guest must never fail to book because a lead's owner couldn't be
//     written;
//   - the claim rolls back with it. The booking page's own scope writes with
//     the access it already has (write on People and the page's answers
//     object, nothing else, `bookingAccess`), so a form that files into some
//     other object refuses here — and because the claim goes with it, the
//     unbooked job still assigns that lead five minutes after the hand off
//     expires, through `pickLeadOwner`, as if no booking had been made.
//
// The owner attribute is written here, in the booking, and never under
// `packages/core/src/routing/` (AC-1423): routing only ever claims.
import { and, eq, sql } from 'drizzle-orm';
import { schema, type Database, type WorkspaceTx } from '@crm/db';
import { systemScope, type RuleSource } from '../access/door.ts';
import { outboxHook } from '../engine/outbox.ts';
import { runWrite } from '../engine/write.ts';
import { tellTeam } from '../forms/notify.ts';
import { bySlug, ownerValue } from '../engine/filing.ts';
import { updateRecord } from '../engine/records.ts';
import { currentItems, loadAttributes } from '../engine/values.ts';
import type { WriteContext } from '../engine/write.ts';
import { claimDecision } from '../routing/lead-owner.ts';

const { formSubmissionRecords, formSubmissions, forms, routingDecisions } = schema;

/** The wait a booking found: the decision to claim, the rotation the owner follows, and the lead's record. */
interface Waiting {
  readonly submissionId: string;
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
  return {
    submissionId,
    decisionId: row.decisionId,
    rotationId: row.rotationId,
    recordId: row.recordId,
    objectId: row.objectId,
  };
}

/**
 * Gives the lead its owner from the booking it waited for (AC-1372). `picks`
 * is the booking's seats, by rotation; the owner is the seat of the form's own
 * rotation. Answers the member who became the owner, or undefined when
 * nothing waited, this booking's rotations aren't the form's, another path
 * claimed first (a booking that loses still books its host), or the write
 * itself was refused inside its savepoint.
 */
export async function claimLeadOwnerAtBooking(
  context: WriteContext,
  input: {
    readonly submissionId: string;
    readonly picks: readonly { readonly rotationId: string; readonly memberId: string }[];
  },
): Promise<string | undefined> {
  const waiting = await waitingLead(context.tx, input.submissionId);
  if (waiting === undefined) return undefined;
  const seat = input.picks.find((pick) => pick.rotationId === waiting.rotationId);
  if (seat === undefined) return undefined;
  // Its own savepoint: a refused owner write leaves the booking, its hosts and its ledger rows standing, and the
  // claim rolls back with it, so the unbooked job still assigns that lead.
  const given = await context.perRecord((step) => give(step, waiting, seat.memberId));
  return given.ok && given.value ? seat.memberId : undefined;
}

/**
 * Tells the member a booking just made a lead's owner (AC-1391), after that
 * booking committed, as the system: a notice reads each member through the
 * door, which only system work may do. Everyone already told at submit is
 * skipped, and anything that goes wrong only leaves the notice out.
 */
export async function tellLeadOwner(
  db: Database,
  workspaceId: string,
  submissionId: string,
  rules: RuleSource,
): Promise<void> {
  await runWrite(systemScope(db, workspaceId), (context) => tellTeam(context, rules, submissionId), [outboxHook()]);
}

/** The claim and the owner write, inside the savepoint. True: this booking gave the lead its owner. */
async function give(context: WriteContext, waiting: Waiting, memberId: string): Promise<boolean> {
  const { tx } = context;
  if (!(await claimDecision(tx, waiting.decisionId, waiting.submissionId, memberId))) return false;
  const attributes = await loadAttributes(tx, waiting.objectId);
  const owner = bySlug(attributes, 'owner');
  const value = owner === undefined ? undefined : ownerValue(attributes, memberId)[owner.id];
  // No owner field, or one that doesn't name members: the claim stands, so nothing else assigns, but no value lands.
  if (owner !== undefined && value !== undefined) {
    const held = await currentItems(tx, [waiting.recordId], [owner.id]);
    const taken = held.some((item) => item.ownerId === waiting.recordId && !item.isCleared && item.actorId !== null);
    // A record that has an owner keeps them (AC-567); only an unowned lead takes the booking's host.
    if (!taken) await updateRecord(context, { recordId: waiting.recordId, values: { [owner.id]: { value } } });
  }
  await tx
    .update(formSubmissions)
    .set({
      assignment: { memberId, rotationId: waiting.rotationId, reason: 'booking' },
      updatedAt: sql`now()`,
    })
    .where(eq(formSubmissions.id, waiting.submissionId));
  return true;
}
