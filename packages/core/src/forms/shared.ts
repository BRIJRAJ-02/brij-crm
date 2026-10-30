// What the forms services share (spec 0023): reading a form and its versions,
// the target object's attributes as filing choices and as the publish check
// sees them, and turning a version's document into what a visitor's page
// renders (`PublicForm`): no attribute ids, filing, owner or routing.
import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  choiceKeysOf,
  FormDocument,
  type FormQuestion,
  type PublicForm,
  type PublicQuestion,
  type PublishAttribute,
} from '@crm/contracts';
import { ANONYMOUS, Hue, isUnfillableRequired } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import { isArchivedNow, loadAttributes, type AttributeDef } from '../engine/values.ts';
import { can, fieldLevel, objectLevel, type Access } from '../access/policy.ts';
import { attributeVisible } from '../access/visibility.ts';

const { attributeOptions, forms, formVersions, objects } = schema;

/** A form row as the services read it. */
export interface FormRow {
  readonly id: string;
  readonly kind: string;
  readonly status: 'draft' | 'live' | 'paused' | 'archived';
  readonly name: string;
  /** The draft's target object; null while the form keeps its submissions only. */
  readonly mainObjectId: string | null;
  readonly publicKey: string;
  readonly draftVersionId: string | null;
  readonly liveVersionId: string | null;
  /**
   * The live version's target object (lower case, as access keys it); null with no live version, or while it
   * keeps its submissions only. It differs from `mainObjectId` once a published form's draft points elsewhere.
   */
  readonly liveObjectId: string | null;
  readonly revision: number;
  readonly ownerMemberId: string | null;
  /** The rotation that gives each new lead its owner (spec 0029 milestone 3); null when a member or nobody does. */
  readonly ownerRotationId: string | null;
  /** Who is told about each new submission besides the lead's owner, in the list's order, members who left left out. */
  readonly notifyMemberIds: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly requireSignature: boolean;
  readonly signingSecret: string;
  readonly createdById: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The live version's target object as a select reads it beside its form (see `FormRow.liveObjectId`). */
export function liveObjectOf() {
  return sql<
    string | null
  >`(select lower(v.document->'targets'->'main'->>'objectId') from ${formVersions} v where v.workspace_id = ${forms.workspaceId} and v.id = ${forms.liveVersionId})`;
}

/**
 * A workspace's public key (`ws_` and 16 hex), what a snippet's
 * `data-timefix-workspace` names (spec 0023, tagging): a one way digest of
 * its id, so a site's markup never carries an internal id, the same key
 * every time, and nothing to store or migrate.
 */
export function workspacePublicKey(workspaceId: string): string {
  return `ws_${createHash('sha256').update(`timefix-workspace:${workspaceId}`).digest('hex').slice(0, 16)}`;
}

/** A moment as fixed width UTC text with milliseconds, as the views carry it. */
export const millis = (column: string) =>
  sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

const FORM_COLUMNS = {
  id: forms.id,
  kind: forms.kind,
  status: sql<FormRow['status']>`${forms.status}`,
  name: forms.name,
  mainObjectId: forms.mainObjectId,
  publicKey: forms.publicKey,
  draftVersionId: forms.draftVersionId,
  liveVersionId: forms.liveVersionId,
  liveObjectId: liveObjectOf(),
  revision: forms.revision,
  ownerMemberId: forms.ownerMemberId,
  ownerRotationId: forms.ownerRotationId,
  notifyMemberIds: sql<
    string[]
  >`array(select m.id::text from members m, unnest(${forms.notifyMemberIds}) with ordinality as n(id, position)
    where m.workspace_id = ${forms.workspaceId} and m.id = n.id and m.status = 'active' order by n.position)`,
  allowedOrigins: forms.allowedOrigins,
  requireSignature: forms.requireSignature,
  signingSecret: forms.signingSecret,
  createdById: forms.createdById,
  createdAt: sql<string>`to_char(${forms.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  updatedAt: sql<string>`to_char(${forms.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
};

/** One form, locked against other writers when `lock` says so, or undefined. */
export async function loadForm(tx: WorkspaceTx, formId: string, lock = false): Promise<FormRow | undefined> {
  const query = tx.select(FORM_COLUMNS).from(forms).where(eq(forms.id, formId));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

/** A version as the services read it: its number, its document (parsed), who saved it last, and whether it is published. */
export interface VersionRow {
  readonly id: string;
  readonly number: number;
  readonly document: FormDocument;
  readonly published: boolean;
  readonly updatedByMemberId: string | null;
}

/** What deciding whether a member may see a form reads: the objects its draft and its live version file onto. */
export type FormObjects = Pick<FormRow, 'mainObjectId' | 'liveVersionId' | 'liveObjectId'>;

/**
 * Whether a member may see a form (spec 0023: forms on objects they can see): every object its draft and its
 * live version file onto, which differ once a published form's draft points elsewhere (security review,
 * 21 October 2026: the live document names its object and attributes). A version that keeps its submissions
 * only is on no object, so no object rule reaches it: such a form is for members who manage forms, as the
 * submissions it holds are (a submission with no record reads only with `forms.manage`). Fail closed.
 */
export function canSeeForm(access: Access, form: FormObjects): boolean {
  const named = [form.mainObjectId, ...(form.liveVersionId === null ? [] : [form.liveObjectId])];
  if (named.includes(null) && !can(access, 'forms.manage')) return false;
  return named.every((objectId) => objectId === null || objectLevel(access, objectId) !== 'none');
}

/** Parses a stored document. One that no longer parses is a programming error (documents are checked on save). */
export function parseDocument(stored: unknown): FormDocument {
  return FormDocument.parse(stored);
}

/** Versions by id. */
export async function loadVersions(tx: WorkspaceTx, ids: readonly string[]): Promise<ReadonlyMap<string, VersionRow>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      id: formVersions.id,
      number: formVersions.number,
      document: formVersions.document,
      publishedAt: formVersions.publishedAt,
      updatedByMemberId: formVersions.updatedByMemberId,
    })
    .from(formVersions)
    .where(inArray(formVersions.id, [...ids]));
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        number: row.number,
        document: parseDocument(row.document),
        published: row.publishedAt !== null,
        updatedByMemberId: row.updatedByMemberId,
      },
    ]),
  );
}

/** One version of a form by its number, or undefined. */
export async function versionByNumber(
  tx: WorkspaceTx,
  formId: string,
  number: number,
): Promise<VersionRow | undefined> {
  const [row] = await tx
    .select({ id: formVersions.id })
    .from(formVersions)
    .where(and(eq(formVersions.formId, formId), eq(formVersions.number, number)));
  return row === undefined ? undefined : (await loadVersions(tx, [row.id])).get(row.id);
}

/** An object's live, non system attributes a question may be filed on, in their order. */
export function fileable(attributes: ReadonlyMap<string, AttributeDef>): readonly AttributeDef[] {
  return [...attributes.values()]
    .filter((attribute) => !attribute.isSystem && !isArchivedNow(attribute))
    .sort((a, b) => a.position - b.position);
}

/** An object's singular name. */
export async function objectName(tx: WorkspaceTx, objectId: string): Promise<string> {
  const [row] = await tx.select({ name: objects.singularName }).from(objects).where(eq(objects.id, objectId));
  return row?.name ?? 'Record';
}

/**
 * The target's attributes as the publish check sees them: live ones, the reader's write access on each
 * (AC-546), and whether they may see it at all. None for a form that keeps its submissions only.
 *
 * Every live attribute is listed, hidden ones included: a required field nothing fills stops every submission
 * whether or not the publisher may see it, and leaving it out let the form go live and fail at submission time
 * (27 October 2026). The check never names one the publisher can't see (`canSee`).
 */
export async function publishAttributes(
  tx: WorkspaceTx,
  access: Access,
  objectId: string | null,
): Promise<ReadonlyMap<string, PublishAttribute>> {
  if (objectId === null) return new Map();
  const attributes = fileable(await loadAttributes(tx, objectId));
  const name = await objectName(tx, objectId);
  const writesObject = objectLevel(access, objectId) === 'write';
  return new Map(
    attributes.map((attribute) => [
      attribute.id,
      {
        id: attribute.id,
        title: attribute.title,
        type: attribute.type,
        objectName: name,
        canWrite: writesObject && fieldLevel(access, { id: attribute.id, objectId }) === 'write',
        ...(attributeVisible(access, attribute) ? {} : { canSee: false }),
        // A visitor is nobody, so a Current user default fills nothing for them either (`ANONYMOUS`).
        ...(isUnfillableRequired(attribute, ANONYMOUS) ? { isRequired: true } : {}),
      },
    ]),
  );
}

/** The live options of select and status attributes, in their order, by attribute. */
export async function liveOptions(
  tx: WorkspaceTx,
  attributeIds: readonly string[],
): Promise<ReadonlyMap<string, readonly { id: string; label: string; hue?: Hue }[]>> {
  if (attributeIds.length === 0) return new Map();
  const rows = await tx
    .select({
      id: attributeOptions.id,
      attributeId: attributeOptions.attributeId,
      label: attributeOptions.label,
      hue: attributeOptions.hue,
    })
    .from(attributeOptions)
    .where(and(inArray(attributeOptions.attributeId, [...attributeIds]), isNull(attributeOptions.archivedAt)))
    .orderBy(asc(attributeOptions.position), asc(attributeOptions.id));
  const byAttribute = new Map<string, { id: string; label: string; hue?: Hue }[]>();
  for (const row of rows) {
    const list = byAttribute.get(row.attributeId) ?? [];
    const hue = Hue.safeParse(row.hue);
    list.push({ id: row.id, label: row.label, ...(hue.success ? { hue: hue.data } : {}) });
    byAttribute.set(row.attributeId, list);
  }
  return byAttribute;
}

/** What `publicFormOf` reads besides the document. */
export interface PublicFormContext {
  readonly publicKey: string;
  readonly status: 'live' | 'paused';
  readonly versionNumber: number;
  readonly recaptchaSiteKey?: string;
}

/**
 * A question's choices as a visitor sees them, blank ones left out, each
 * with its stable key (the option value a site's own form posts), kept in
 * step: a key is made over every choice first, so leaving out a blank one
 * never moves another's key.
 */
function choicesOf(question: FormDocument['questions'][number]): {
  readonly choices: string[];
  readonly choiceKeys: string[];
} {
  const keys = choiceKeysOf(question);
  const kept = (question.choices ?? []).flatMap((choice, at) =>
    choice.trim() === '' ? [] : [{ choice, key: keys[at] ?? '' }],
  );
  return { choices: kept.map((each) => each.choice), choiceKeys: kept.map((each) => each.key) };
}

/**
 * One question as a visitor's page renders it: what drawing and checking need, never where its answer is filed or
 * how. A form and a booking page (spec 0057) both send theirs through here.
 */
export function publicQuestionOf(question: FormQuestion): PublicQuestion {
  return {
    id: question.id,
    key: question.key,
    label: question.label,
    answerType: question.answerType,
    ...(question.choices === undefined ? {} : choicesOf(question)),
    ...(question.placeholder === undefined || question.placeholder === '' ? {} : { placeholder: question.placeholder }),
    required: question.required,
    ...(question.showWhen === undefined ? {} : { showWhen: question.showWhen }),
  };
}

/**
 * A version's document as the visitor's page renders it: every question with
 * its key, label, type, choices and placeholder, the words and the look; no
 * attribute ids, filing, owner or routing. "Book a quick meeting" stays off
 * until booking pages exist (#59): the seam is `offersMeeting`.
 */
export function publicFormOf(document: FormDocument, context: PublicFormContext): PublicForm {
  return {
    key: context.publicKey,
    status: context.status,
    versionNumber: context.versionNumber,
    headline: document.headline,
    ...(document.subheading === undefined || document.subheading === '' ? {} : { subheading: document.subheading }),
    buttonText: document.buttonText,
    language: document.language,
    look: document.look,
    questions: document.questions.map(publicQuestionOf),
    ...(document.after.kind === 'message' && document.after.message !== '' ? { thanks: document.after.message } : {}),
    offersMeeting: false,
    ...(context.recaptchaSiteKey === undefined ? {} : { recaptchaSiteKey: context.recaptchaSiteKey }),
  };
}
