// Processing a submission into records (spec 0023, milestone 1, AC-557 to
// AC-566): the `forms.process` job kind on the light lane, the system's,
// one submission per job. In the job's one transaction it locks the
// submission, takes a transaction advisory lock on the main target's
// normalised match key (so two submissions for one new email make one
// record, AC-562), matches the main record on its object's unique attribute,
// and creates or updates it through the engine as the form's own actor
// (`enterAsForm`, AC-564), with only the attributes the published mapping
// names. An answer fills an empty value unless its question says `always`
// (AC-558). A value refused now (a rule changed since the visitor sent it)
// is skipped and recorded, the rest written (AC-565). It records each record
// it touched (AC-561), who was given ownership and why (AC-567), and ends the
// submission `processed`; a refusal no answer explains ends it `failed` at
// once, and anything unexpected is retried by the job, then `failed` (AC-566).
import { sql } from 'drizzle-orm';
import * as z from 'zod';
import { questionsOf, type EngineRefusal, type FormDocument, type FormOwner } from '@crm/contracts';
import { parseAttributeValue } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import { decodeValue, encodeValue } from '../engine/columns.ts';
import { insertRecord, updateRecord } from '../engine/records.ts';
import { uniqueKeyOf } from '../engine/unique.ts';
import { currentItems, isArchivedNow, loadAttributes, type AttributeDef } from '../engine/values.ts';
import type { EngineScope } from '../engine/scope.ts';
import type { WriteContext } from '../engine/write.ts';
import { enterAsForm } from '../access/door.ts';
import { formAccess } from '../access/policy.ts';
import { defineKind, MAX_ATTEMPTS, type KindDefinition } from '../jobs/registry.ts';
import { loadForm, loadVersions, questionAttribute } from './shared.ts';

const { formSubmissionRecords, formSubmissions, members } = schema;

/** The kind's params: the one submission it processes. */
export const FormsProcessParams = z.strictObject({ submissionId: z.uuid() });
/** The kind's params. */
export type FormsProcessParams = z.infer<typeof FormsProcessParams>;

/** The kind's name. */
export const FORMS_PROCESS = 'forms.process';

/** What a submission says when its job gave up after every try (AC-566). */
export const PROCESS_GAVE_UP = 'Processing kept failing, so it stopped. Retry it once the cause is fixed.';

/** Who a new record's owner is, and why (AC-567): what `assignment` stores. */
export interface Assignment {
  readonly memberId?: string;
  readonly reason: string;
}

/**
 * The seam round robin (#58) plugs into: who owns a new main record. Milestone
 * 1 has a fixed member (when still active) or nobody; `{ kind: 'rotation' }`
 * will call `assignOwner(rotationId, record)` here, once, inside this
 * transaction, its answer stored in `assignment` before records are written.
 */
export async function chooseOwner(tx: WorkspaceTx, owner: FormOwner): Promise<Assignment> {
  if (owner.kind === 'none') return { reason: 'none' };
  const [active] = await tx
    .select({ id: members.id })
    .from(members)
    .where(sql`${members.id} = ${owner.memberId} and ${members.status} = 'active'`);
  return active === undefined ? { reason: 'owner_removed' } : { memberId: owner.memberId, reason: 'fixed_member' };
}

/** The object's owner attribute, the standard `owner` actor reference, when it has a live one. */
function ownerAttribute(attributes: ReadonlyMap<string, AttributeDef>): AttributeDef | undefined {
  return [...attributes.values()].find(
    (attribute) =>
      attribute.apiSlug === 'owner' &&
      attribute.type === 'actor_reference' &&
      !attribute.isSystem &&
      !isArchivedNow(attribute),
  );
}

/**
 * A write context acting as `scope` (the form), on the same transaction and
 * its savepoints, every savepoint keeping that scope (as the runner's
 * `asSystem` does for `onFailed`).
 */
function actingAs(context: WriteContext, scope: EngineScope): WriteContext {
  return {
    ...context,
    scope,
    perRecord: (work) => context.perRecord((inner) => work(actingAs(inner, scope))),
  };
}

/** One answer bound for an attribute: the attribute, the value, and whether it overwrites. */
interface Planned {
  readonly attribute: AttributeDef;
  readonly questionId: string;
  readonly value: unknown;
  readonly always: boolean;
}

/** The answers a version's questions map to live attributes, parsed again for the attribute as it is now. */
function plan(
  document: FormDocument,
  attributes: ReadonlyMap<string, AttributeDef>,
  answers: Readonly<Record<string, unknown>>,
): { readonly planned: readonly Planned[]; readonly refused: { questionId: string; message: string }[] } {
  const planned: Planned[] = [];
  const refused: { questionId: string; message: string }[] = [];
  for (const question of questionsOf(document)) {
    if (!Object.hasOwn(answers, question.id)) continue;
    const attribute = questionAttribute(question, attributes);
    // An answer to an attribute archived, deleted or changed since stays on the submission only (AC-551).
    if (attribute === undefined) continue;
    const raw = answers[question.id];
    // A visitor answers one email, domain or address: the attribute holds it as one item of its list.
    const asList = attribute.isMulti && attribute.type !== 'select' && !Array.isArray(raw) ? [raw] : raw;
    const parsed = parseAttributeValue(attribute.type, asList, { allowMultiple: attribute.isMulti });
    if (!parsed.ok) {
      refused.push({ questionId: question.id, message: parsed.error.message });
      continue;
    }
    if (parsed.value === null) continue;
    planned.push({ attribute, questionId: question.id, value: parsed.value, always: question.update === 'always' });
  }
  return { planned, refused };
}

/** The normalised key the main record is matched on, from its planned answer (AC-557). */
function matchKey(
  planned: readonly Planned[],
  matchAttributeId: string,
): { attribute: AttributeDef; key: string } | undefined {
  const answer = planned.find((each) => each.attribute.id === matchAttributeId);
  if (answer === undefined) return undefined;
  const [first] = encodeValue(answer.attribute.type, answer.value);
  const key = first === undefined ? null : uniqueKeyOf(answer.attribute.type, first);
  return key === null ? undefined : { attribute: answer.attribute, key };
}

/**
 * The value an answer writes on a matched record (AC-558): `fill` only an
 * empty value, `always` overwrite; for a list (emails, domains) the answer's
 * items join the ones held, never replacing them. Undefined writes nothing.
 */
function mergedValue(planned: Planned, current: unknown): unknown {
  const { attribute, value } = planned;
  const isEmpty = current === null || current === undefined || (Array.isArray(current) && current.length === 0);
  if (attribute.isMulti && attribute.type !== 'select' && Array.isArray(value)) {
    const held: readonly unknown[] = Array.isArray(current) ? (current as unknown[]) : [];
    const seen = new Set(held.map((item) => JSON.stringify(item)));
    const added = (value as unknown[]).filter((item) => !seen.has(JSON.stringify(item)));
    if (added.length === 0 || (!planned.always && !isEmpty)) return undefined;
    return [...held, ...added];
  }
  if (!isEmpty && !planned.always) return undefined;
  return JSON.stringify(current) === JSON.stringify(value) ? undefined : value;
}

/** What one record write ended as: its result, the answers it skipped and why, or a refusal no answer explains. */
type Written<T> =
  | { readonly ok: true; readonly value: T; readonly skipped: readonly EngineRefusal[] }
  | { readonly ok: false; readonly failure: string };

/**
 * Runs a record write under its own savepoint, dropping each value the
 * engine refuses (naming its attribute) and trying again with the rest
 * (AC-565). A refusal that names no attribute of the write ends it.
 */
async function writeSkipping<T>(
  context: WriteContext,
  values: ReadonlyMap<string, unknown>,
  write: (inner: WriteContext, values: Readonly<Record<string, unknown>>) => Promise<T>,
): Promise<Written<T>> {
  const remaining = new Map(values);
  const skipped: EngineRefusal[] = [];
  for (let attempt = 0; attempt <= values.size; attempt += 1) {
    const result = await context.perRecord((inner) => write(inner, Object.fromEntries(remaining)));
    if (result.ok) return { ok: true, value: result.value, skipped };
    const named = result.refusals.filter(
      (refusal) => refusal.attributeId !== undefined && remaining.has(refusal.attributeId),
    );
    if (named.length === 0) {
      const [first] = result.refusals;
      const hidden = first?.code === 'VALUE_REQUIRED' && first.attributeId === undefined;
      return {
        ok: false,
        failure: hidden
          ? 'A required field isn’t asked by this form, so the record couldn’t be created. Add a question for it and publish.'
          : (first?.message ?? 'The record couldn’t be written.'),
      };
    }
    for (const refusal of named) {
      if (refusal.attributeId !== undefined) remaining.delete(refusal.attributeId);
      skipped.push(refusal);
    }
  }
  return { ok: false, failure: 'The record couldn’t be written.' };
}

/** A submission row as processing reads it, under its lock. */
interface SubmissionRow extends Record<string, unknown> {
  readonly id: string;
  readonly form_id: string;
  readonly version_id: string;
  readonly state: string;
  readonly answers: unknown;
}

/** Ends a submission `failed` with its reason (AC-566). */
async function failSubmission(tx: WorkspaceTx, submissionId: string, failure: string, extra: object = {}) {
  await tx
    .update(formSubmissions)
    .set({ state: 'failed', failure, updatedAt: sql`now()`, ...extra })
    .where(sql`${formSubmissions.id} = ${submissionId}`);
}

/**
 * Processes one submission (see the file's header). Does nothing for a
 * submission that is gone or no longer `received` (processed already, spam,
 * failed), so a job run twice never writes twice. Runs inside the job's
 * transaction with the system's scope (`context`).
 */
export async function processSubmission(context: WriteContext, submissionId: string): Promise<void> {
  const { tx } = context;
  const found = await tx.execute<SubmissionRow>(sql`
    select id::text, form_id::text, version_id::text, state, answers
    from form_submissions where id = ${submissionId} for update
  `);
  const submission = found.rows[0];
  if (submission === undefined || submission.state !== 'received') return;
  const form = await loadForm(tx, submission.form_id);
  if (form === undefined) return;
  const version = (await loadVersions(tx, [submission.version_id])).get(submission.version_id);
  if (version === undefined) throw new Error('A submission names a version that is gone.');
  const { document } = version;
  const answers =
    typeof submission.answers === 'object' && submission.answers !== null
      ? (submission.answers as Record<string, unknown>)
      : {};
  const attributes = await loadAttributes(tx, form.mainObjectId);
  const { planned, refused } = plan(document, attributes, answers);

  // Who owns a new record: chosen once, before anything is written (round robin's seam).
  const assignment = await chooseOwner(tx, document.owner);
  const owner = ownerAttribute(attributes);
  const ownerValue = assignment.memberId === undefined ? undefined : { type: 'member', id: assignment.memberId };

  // The form acts with exactly its mapping: the answered attributes and, when it gives one, the owner.
  const writable = new Set([
    ...planned.map((each) => each.attribute.id),
    ...(owner !== undefined && ownerValue !== undefined ? [owner.id] : []),
  ]);
  const access = formAccess(form.id, {
    objectId: form.mainObjectId,
    attributeIds: [...attributes.keys()],
    writable,
  });
  const asForm = actingAs(context, enterAsForm(context.scope, form.id, access));

  // Two submissions for one new key take turns here, so the second finds the first's record (AC-562).
  const match = matchKey(planned, document.targets.main.matchAttributeId);
  let matchedId: string | undefined;
  if (match !== undefined) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`form-match:${form.mainObjectId}:${match.attribute.id}:${match.key}`}, 0))`,
    );
    const hit = await tx.execute<{ record_id: string }>(sql`
      select v.record_id::text from "values" v
      join records r on r.workspace_id = v.workspace_id and r.id = v.record_id
      where v.attribute_id = ${match.attribute.id} and v.unique_key = ${match.key} and v.active_until is null
        and r.object_id = ${form.mainObjectId} and r.deleted_at is null
      order by r.created_at, r.id
      limit 1
    `);
    matchedId = hit.rows[0]?.record_id;
  }

  let recordId: string;
  let action: 'created' | 'updated' | 'matched';
  let skipped: readonly EngineRefusal[] = [];
  let gaveOwner = false;
  if (matchedId === undefined) {
    const values = new Map<string, unknown>(planned.map((each) => [each.attribute.id, each.value]));
    if (owner !== undefined && ownerValue !== undefined) {
      values.set(owner.id, owner.isMulti ? [ownerValue] : ownerValue);
      gaveOwner = true;
    }
    const written = await writeSkipping(asForm, values, (inner, given) =>
      insertRecord(inner, { objectId: form.mainObjectId, values: given }),
    );
    if (!written.ok) {
      await failSubmission(tx, submission.id, written.failure, { assignment, outcome: { refused } });
      return;
    }
    recordId = written.value.recordId;
    action = 'created';
    skipped = written.skipped;
  } else {
    recordId = matchedId;
    const ids = [...writable];
    const items = await currentItems(tx, [recordId], ids);
    const currentOf = (attribute: AttributeDef) =>
      decodeValue(
        attribute.type,
        attribute.isMulti,
        items.filter((item) => item.attributeId === attribute.id).sort((a, b) => a.position - b.position),
      );
    const values = new Map<string, unknown>();
    for (const each of planned) {
      const next = mergedValue(each, currentOf(each.attribute));
      if (next !== undefined) values.set(each.attribute.id, next);
    }
    // A matched record keeps its owner; one with none gets the form's choice (AC-567, processing rules).
    if (owner !== undefined && ownerValue !== undefined) {
      const held = currentOf(owner);
      if (held === null || (Array.isArray(held) && held.length === 0)) {
        values.set(owner.id, owner.isMulti ? [ownerValue] : ownerValue);
        gaveOwner = true;
      }
    }
    if (values.size === 0) {
      action = 'matched';
    } else {
      const written = await writeSkipping(asForm, values, (inner, given) =>
        updateRecord(inner, {
          recordId,
          values: Object.fromEntries(Object.entries(given).map(([id, value]) => [id, { value }])),
        }),
      );
      if (!written.ok) {
        await failSubmission(tx, submission.id, written.failure, { assignment, outcome: { refused } });
        return;
      }
      skipped = written.skipped;
      action = Object.values(written.value).some((result) => result.versionId !== undefined) ? 'updated' : 'matched';
    }
  }

  const questionOf = new Map(planned.map((each) => [each.attribute.id, each.questionId]));
  const allRefused = [
    ...refused,
    ...skipped.flatMap((refusal) => {
      const questionId = refusal.attributeId === undefined ? undefined : questionOf.get(refusal.attributeId);
      return questionId === undefined ? [] : [{ questionId, message: refusal.message }];
    }),
  ];
  const kept: Assignment =
    assignment.memberId !== undefined && !gaveOwner
      ? { reason: matchedId === undefined ? 'no_owner_field' : 'kept_existing' }
      : assignment;
  await tx
    .insert(formSubmissionRecords)
    .values({
      workspaceId: context.scope.workspaceId,
      submissionId: submission.id,
      objectId: form.mainObjectId,
      recordId,
      action,
      role: 'main',
    })
    .onConflictDoNothing();
  await tx
    .update(formSubmissions)
    .set({
      state: 'processed',
      processedAt: sql`now()`,
      mainRecordId: recordId,
      assignment: kept,
      outcome: { refused: allRefused },
      failure: null,
      updatedAt: sql`now()`,
    })
    .where(sql`${formSubmissions.id} = ${submission.id}`);
}

/**
 * `forms.process` (spec 0023): the system's, on the light lane, never
 * cancelled, 5 tries with the lane's backoff, then the submission ends
 * `failed` with a reason a member can act on (AC-566).
 */
export function formsProcess(): KindDefinition<FormsProcessParams> {
  return defineKind<FormsProcessParams>({
    kind: FORMS_PROCESS,
    lane: 'light',
    actor: 'system',
    mode: 'cursor',
    params: FormsProcessParams,
    cancellable: false,
    maxAttempts: MAX_ATTEMPTS.light,
    batchSize: 1,
    sample: { submissionId: '0199f0a0-0000-7000-8000-000000000001' },
    async step(context, { job }) {
      await processSubmission(context, job.params.submissionId);
      return { finished: true };
    },
    async onFailed(context, job) {
      if (job.params === undefined) return;
      await context.tx
        .update(formSubmissions)
        .set({ state: 'failed', failure: PROCESS_GAVE_UP, updatedAt: sql`now()` })
        .where(sql`${formSubmissions.id} = ${job.params.submissionId} and ${formSubmissions.state} = 'received'`);
    },
  });
}
