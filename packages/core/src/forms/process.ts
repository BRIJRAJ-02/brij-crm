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
// A form whose owner is a round robin rotation hands each lead to the
// rotation's fairest member (spec 0029 milestone 3, `rotation/owner.ts`), for
// every submission, whether or not the visitor goes on to book (spec 0023
// AC-1050): the rotation's lock first, then the match key's, the pick before
// the write and its ledger row after it, all in this one transaction.
import { sql } from 'drizzle-orm';
import * as z from 'zod';
import { fitsAttribute, type EngineRefusal, type FormDocument } from '@crm/contracts';
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
import { parseAttributeInput } from '../engine/parse-value.ts';
import { lockRotation } from '../rotation/ledger.ts';
import { pickLeadOwner, recordLeadOwner, type LeadOwner } from '../rotation/owner.ts';

const { formSubmissionRecords, formSubmissions, members } = schema;

/** The kind's params: the one submission it processes. */
export const FormsProcessParams = z.strictObject({ submissionId: z.uuid() });
/** The kind's params. */
export type FormsProcessParams = z.infer<typeof FormsProcessParams>;

/** The kind's name. */
export const FORMS_PROCESS = 'forms.process';

/** What a submission says when its job gave up after every try (AC-566). */
export const PROCESS_GAVE_UP = 'Processing kept failing, so it stopped. Retry it once the cause is fixed.';

/**
 * Who a new record's owner is, and why (AC-567): what `assignment` stores.
 * With a rotation (AC-1050): its id, and the pick's reason (`fair`,
 * `priority`, `even`, `owner`, `only_free`), `already_assigned` (the rotation
 * gave this lead to them before), `kept_existing`, `none_available` or
 * `rotation_gone` (AC-756), or `not_filed` when the record wasn't written.
 */
export interface Assignment {
  readonly memberId?: string;
  readonly rotationId?: string;
  readonly reason: string;
}

/** A stored `assignment` column read back, or undefined when it holds nothing usable. */
export function assignmentOf(stored: unknown): Assignment | undefined {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return undefined;
  const { memberId, rotationId, reason } = stored as Record<string, unknown>;
  if (typeof reason !== 'string') return undefined;
  return {
    reason,
    ...(typeof memberId === 'string' ? { memberId } : {}),
    ...(typeof rotationId === 'string' ? { rotationId } : {}),
  };
}

/** A fixed owner: the form's member while still active, else nobody (`owner_removed`). */
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
    const parsed = parseAttributeInput(attribute, asList);
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
  readonly assignment: unknown;
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

/** What filing one submission reads: its answers, the form, the mapping to apply and its object, and who writes. */
export interface FileInput {
  readonly submissionId: string;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly form: FormRow;
  readonly document: FormDocument;
  /** The object the mapping files onto: its document's target (the version sent, or the live one for a member's filing). */
  readonly objectId: string;
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
  /**
   * Whether the writer may file into an existing record (a member's filing:
   * only records they can see). Absent for the form's own processing.
   */
  readonly canUse?: (recordId: string) => Promise<boolean>;
  /** What the submission recorded when it was filed before: a rotation's pick is never made twice for it. */
  readonly previous?: Assignment;
  /** The clock a rotation's pick reads (its window, caps and days off). */
  readonly now?: Date;
}

/** What filing into a record the member can't open says, without saying whose it is. */
export const HIDDEN_TARGET =
  'This submission belongs with a record you can’t open, so it wasn’t filed. Ask someone who can.';

/**
 * Files one submission's answers into the main record (see the file's
 * header): matches or creates it, writes only the mapping's attributes,
 * records the touch in `form_submission_records`. Leaves the submission's
 * own state to the caller. Runs inside the caller's transaction.
 */
export async function fileAnswers(context: WriteContext, input: FileInput): Promise<Filed> {
  const { tx } = context;
  const { form, document, attributes, objectId } = input;
  const { planned, refused } = plan(document, attributes, input.options, input.answers);
  const owner = ownerAttribute(attributes);
  // A rotation's lock comes before any match key's (bookings take it first too), held to commit. A batch takes it
  // before its first submission's row (`fileBatch`), so this is the same lock taken again there.
  const rotationId = owner === undefined ? undefined : (form.ownerRotationId ?? undefined);
  if (rotationId !== undefined) await lockRotation(tx, context.scope.workspaceId, rotationId);

  let matchedId: string | undefined = input.keepRecordId;
  if (matchedId === undefined) {
    // Two submissions for one new key take turns here, so the second finds the first's record (AC-562).
    const match = matchKey(planned, document.targets.main?.matchAttributeId);
    if (match !== undefined) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`form-match:${objectId}:${match.attribute.id}:${match.key}`}, 0))`,
      );
      matchedId = await matchedRecord(tx, objectId, match.attribute.id, match.key);
    }
  }

  if (matchedId !== undefined && input.canUse !== undefined && !(await input.canUse(matchedId))) {
    return { kind: 'failed', failure: HIDDEN_TARGET, refused, assignment: notFiled(form) };
  }

  // Who owns the record: chosen once, before anything is written (AC-567, AC-1050).
  const chosen = await chooseFor(context, input, owner, matchedId);
  const { assignment } = chosen;
  const ownerValue = chosen.memberId === undefined ? undefined : { type: 'member', id: chosen.memberId };
  const writable = new Set([
    ...planned.map((each) => each.attribute.id),
    ...(owner !== undefined && ownerValue !== undefined ? [owner.id] : []),
  ]);
  const writer = input.writer(writable);
  // The owner lands only when the engine took it (a member's filing skips a field their access can't write).
  const ownerTaken = (skipped: readonly EngineRefusal[]) =>
    owner !== undefined && !skipped.some((refusal) => refusal.attributeId === owner.id);

  let recordId: string;
  let action: 'created' | 'updated' | 'matched';
  let skipped: readonly EngineRefusal[] = [];
  let gaveOwner: boolean;
  if (matchedId === undefined) {
    const values = new Map<string, unknown>(planned.map((each) => [each.attribute.id, each.value]));
    if (owner !== undefined && ownerValue !== undefined) {
      values.set(owner.id, owner.isMulti ? [ownerValue] : ownerValue);
    }
    const written = await writeSkipping(writer, values, (inner, given) =>
      insertRecord(inner, { objectId, values: given }),
    );
    if (!written.ok) {
      return { kind: 'failed', failure: written.failure, refused, assignment: notFiled(form, assignment) };
    }
    recordId = written.value.recordId;
    action = 'created';
    skipped = written.skipped;
    gaveOwner = ownerValue !== undefined && ownerTaken(skipped);
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
      if (!written.ok) {
        return { kind: 'failed', failure: written.failure, refused, assignment: notFiled(form, assignment) };
      }
      skipped = written.skipped;
      gaveOwner = gaveOwner && ownerTaken(skipped);
      action = Object.values(written.value).some((result) => result.versionId !== undefined) ? 'updated' : 'matched';
    }
  }

  // The rotation's ledger row, once the lead is theirs: given now, or counted to the owner it kept (AC-755).
  const pick = chosen.pick;
  const counted = pick !== undefined && (gaveOwner || pick.reason === 'owner');
  if (counted) {
    await recordLeadOwner(tx, writer.scope, pick, { recordId, formId: form.id, submissionId: input.submissionId });
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
    assignment.memberId !== undefined && !gaveOwner && !counted
      ? {
          ...(assignment.rotationId === undefined ? {} : { rotationId: assignment.rotationId }),
          reason: matchedId === undefined ? 'no_owner_field' : 'kept_existing',
        }
      : assignment;
  await tx
    .insert(formSubmissionRecords)
    .values({
      workspaceId: context.scope.workspaceId,
      submissionId: input.submissionId,
      objectId,
      recordId,
      action,
      role: 'main',
    })
    .onConflictDoNothing();
  return { kind: 'filed', recordId, action, refused: allRefused, assignment: kept };
}

/** What a submission that wasn't filed records of its owner: a rotation's pick wasn't made, so it says so. */
function notFiled(form: FormRow, chosen?: Assignment): Assignment {
  if (form.ownerRotationId !== null) return { rotationId: form.ownerRotationId, reason: 'not_filed' };
  return chosen ?? { reason: 'not_filed' };
}

/** The owner filing gives: the member (if any), what the submission records, and a rotation's pick to count. */
interface OwnerChoice {
  readonly memberId?: string;
  readonly assignment: Assignment;
  readonly pick?: Extract<LeadOwner, { kind: 'picked' }>;
}

/** Whether an owner value holds anyone, and the member it names (the first, for a list). */
function heldOwner(value: unknown): { readonly memberId?: string } | undefined {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  if (first === null || first === undefined) return undefined;
  const { type, id } = typeof first === 'object' ? (first as { type?: unknown; id?: unknown }) : {};
  return type === 'member' && typeof id === 'string' ? { memberId: id } : {};
}

/**
 * Who owns the record filing writes (AC-567): a fixed member, or the form's
 * rotation (AC-755, AC-756, AC-1050) asked once for this lead, under its lock.
 * A matched record that has an owner keeps them; filing again into the record
 * the submission filed into before (Sync) never counts it again.
 */
async function chooseFor(
  context: WriteContext,
  input: FileInput,
  owner: AttributeDef | undefined,
  matchedId: string | undefined,
): Promise<OwnerChoice> {
  const { tx } = context;
  const rotationId = input.form.ownerRotationId;
  if (rotationId === null) {
    const fixed = await chooseOwner(tx, input.form.ownerMemberId);
    return { ...(fixed.memberId === undefined ? {} : { memberId: fixed.memberId }), assignment: fixed };
  }
  if (owner === undefined) return { assignment: { rotationId, reason: 'no_owner_field' } };
  const current =
    matchedId === undefined
      ? undefined
      : heldOwner(heldValues(indexHeld(await currentItems(tx, [matchedId], [owner.id])), matchedId)(owner));
  const previous = input.previous?.rotationId === rotationId ? input.previous.memberId : undefined;
  const lead = await pickLeadOwner(tx, {
    workspaceId: context.scope.workspaceId,
    rotationId,
    now: input.now ?? new Date(),
    ...(matchedId === undefined ? {} : { recordId: matchedId }),
    ...(current === undefined ? {} : { current }),
    ...(previous === undefined ? {} : { previousMemberId: previous }),
    again: input.keepRecordId !== undefined,
  });
  switch (lead.kind) {
    case 'picked':
      return {
        memberId: lead.memberId,
        assignment: { memberId: lead.memberId, rotationId, reason: lead.reason },
        pick: lead,
      };
    case 'held':
      return {
        memberId: lead.memberId,
        assignment: { memberId: lead.memberId, rotationId, reason: 'already_assigned' },
      };
    case 'kept':
      return { assignment: { rotationId, reason: 'kept_existing' } };
    case 'none':
      return { assignment: { rotationId, reason: lead.reason } };
  }
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
  const currentOf = held ?? heldValues(indexHeld(await currentItems(tx, [recordId], ids)), recordId);
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

/** Current items grouped by record and attribute, each group in position order: built once for many records. */
export type HeldIndex = ReadonlyMap<string, Awaited<ReturnType<typeof currentItems>>>;

/** Groups items read for many records at once by `record:attribute`, each group sorted by position. */
export function indexHeld(items: Awaited<ReturnType<typeof currentItems>>): HeldIndex {
  const groups = new Map<string, (typeof items)[number][]>();
  for (const item of items) {
    const key = `${item.ownerId}:${item.attributeId}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  }
  for (const group of groups.values()) group.sort((a, b) => a.position - b.position);
  return groups;
}

/** A reader of one record's current values, by attribute, from an index of many records' items. */
export function heldValues(index: HeldIndex, recordId: string): (attribute: AttributeDef) => unknown {
  return (attribute) => decodeValue(attribute.type, attribute.isMulti, index.get(`${recordId}:${attribute.id}`) ?? []);
}

/**
 * Processes one submission (see the file's header). Does nothing for a
 * submission that is gone or no longer `received` (processed already, spam,
 * failed), so a job run twice never writes twice. Runs inside the job's
 * transaction with the system's scope (`context`), writing as the form.
 */
export async function processSubmission(
  context: WriteContext,
  submissionId: string,
  now: Date = new Date(),
): Promise<void> {
  const { tx } = context;
  const found = await tx.execute<SubmissionRow>(sql`
    select id::text, form_id::text, version_id::text, state, answers, assignment
    from form_submissions where id = ${submissionId} for update
  `);
  const submission = found.rows[0];
  if (submission === undefined || submission.state !== 'received') return;
  const form = await loadForm(tx, submission.form_id);
  if (form === undefined) return;
  const version = (await loadVersions(tx, [submission.version_id])).get(submission.version_id);
  if (version === undefined) throw new Error('A submission names a version that is gone.');
  const { document } = version;
  // A version that keeps its submissions only files nothing: the submission is done as it is.
  const target = document.targets.main;
  if (target === undefined) {
    await keep(tx, submission.id);
    return;
  }
  const attributes = await loadAttributes(tx, target.objectId);
  const filed = await fileAnswers(context, {
    submissionId: submission.id,
    answers: answersOf(submission.answers),
    form,
    document,
    objectId: target.objectId,
    attributes,
    options: await optionsFor(tx, document, attributes),
    ...withPrevious(assignmentOf(submission.assignment)),
    now,
    // The form acts with exactly its mapping: the answered attributes and, when it gives one, the owner.
    writer: (writable) =>
      actingAs(
        context,
        enterAsForm(
          context.scope,
          form.id,
          formAccess(form.id, { objectId: target.objectId, attributeIds: [...attributes.keys()], writable }),
        ),
      ),
  });
  await settle(tx, submission.id, filed);
}

/** A stored assignment as filing's `previous`, when there is one. */
export const withPrevious = (previous: Assignment | undefined) => (previous === undefined ? {} : { previous });

/** Ends a submission its form keeps only: `processed`, with no record, its outcome saying it was kept. */
async function keep(tx: WorkspaceTx, submissionId: string): Promise<void> {
  await tx
    .update(formSubmissions)
    .set({
      state: 'processed',
      processedAt: sql`now()`,
      outcome: { kept: true },
      failure: null,
      updatedAt: sql`now()`,
    })
    .where(sql`${formSubmissions.id} = ${submissionId}`);
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
