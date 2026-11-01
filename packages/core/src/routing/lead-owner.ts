// A form lead's owner that follows its meeting (spec 0037, AC-1372, AC-1391,
// AC-1423, AC-1427).
//
// When a form's owner is a rotation and the submission's route books a team
// page that uses that **same** rotation, the owner waits: the host the page
// picks from that rotation becomes the lead's owner, and the booking's ledger
// row is the one count for both. If no booking is made within the hand off's
// life (24 hours), `routing.assign_unbooked` picks the owner through
// `pickLeadOwner` five minutes later, as the submission's own form actor, so
// caps, time off, a returning owner and "keep an existing owner" all apply
// unchanged (AC-1423).
//
// **Exactly one path assigns.** Both the booking and the job first claim the
// form's decision row with one conditional update:
//
//   update routing_decisions set assigned_member_id = …, assigned_at = now()
//   where id = … and assigned_at is null
//
// Only the winner writes the owner; a booking that loses still books its
// host. The claim is the whole race, so the job needs no cancelling: it runs,
// finds the claim taken and does nothing.
//
// Routing never writes the owner attribute itself (AC-1423): the owner only
// ever comes from `pickLeadOwner`, or from the booking's own host through the
// claim here.
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';
import { schema, type WorkspaceTx } from '@crm/db';
import { enterAsForm, type RuleSource } from '../access/door.ts';
import { formAccess } from '../access/policy.ts';
import { refuse } from '../engine/refusals.ts';
import { updateRecord } from '../engine/records.ts';
import { currentItems, loadAttributes } from '../engine/values.ts';
import type { WriteContext } from '../engine/write.ts';
import { createRegistry, defineKind, MAX_ATTEMPTS, type JobRegistry, type KindDefinition } from '../jobs/registry.ts';
import { startJob } from '../jobs/service.ts';
import { lockRotation } from '../rotation/ledger.ts';
import { pickLeadOwner, recordLeadOwner } from '../rotation/owner.ts';
import { actingAs, ownerAttribute } from '../forms/process.ts';
import { tellTeam } from '../forms/notify.ts';
import { loadForm, loadVersions } from '../forms/shared.ts';

const { bookingPageRotations, bookingPages, formSubmissionRecords, formSubmissions, routingDecisions, rotations } =
  schema;

/** What a submission's `assignment` says while the owner waits for a booking (AC-1423). */
export const WAITING_FOR_BOOKING = 'waiting_for_booking';

/** How long a form's hand off lives (spec 0037's Numbers): past it, booking through it is refused. */
export const HANDOFF_LIFE_MS = 24 * 60 * 60 * 1_000;

/** How long after the hand off expires the unbooked job picks the owner (spec 0037's Numbers). */
export const UNBOOKED_DELAY_MS = 5 * 60 * 1_000;

/** The kind's name. */
export const ROUTING_ASSIGN_UNBOOKED = 'routing.assign_unbooked';

/** What a visitor reads when they open a booking page through a hand off that has expired (AC-1427). */
export const HANDOFF_EXPIRED_MESSAGE = 'That link has expired. Fill the form in again to book.';

/** Whether a submission's hand off has expired (AC-1427): more than its life since it came in. */
export async function handoffExpired(tx: WorkspaceTx, submissionId: string, now: Date): Promise<boolean> {
  const [row] = await tx
    .select({ receivedAt: formSubmissions.receivedAt })
    .from(formSubmissions)
    .where(eq(formSubmissions.id, submissionId));
  if (row === undefined) return false;
  return now.getTime() - row.receivedAt.getTime() > HANDOFF_LIFE_MS;
}

/** Refuses a booking made through an expired hand off (AC-1427). */
export async function refuseExpiredHandoff(tx: WorkspaceTx, submissionId: string, now: Date): Promise<void> {
  if (await handoffExpired(tx, submissionId, now)) throw refuse('HANDOFF_EXPIRED', HANDOFF_EXPIRED_MESSAGE);
}

/** The rotation a waiting owner follows, and the decision row the winner claims. */
export interface OwnerWait {
  readonly decisionId: string;
  readonly rotationId: string;
  readonly pageId: string;
}

/**
 * Whether this submission's owner waits for its booking (AC-1372), and the
 * decision row to claim. It waits only when the form's owner is a rotation,
 * the submission has a decision naming a page, and that live round robin page
 * uses that very rotation. In every other case (a fixed owner, a route that
 * isn't a booking, a rotation the page doesn't use, no free time under
 * AC-1358) there is no wait and the owner is picked at submit, as today.
 */
export async function ownerWait(
  tx: WorkspaceTx,
  input: { readonly ownerRotationId: string | null; readonly submissionId: string },
): Promise<OwnerWait | undefined> {
  const rotationId = input.ownerRotationId;
  if (rotationId === null) return undefined;
  const [decision] = await tx
    .select({ id: routingDecisions.id, pageId: routingDecisions.routedPageId })
    .from(routingDecisions)
    .where(and(eq(routingDecisions.surfaceKind, 'form'), eq(routingDecisions.submissionId, input.submissionId)));
  const pageId = decision?.pageId;
  if (decision === undefined || pageId === null || pageId === undefined) return undefined;
  const [uses] = await tx
    .select({ pageId: bookingPageRotations.pageId })
    .from(bookingPageRotations)
    .innerJoin(
      bookingPages,
      and(
        eq(bookingPages.workspaceId, bookingPageRotations.workspaceId),
        eq(bookingPages.id, bookingPageRotations.pageId),
      ),
    )
    .innerJoin(
      rotations,
      and(
        eq(rotations.workspaceId, bookingPageRotations.workspaceId),
        eq(rotations.id, bookingPageRotations.rotationId),
      ),
    )
    .where(
      and(
        eq(bookingPageRotations.pageId, pageId),
        eq(bookingPageRotations.rotationId, rotationId),
        eq(bookingPages.kind, 'round_robin'),
        isNull(bookingPages.deletedAt),
        isNull(rotations.deletedAt),
      ),
    );
  return uses === undefined ? undefined : { decisionId: decision.id, rotationId, pageId };
}

/**
 * Writes a form's decision row when it has none (AC-1372), so a waiting owner
 * always has a row to claim: rule id null, its fallback page as
 * `routed_page_id`. A row that exists stands.
 */
export async function ensureFormDecision(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly formId: string;
    readonly submissionId: string;
    readonly routedPageId: string;
  },
): Promise<void> {
  await tx
    .insert(routingDecisions)
    .values({
      workspaceId: input.workspaceId,
      surfaceKind: 'form',
      surfaceId: input.formId,
      ruleId: null,
      submissionId: input.submissionId,
      routedPageId: input.routedPageId,
    })
    .onConflictDoNothing();
}

/**
 * Claims a form's decision for `memberId` (AC-1372): one conditional update,
 * so of the booking and the unbooked job exactly one wins. True: this caller
 * writes the owner.
 */
export async function claimDecision(tx: WorkspaceTx, decisionId: string, memberId: string): Promise<boolean> {
  const claimed = await tx
    .update(routingDecisions)
    .set({ assignedMemberId: memberId, assignedAt: sql`now()` })
    .where(
      and(
        eq(routingDecisions.id, decisionId),
        eq(routingDecisions.surfaceKind, 'form'),
        isNull(routingDecisions.assignedAt),
      ),
    )
    .returning({ id: routingDecisions.id });
  return claimed.length > 0;
}

/** Whether a decision's claim is still open, for the submission panel's "waiting for the booking" line (AC-1423). */
export async function claimOpen(tx: WorkspaceTx, submissionId: string): Promise<boolean> {
  const [row] = await tx
    .select({ assignedAt: routingDecisions.assignedAt })
    .from(routingDecisions)
    .where(and(eq(routingDecisions.surfaceKind, 'form'), eq(routingDecisions.submissionId, submissionId)));
  return row !== undefined && row.assignedAt === null;
}

/** The kind's params: the one submission whose owner was waiting. */
export const UnbookedParams = z.strictObject({ submissionId: z.uuid(), decisionId: z.uuid() });
/** The kind's params. */
export type UnbookedParams = z.infer<typeof UnbookedParams>;

/**
 * Starts `routing.assign_unbooked` in the caller's write (AC-1372): once per
 * decision (`onceKey`), five minutes after the hand off expires. It runs
 * whether or not a booking was made: finding the claim taken, it does
 * nothing, so nothing has to be cancelled.
 */
export async function startUnbookedAssign(
  context: WriteContext,
  input: { readonly submissionId: string; readonly decisionId: string },
): Promise<void> {
  const [row] = await context.tx
    .select({ receivedAt: formSubmissions.receivedAt })
    .from(formSubmissions)
    .where(eq(formSubmissions.id, input.submissionId));
  if (row === undefined) return;
  await startJob(context, unbookedRegistry(), {
    kind: ROUTING_ASSIGN_UNBOOKED,
    params: { submissionId: input.submissionId, decisionId: input.decisionId },
    onceKey: `unbooked:${input.decisionId}`,
    runAt: new Date(row.receivedAt.getTime() + HANDOFF_LIFE_MS + UNBOOKED_DELAY_MS),
  });
}

/**
 * The wait for one submission being filed (AC-1372), with its decision row
 * made first when the form has none: a form with no rules whose After someone
 * sends it books a team page still needs a row to claim, so one is written
 * with rule id null and that page as `routed_page_id`.
 */
export async function ownerWaitForSubmission(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly formId: string;
    readonly ownerRotationId: string | null;
    readonly submissionId: string;
    /** The live version's After someone sends it, which names a page when it books one. */
    readonly afterPageId?: string;
  },
): Promise<OwnerWait | undefined> {
  if (input.ownerRotationId === null) return undefined;
  if (input.afterPageId !== undefined) {
    await ensureFormDecision(tx, {
      workspaceId: input.workspaceId,
      formId: input.formId,
      submissionId: input.submissionId,
      routedPageId: input.afterPageId,
    });
  }
  return ownerWait(tx, { ownerRotationId: input.ownerRotationId, submissionId: input.submissionId });
}

/** What the step reads of its submission. */
interface WaitingRow extends Record<string, unknown> {
  readonly form_id: string;
  readonly version_id: string;
  readonly main_record_id: string | null;
  readonly state: string;
}

/**
 * Picks the owner of a lead whose booking never came (AC-1372, AC-1423): it
 * claims the decision, and on winning asks `pickLeadOwner` on the form's
 * rotation under that rotation's lock, writes the owner on the submission's
 * main record as the form's own actor (exactly the owner field, nothing
 * else), writes the ledger row, and leaves the submission's `assignment`
 * naming the member, which is what queues their notice (AC-1391).
 */
export async function assignUnbooked(
  context: WriteContext,
  params: UnbookedParams,
  now: Date,
  rules?: RuleSource,
): Promise<void> {
  const { tx, scope } = context;
  const found = await tx.execute<WaitingRow>(sql`
    select form_id::text, version_id::text, main_record_id::text, state
    from form_submissions where id = ${params.submissionId} for update
  `);
  const submission = found.rows[0];
  if (submission === undefined || submission.state !== 'processed') return;
  const form = await loadForm(tx, submission.form_id);
  const rotationId = form?.ownerRotationId ?? null;
  if (form === undefined || rotationId === null) return;
  const version = (await loadVersions(tx, [submission.version_id])).get(submission.version_id);
  const objectId = version?.document.targets.main?.objectId;
  if (version === undefined || objectId === undefined) return;
  // The record the submission filed into, which the owner goes on.
  const [filed] = await tx
    .select({ recordId: formSubmissionRecords.recordId })
    .from(formSubmissionRecords)
    .where(and(eq(formSubmissionRecords.submissionId, params.submissionId), eq(formSubmissionRecords.role, 'main')));
  const recordId = filed?.recordId ?? submission.main_record_id;
  if (recordId === null) return;
  const attributes = await loadAttributes(tx, objectId);
  const owner = ownerAttribute(attributes);
  if (owner === undefined) return;

  // The rotation's lock first, as every other assignment takes it, and held to commit.
  await lockRotation(tx, scope.workspaceId, rotationId);
  const held = await currentItems(tx, [recordId], [owner.id]);
  const current = held.find((item) => item.ownerId === recordId && !item.isCleared && item.actorId !== null);
  const lead = await pickLeadOwner(tx, {
    workspaceId: scope.workspaceId,
    rotationId,
    now,
    recordId,
    ...(current === undefined ? {} : { current: heldMember(current) }),
  });
  if (lead.kind === 'none') {
    // Nobody could take it: the claim closes against nobody, so the lead stays unowned and nothing waits for ever.
    await closeWait(tx, params, { rotationId, reason: lead.reason });
    return;
  }
  const memberId = lead.kind === 'kept' ? undefined : lead.memberId;
  if (memberId === undefined) {
    await closeWait(tx, params, { rotationId, reason: 'kept_existing' });
    return;
  }
  if (!(await claimDecision(tx, params.decisionId, memberId))) return;
  const writer = actingAs(
    context,
    enterAsForm(
      scope,
      form.id,
      formAccess(form.id, { objectId, attributeIds: [...attributes.keys()], writable: new Set([owner.id]) }),
    ),
  );
  const value = owner.isMulti ? [{ type: 'member', id: memberId }] : { type: 'member', id: memberId };
  await updateRecord(writer, { recordId, values: { [owner.id]: { value } } });
  if (lead.kind === 'picked') {
    await recordLeadOwner(tx, writer.scope, lead, {
      recordId,
      formId: form.id,
      submissionId: params.submissionId,
    });
  }
  await closeWait(tx, params, {
    memberId,
    rotationId,
    reason: lead.kind === 'picked' ? lead.reason : 'already_assigned',
  });
  // The owner hears of the lead now, not at submit (AC-1391); everyone already told is skipped.
  await tellTeam(context, rules, params.submissionId);
}

/** The member an owner value holds, as `pickLeadOwner` takes it: an actor row naming a member. */
function heldMember(item: { readonly actorType: string | null; readonly actorId: string | null }): {
  readonly memberId?: string;
} {
  return item.actorType === 'member' && item.actorId !== null ? { memberId: item.actorId } : {};
}

/** Writes the submission's own record of who owns the lead, replacing the waiting one. */
async function closeWait(
  tx: WorkspaceTx,
  params: UnbookedParams,
  assignment: { readonly memberId?: string; readonly rotationId: string; readonly reason: string },
): Promise<void> {
  await tx
    .update(formSubmissions)
    .set({ assignment, updatedAt: sql`now()` })
    .where(eq(formSubmissions.id, params.submissionId));
}

/**
 * `routing.assign_unbooked` (AC-1372): the system's, on the light lane, one
 * submission a batch, never cancelled. Safe to run again: the claim is the
 * one decision, and a claim already taken makes the step a no op.
 */
export function routingUnbooked(rules?: RuleSource): KindDefinition<UnbookedParams> {
  return defineKind<UnbookedParams>({
    kind: ROUTING_ASSIGN_UNBOOKED,
    lane: 'light',
    actor: 'system',
    mode: 'cursor',
    params: UnbookedParams,
    cancellable: false,
    maxAttempts: MAX_ATTEMPTS.light,
    batchSize: 1,
    sample: {
      submissionId: '0199f0a0-0000-7000-8000-000000000001',
      decisionId: '0199f0a0-0000-7000-8000-000000000002',
    },
    async step(context, { job }) {
      await assignUnbooked(context, job.params, new Date(), rules);
      return { finished: true };
    },
  });
}

/**
 * The registry a submission's own write starts the unbooked job through: only
 * this one kind, so the forms processing needs no registry of its own (as
 * `computedRegistry` does for the computed kinds). It is a system kind, which
 * any write may start (spec 0008, AC-125).
 */
export function unbookedRegistry(): JobRegistry {
  return createRegistry([routingUnbooked()]);
}
