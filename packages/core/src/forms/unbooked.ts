// The lead whose booking never came (spec 0037, AC-1372, AC-1391, AC-1423):
// `routing.assign_unbooked`, five minutes after the hand off expires.
//
// It lives here, under `forms/`, and not under `routing/`, because it writes
// the lead's **owner**, and AC-1423 holds routing to claiming only: a source
// scan finds no write to the owner attribute under
// `packages/core/src/routing/`. Routing owns the claim
// (`routing/lead-owner.ts`); the owner comes from `pickLeadOwner`, as it does
// for every other form lead, so caps, time off, a returning owner and "keep
// an existing owner" all apply unchanged.
//
// Safe to run again: the claim is the one decision, and a claim already taken
// makes the step a no op. That is also why nothing has to be cancelled when a
// booking wins the race first.
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@crm/db';
import { enterAsForm, type RuleSource } from '../access/door.ts';
import { formAccess } from '../access/policy.ts';
import { updateRecord } from '../engine/records.ts';
import { currentItems, loadAttributes } from '../engine/values.ts';
import type { WriteContext } from '../engine/write.ts';
import { defineKind, MAX_ATTEMPTS, type KindDefinition } from '../jobs/registry.ts';
import { lockRotation } from '../rotation/ledger.ts';
import { pickLeadOwner, recordLeadOwner } from '../rotation/owner.ts';
import { claimDecision, ROUTING_ASSIGN_UNBOOKED, UnbookedParams } from '../routing/lead-owner.ts';
import { tellTeam } from './notify.ts';
import { actingAs, ownerAttribute } from './process.ts';
import { loadForm, loadVersions } from './shared.ts';

const { formSubmissionRecords, formSubmissions } = schema;

/** What the step reads of its submission. */
interface WaitingRow extends Record<string, unknown> {
  readonly form_id: string;
  readonly version_id: string;
  readonly main_record_id: string | null;
  readonly state: string;
}

/** The member an owner value holds, as `pickLeadOwner` takes it: an actor row naming a member. */
function heldMember(item: { readonly actorType: string | null; readonly actorId: string | null }): {
  readonly memberId?: string;
} {
  return item.actorType === 'member' && item.actorId !== null ? { memberId: item.actorId } : {};
}

/** Writes the submission's own record of who owns the lead, replacing the waiting one. */
async function closeWait(
  tx: WriteContext['tx'],
  submissionId: string,
  assignment: { readonly memberId?: string; readonly rotationId: string; readonly reason: string },
): Promise<void> {
  await tx
    .update(formSubmissions)
    .set({ assignment, updatedAt: sql`now()` })
    .where(eq(formSubmissions.id, submissionId));
}

/**
 * Picks the owner of a lead whose booking never came (AC-1372, AC-1423): it
 * claims the decision, and on winning asks `pickLeadOwner` on the form's
 * rotation under that rotation's lock, writes the owner on the submission's
 * main record as the form's own actor (exactly the owner field, nothing
 * else), writes the ledger row, and then tells that member, which is the
 * notice AC-1391 holds back from submit.
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
  const memberId = lead.kind === 'picked' || lead.kind === 'held' ? lead.memberId : undefined;
  if (memberId === undefined) {
    // Nobody could take it, or the record keeps the owner it has: the claim closes against nobody, so no later
    // booking assigns either and the panel and the database never disagree (AC-1423).
    await claimDecision(tx, params.decisionId, params.submissionId, null);
    await closeWait(tx, params.submissionId, {
      rotationId,
      reason: lead.kind === 'none' ? lead.reason : 'kept_existing',
    });
    return;
  }
  if (!(await claimDecision(tx, params.decisionId, params.submissionId, memberId))) return;
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
  await closeWait(tx, params.submissionId, {
    memberId,
    rotationId,
    reason: lead.kind === 'picked' ? lead.reason : 'already_assigned',
  });
  // The owner hears of the lead now, not at submit (AC-1391); everyone already told is skipped.
  await tellTeam(context, rules, params.submissionId);
}

/**
 * `routing.assign_unbooked` (AC-1372): the system's, on the light lane, one
 * submission a batch, never cancelled.
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
