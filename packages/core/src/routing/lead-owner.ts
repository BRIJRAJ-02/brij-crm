// A form lead's owner that follows its meeting (spec 0037, AC-1372, AC-1423,
// AC-1427), routing's half: **the claim, and nothing else**.
//
// When a form's owner is a rotation and the submission's route books a team
// page that uses that **same** rotation, the owner waits. Both paths that can
// then give the lead an owner — the booking (`booking/lead.ts`) and
// `routing.assign_unbooked` (`forms/unbooked.ts`) — first claim the form's
// decision row with one conditional update:
//
//   update routing_decisions set assigned_member_id = …, assigned_at = now()
//   where id = … and submission_id = … and assigned_at is null
//
// Only the winner writes the owner; a booking that loses still books its
// host. The claim is the whole race, so the job needs no cancelling: it runs,
// finds the claim taken and does nothing.
//
// Routing never writes the owner attribute itself (AC-1423), which is why
// those two writes live under `booking/` and `forms/` and a source scan of
// this folder finds none (`smart.test.ts`).
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';
import { schema, type WorkspaceTx } from '@crm/db';
import { refuse } from '../engine/refusals.ts';
import type { WriteContext } from '../engine/write.ts';
import { createRegistry, defineKind, MAX_ATTEMPTS, type JobRegistry } from '../jobs/registry.ts';
import { startJob } from '../jobs/service.ts';

const { bookingPageRotations, bookingPages, formSubmissions, routingDecisions, rotations } = schema;

/** What a submission's `assignment` says while the owner waits for a booking (AC-1423). */
export const WAITING_FOR_BOOKING = 'waiting_for_booking';

/** How long a form's hand off lives (spec 0037's Numbers): past it, booking through it is refused. */
export const HANDOFF_LIFE_MS = 24 * 60 * 60 * 1_000;

/** How long after the hand off expires the unbooked job picks the owner (spec 0037's Numbers). */
export const UNBOOKED_DELAY_MS = 5 * 60 * 1_000;

/** The kind's name. The kind itself is declared in `forms/unbooked.ts`, which writes the owner. */
export const ROUTING_ASSIGN_UNBOOKED = 'routing.assign_unbooked';

/** What a visitor reads when they open a booking page through a hand off that has expired (AC-1427). */
export const HANDOFF_EXPIRED_MESSAGE = 'That link has expired. Fill the form in again to book.';

/** The kind's params: the one submission whose owner was waiting, and the decision row to claim. */
export const UnbookedParams = z.strictObject({ submissionId: z.uuid(), decisionId: z.uuid() });
/** The kind's params. */
export type UnbookedParams = z.infer<typeof UnbookedParams>;

/**
 * Whether a submission's hand off has expired (AC-1427): more than its life
 * since it came in.
 *
 * A submission this workspace can't see — another tenant's, or one that never
 * existed — answers false, and the booking goes on **without** a hand off:
 * `handoffSubmission` already refuses to link or read anything for it
 * (`booking.test.ts`, the security review of 21 October 2026). That is the
 * stricter answer, not the looser one: an unknown id grants nothing, and
 * refusing the booking instead would let any stranger's token stop a page
 * taking bookings at all.
 */
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
 * so of the booking and the unbooked job exactly one wins. The row must be
 * this submission's, so a stale decision id from a job's params can never
 * claim another lead. `null` closes the claim against nobody, which is what
 * the job does when the rotation could give the lead to no one, so the
 * submission's own record and the claim never disagree. True: this caller
 * writes the owner.
 */
export async function claimDecision(
  tx: WorkspaceTx,
  decisionId: string,
  submissionId: string,
  memberId: string | null,
): Promise<boolean> {
  const claimed = await tx
    .update(routingDecisions)
    .set({ assignedMemberId: memberId, assignedAt: sql`now()` })
    .where(
      and(
        eq(routingDecisions.id, decisionId),
        eq(routingDecisions.surfaceKind, 'form'),
        eq(routingDecisions.submissionId, submissionId),
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

/**
 * The registry a submission's own write starts the unbooked job through: the
 * one kind, with a step that refuses to run, since nothing here ever runs it
 * (the worker's registry holds the real one, from `forms/unbooked.ts`).
 * `startJob` only reads the kind's params, lane and actor, so this keeps the
 * owner write out of this folder (AC-1423) while a submission's write still
 * needs no registry of its own.
 */
export function unbookedRegistry(): JobRegistry {
  return createRegistry([
    defineKind<UnbookedParams>({
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
      step: () => {
        throw new Error('routing.assign_unbooked runs from the worker’s registry, never this one.');
      },
    }),
  ]);
}
