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
import { fitsAttribute, type EngineRefusal, type FormDocument } from '@crm/contracts';
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
import { liveOptions, loadForm, loadVersions, type FormRow } from './shared.ts';

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
export async function chooseOwner(tx: WorkspaceTx, ownerMemberId: string | null): Promise<Assignment> {
  if (ownerMemberId === null) return { reason: 'none' };
  const [active] = await tx
    .select({ id: members.id })
    .from(members)
    .where(sql`${members.id} = ${ownerMemberId} and ${members.status} = 'active'`);
  return active === undefined ? { reason: 'owner_removed' } : { memberId: ownerMemberId, reason: 'fixed_member' };
}

/** The object's owner attribute, the standard `owner` actor reference, when it has a live one. */
export function ownerAttribute(attributes: ReadonlyMap<string, AttributeDef>): AttributeDef | undefined {
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
export interface Planned {
  readonly attribute: AttributeDef;
  readonly questionId: string;
  readonly value: unknown;
  readonly always: boolean;
}

/** A name typed as one line, as a person's name: the last word the last name, the rest the first. */
function personalName(text: string): { firstName?: string; lastName?: string; fullName: string } {
  const words = text.trim().split(/\s+/);
  const lastName = words.length > 1 ? words.at(-1) : undefined;
  const firstName = words.slice(0, words.length > 1 ? -1 : undefined).join(' ');
  return {
    ...(firstName === '' ? {} : { firstName }),
    ...(lastName === undefined ? {} : { lastName }),
    fullName: text.trim(),
  };
}

/**
 * An answer as the value its attribute takes (spec 0023, Answer types): text
 * as itself (a name split into first and last), a choice or a country by the
 * option of that label, a website as its domain for a domain, a phone as its
 * number and country. A choice the attribute has no option for is refused
 * with why, and the rest of the submission still lands (AC-565).
 */
function valueFor(
  attribute: AttributeDef,
  answer: unknown,
  options: ReadonlyMap<string, readonly { id: string; label: string }[]>,
): { value: unknown } | { refused: string } {
  switch (attribute.type) {
    case 'personal_name':
      return typeof answer === 'string' ? { value: personalName(answer) } : { refused: 'That isn’t a name.' };
    case 'select':
    case 'status': {
      const label = typeof answer === 'string' ? answer.trim().toLowerCase() : '';
      const option = (options.get(attribute.id) ?? []).find((each) => each.label.trim().toLowerCase() === label);
      if (option === undefined) return { refused: `${attribute.title} has no option called “${String(answer)}”.` };
      return { value: attribute.isMulti ? [option.id] : option.id };
    }
    case 'domain': {
      if (typeof answer !== 'string') return { refused: 'That isn’t a web address.' };
      try {
        return { value: new URL(answer).hostname.replace(/^www\./, '') };
      } catch {
        return { refused: 'That isn’t a web address.' };
      }
    }
    default:
      return { value: answer };
  }
}

/** The options a document's choice questions file onto, loaded once for every submission it files. */
export async function optionsFor(
  tx: WorkspaceTx,
  document: FormDocument,
  attributes: ReadonlyMap<string, AttributeDef>,
): Promise<ReadonlyMap<string, readonly { id: string; label: string }[]>> {
  const filedSelects = document.questions.flatMap((question) => {
    const attribute = question.filedOn === undefined ? undefined : attributes.get(question.filedOn.attributeId);
    return attribute !== undefined && (attribute.type === 'select' || attribute.type === 'status')
      ? [attribute.id]
      : [];
  });
  return liveOptions(tx, filedSelects);
}

/** The answers a version's questions file on live attributes, as each attribute takes them now (no I/O). */
export function plan(
  document: FormDocument,
  attributes: ReadonlyMap<string, AttributeDef>,
  options: ReadonlyMap<string, readonly { id: string; label: string }[]>,
  answers: Readonly<Record<string, unknown>>,
): { readonly planned: readonly Planned[]; readonly refused: { questionId: string; message: string }[] } {
  const planned: Planned[] = [];
  const refused: { questionId: string; message: string }[] = [];
  for (const question of document.questions) {
    if (question.filedOn === undefined || !Object.hasOwn(answers, question.key)) continue;
    const attribute = attributes.get(question.filedOn.attributeId);
    // An answer filed on an attribute archived, deleted or changed since stays on the submission only (AC-551).
    if (attribute === undefined || attribute.isSystem || isArchivedNow(attribute)) continue;
    if (!fitsAttribute(question.answerType, attribute.type)) continue;
    const converted = valueFor(attribute, answers[question.key], options);
    if ('refused' in converted) {
      refused.push({ questionId: question.id, message: converted.refused });
      continue;
    }
    const raw = converted.value;
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
export function matchKey(
  planned: readonly Planned[],
  matchAttributeId: string | undefined,
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
export function mergedValue(planned: Planned, current: unknown): unknown {
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

/** What filing a submission's answers ended as. */
export type Filed =
  | {
      readonly kind: 'filed';
      readonly recordId: string;
      readonly action: 'created' | 'updated' | 'matched';
      readonly refused: readonly { questionId: string; message: string }[];
      readonly assignment: Assignment;
    }
  | {
      readonly kind: 'failed';
      readonly failure: string;
      readonly refused: readonly { questionId: string; message: string }[];
      readonly assignment: Assignment;
    };

/** What filing one submission reads: its answers, the form, the mapping to apply, and who writes. */
export interface FileInput {
  readonly submissionId: string;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly form: FormRow;
  readonly document: FormDocument;
  readonly attributes: ReadonlyMap<string, AttributeDef>;
  readonly options: ReadonlyMap<string, readonly { id: string; label: string }[]>;
  /** A live record the submission already filed into: updated in place rather than matched again. */
  readonly keepRecordId?: string;
  /**
   * Who writes the records: the form itself (`processSubmission`, AC-564), or
   * a member through their own access (Add to CRM, Sync old records). Called
   * with the attributes the mapping writes.
   */
  readonly writer: (writable: ReadonlySet<string>) => WriteContext;
}

/**
 * Files one submission's answers into the main record (see the file's
 * header): matches or creates it, writes only the mapping's attributes,
 * records the touch in `form_submission_records`. Leaves the submission's
 * own state to the caller. Runs inside the caller's transaction.
 */
export async function fileAnswers(context: WriteContext, input: FileInput): Promise<Filed> {
  const { tx } = context;
  const { form, document, attributes } = input;
  const { planned, refused } = plan(document, attributes, input.options, input.answers);

  // Who owns a new record: chosen once, before anything is written (round robin's seam).
  const assignment = await chooseOwner(tx, form.ownerMemberId);
  const owner = ownerAttribute(attributes);
  const ownerValue = assignment.memberId === undefined ? undefined : { type: 'member', id: assignment.memberId };
  const writable = new Set([
    ...planned.map((each) => each.attribute.id),
    ...(owner !== undefined && ownerValue !== undefined ? [owner.id] : []),
  ]);
  const writer = input.writer(writable);

  let matchedId: string | undefined = input.keepRecordId;
  if (matchedId === undefined) {
    // Two submissions for one new key take turns here, so the second finds the first's record (AC-562).
    const match = matchKey(planned, document.targets.main.matchAttributeId);
    if (match !== undefined) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`form-match:${form.mainObjectId}:${match.attribute.id}:${match.key}`}, 0))`,
      );
      matchedId = await matchedRecord(tx, form.mainObjectId, match.attribute.id, match.key);
    }
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
    const written = await writeSkipping(writer, values, (inner, given) =>
      insertRecord(inner, { objectId: form.mainObjectId, values: given }),
    );
    if (!written.ok) return { kind: 'failed', failure: written.failure, refused, assignment };
    recordId = written.value.recordId;
    action = 'created';
    skipped = written.skipped;
  } else {
    recordId = matchedId;
    const values = await changesFor(tx, recordId, planned, owner, ownerValue);
    gaveOwner = values.gaveOwner;
    if (values.changes.size === 0) {
      action = 'matched';
    } else {
      const written = await writeSkipping(writer, values.changes, (inner, given) =>
        updateRecord(inner, {
          recordId,
          values: Object.fromEntries(Object.entries(given).map(([id, value]) => [id, { value }])),
        }),
      );
      if (!written.ok) return { kind: 'failed', failure: written.failure, refused, assignment };
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
      submissionId: input.submissionId,
      objectId: form.mainObjectId,
      recordId,
      action,
      role: 'main',
    })
    .onConflictDoNothing();
  return { kind: 'filed', recordId, action, refused: allRefused, assignment: kept };
}

/** The oldest live record of `objectId` holding `key` on the unique attribute, if any. */
export async function matchedRecord(
  tx: WorkspaceTx,
  objectId: string,
  attributeId: string,
  key: string,
): Promise<string | undefined> {
  const hit = await tx.execute<{ record_id: string }>(sql`
    select v.record_id::text from "values" v
    join records r on r.workspace_id = v.workspace_id and r.id = v.record_id
    where v.attribute_id = ${attributeId} and v.unique_key = ${key} and v.active_until is null
      and r.object_id = ${objectId} and r.deleted_at is null
    order by r.created_at, r.id
    limit 1
  `);
  return hit.rows[0]?.record_id;
}

/**
 * The values filing would change on a matched record (AC-558): each planned
 * answer merged with what the record holds, and the owner when it has none.
 */
export async function changesFor(
  tx: WorkspaceTx,
  recordId: string,
  planned: readonly Planned[],
  owner: AttributeDef | undefined,
  ownerValue: unknown,
  held?: ReturnType<typeof heldValues>,
): Promise<{ readonly changes: ReadonlyMap<string, unknown>; readonly gaveOwner: boolean }> {
  const ids = [...planned.map((each) => each.attribute.id), ...(owner === undefined ? [] : [owner.id])];
  const currentOf = held ?? heldValues(await currentItems(tx, [recordId], ids), recordId);
  const changes = new Map<string, unknown>();
  for (const each of planned) {
    const next = mergedValue(each, currentOf(each.attribute));
    if (next !== undefined) changes.set(each.attribute.id, next);
  }
  let gaveOwner = false;
  // A matched record keeps its owner; one with none gets the form's choice (AC-567, processing rules).
  if (owner !== undefined && ownerValue !== undefined) {
    const current = currentOf(owner);
    if (current === null || (Array.isArray(current) && current.length === 0)) {
      changes.set(owner.id, owner.isMulti ? [ownerValue] : ownerValue);
      gaveOwner = true;
    }
  }
  return { changes, gaveOwner };
}

/** A reader of one record's current values, by attribute, from items read for many records at once. */
export function heldValues(
  items: Awaited<ReturnType<typeof currentItems>>,
  recordId: string,
): (attribute: AttributeDef) => unknown {
  return (attribute) =>
    decodeValue(
      attribute.type,
      attribute.isMulti,
      items
        .filter((item) => item.ownerId === recordId && item.attributeId === attribute.id)
        .sort((a, b) => a.position - b.position),
    );
}

/**
 * Processes one submission (see the file's header). Does nothing for a
 * submission that is gone or no longer `received` (processed already, spam,
 * failed), so a job run twice never writes twice. Runs inside the job's
 * transaction with the system's scope (`context`), writing as the form.
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
  const attributes = await loadAttributes(tx, form.mainObjectId);
  const filed = await fileAnswers(context, {
    submissionId: submission.id,
    answers: answersOf(submission.answers),
    form,
    document,
    attributes,
    options: await optionsFor(tx, document, attributes),
    // The form acts with exactly its mapping: the answered attributes and, when it gives one, the owner.
    writer: (writable) =>
      actingAs(
        context,
        enterAsForm(
          context.scope,
          form.id,
          formAccess(form.id, { objectId: form.mainObjectId, attributeIds: [...attributes.keys()], writable }),
        ),
      ),
  });
  await settle(tx, submission.id, filed);
}

/** A stored answers column as a plain object. */
export function answersOf(stored: unknown): Readonly<Record<string, unknown>> {
  return typeof stored === 'object' && stored !== null && !Array.isArray(stored)
    ? (stored as Record<string, unknown>)
    : {};
}

/** Ends a submission as filing left it: `processed` with its record, or `failed` with why (AC-566). */
export async function settle(
  tx: WorkspaceTx,
  submissionId: string,
  filed: Filed,
  extraOutcome: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  if (filed.kind === 'failed') {
    await failSubmission(tx, submissionId, filed.failure, {
      assignment: filed.assignment,
      outcome: { refused: filed.refused, ...extraOutcome },
    });
    return;
  }
  await tx
    .update(formSubmissions)
    .set({
      state: 'processed',
      processedAt: sql`now()`,
      mainRecordId: filed.recordId,
      assignment: filed.assignment,
      outcome: { refused: filed.refused, ...extraOutcome },
      failure: null,
      updatedAt: sql`now()`,
    })
    .where(sql`${formSubmissions.id} = ${submissionId}`);
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
