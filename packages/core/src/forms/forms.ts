// Forms for members (spec 0023, 0023-experience.md): the forms list (any
// member, cards with this month's counts), one form with its draft and live
// documents, and the changes, each needing `forms.manage`: create (an
// untitled form with Name, Email and Phone, AC-649), save the draft quietly,
// publish (the shared `publishProblem` check, AC-546, AC-655), the settings
// that apply at once (name, address, owner, sites), pause and resume,
// archive, point a form's draft at another object or at none (keep its
// submissions only), duplicate and delete. The draft is the one version not yet published; publishing freezes
// it as the next live version (AC-548). Draft saves and publishes move the
// form's `revision`; a save that started from another one is refused
// `FORM_CHANGED`, so nobody's draft is overwritten.
import { randomBytes } from 'node:crypto';
import { and, desc, eq, max, ne, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import {
  defaultQuestions,
  fitsAttribute,
  FORM_COUNT_CAP,
  FORM_SLUG,
  FORMS_LIST_MAX,
  generatedSlug,
  publishProblem,
  type FormDocument,
  type FormQuestion,
  type FormStatus,
  type FormSummary,
  type FormTargetChoices,
  type FormView,
  type PublicForm,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { checkId, isUuidV7 } from '../engine/ids.ts';
import { loadAttributes, type AttributeDef } from '../engine/values.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import { actorRow, type EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { requirePermission } from '../access/check.ts';
import { bookingTargetProblem } from '../booking/pages.ts';
import { can, fieldLevel, objectLevel } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { checkObject, UNKNOWN_OBJECT } from '../access/visibility.ts';
import {
  canSeeForm,
  fileable,
  liveObjectOf,
  loadForm,
  loadVersions,
  millis,
  objectName,
  publicFormOf,
  publishAttributes,
  workspacePublicKey,
  type FormRow,
} from './shared.ts';

const { forms, formSubmissions, formVersions, members, objects } = schema;

/** What a form the reader can't see, or one that doesn't exist, answers. */
export const UNKNOWN_FORM = 'That form does not exist.';

/** What a taken address answers. */
export const SLUG_TAKEN_MESSAGE = 'That address is taken. Try another.';

/** The name a new form starts with. */
export const UNTITLED_FORM = 'Untitled form';

/** A new form address: `form-` and six random letters or digits. */
export function newPublicKey(): string {
  return generatedSlug((bytes) => randomBytes(bytes));
}

/** A new signing secret for a site's own form (256 random bits). */
const newSecret = () => randomBytes(32).toString('base64url');

/** The attribute a form on this object matches its record on: the first unique email, else the first unique one. */
function matchOf(attributes: readonly AttributeDef[]): AttributeDef | undefined {
  return (
    attributes.find((attribute) => attribute.isUnique && attribute.type === 'email') ??
    attributes.find((attribute) => attribute.isUnique)
  );
}

/**
 * A new form's first draft (AC-649): Name, Email and Phone, each filed where the object has a fitting
 * attribute; or, with no object (keep submissions only), the same questions filed nowhere.
 */
function firstDraft(
  target:
    | {
        readonly objectId: string;
        readonly attributes: ReadonlyMap<string, AttributeDef>;
        readonly primaryId: string | null;
      }
    | undefined,
): FormDocument {
  const attributes = target?.attributes ?? new Map<string, AttributeDef>();
  const live = fileable(attributes);
  const match = matchOf(live);
  const primaryId = target?.primaryId ?? null;
  const primary = primaryId === null ? undefined : attributes.get(primaryId);
  const name = primary !== undefined && fitsAttribute('short_text', primary.type) ? primary : undefined;
  const email = match?.type === 'email' ? match : undefined;
  const phone = live.find((attribute) => attribute.type === 'phone');
  return {
    questions: defaultQuestions({
      ...(name === undefined ? {} : { nameAttributeId: name.id }),
      ...(email === undefined ? {} : { emailAttributeId: email.id }),
      ...(phone === undefined ? {} : { phoneAttributeId: phone.id }),
    }),
    targets:
      target === undefined
        ? {}
        : { main: { objectId: target.objectId, ...(match === undefined ? {} : { matchAttributeId: match.id }) } },
    look: { colour: 'light', corners: 'rounded' },
    headline: 'Fill this in and we will come back to you',
    buttonText: 'Send',
    language: 'en',
    after: { kind: 'message', message: '' },
    spam: { minFillMs: 2_000, scoreThreshold: 0.3 },
  };
}

/** A form as members read it, with its draft and live documents. */
async function viewOf(tx: WorkspaceTx, scope: EngineScope, form: FormRow): Promise<FormView> {
  const ids = [form.draftVersionId, form.liveVersionId].filter((id): id is string => id !== null);
  const versions = await loadVersions(tx, ids);
  const draft = form.draftVersionId === null ? undefined : versions.get(form.draftVersionId);
  const live = form.liveVersionId === null ? undefined : versions.get(form.liveVersionId);
  if (draft === undefined) throw new Error('A form always has a draft version.');
  const counts = await countsOf(tx, [form.id]);
  const count = counts.get(form.id);
  const canManage = can(scope.access, 'forms.manage');
  return {
    id: form.id,
    name: form.name,
    status: form.status,
    ...(form.mainObjectId === null ? {} : { mainObjectId: form.mainObjectId }),
    publicKey: form.publicKey,
    ...(live === undefined ? {} : { liveVersionNumber: live.number, live: live.document }),
    submissionsThisMonth: count?.month ?? 0,
    spamCount: count?.spam ?? 0,
    ...(count?.last === undefined || count.last === null ? {} : { lastSubmissionAt: count.last }),
    submissionCount: count?.total ?? 0,
    updatedAt: form.updatedAt,
    createdAt: form.createdAt,
    draftNumber: draft.number,
    revision: form.revision,
    draft: draft.document,
    hasUnpublished: form.draftVersionId !== form.liveVersionId,
    ...(form.ownerMemberId === null ? {} : { ownerMemberId: form.ownerMemberId }),
    ...(draft.updatedByMemberId === null ? {} : { draftSavedByMemberId: draft.updatedByMemberId }),
    allowedOrigins: [...form.allowedOrigins],
    requireSignature: form.requireSignature,
    ...(canManage ? { signingSecret: form.signingSecret } : {}),
    workspaceKey: workspacePublicKey(scope.workspaceId),
    canManage,
  };
}

/** Each form's counts: this month's submissions (spam left out), spam, the last one's time, and every one (capped). */
async function countsOf(
  tx: WorkspaceTx,
  formIds: readonly string[],
): Promise<ReadonlyMap<string, { month: number; spam: number; last: string | null; total: number }>> {
  if (formIds.length === 0) return new Map();
  const rows = await tx.execute<{
    form_id: string;
    month: number;
    spam: number;
    last: string | null;
    total: number;
  }>(sql`
    select f.id::text as form_id,
      (select count(*)::int from (
        select 1 from form_submissions s where s.form_id = f.id and s.state <> 'spam'
          and s.received_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
        limit ${FORM_COUNT_CAP}) c) as month,
      (select count(*)::int from (
        select 1 from form_submissions s where s.form_id = f.id and s.state = 'spam' limit ${FORM_COUNT_CAP}) c) as spam,
      (select to_char(max(s.received_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        from form_submissions s where s.form_id = f.id and s.state <> 'spam') as last,
      (select count(*)::int from (select 1 from form_submissions s where s.form_id = f.id limit ${FORM_COUNT_CAP}) c) as total
    from forms f where f.id = any(${`{${formIds.join(',')}}`}::uuid[])
  `);
  return new Map(rows.rows.map((row) => [row.form_id, row]));
}

/** A form the reader may see (`canSeeForm`: its object visible to them, or none and forms.manage), or NOT_FOUND. */
async function visibleForm(tx: WorkspaceTx, scope: EngineScope, formId: string, lock = false): Promise<FormRow> {
  const id = checkId(formId, UNKNOWN_FORM);
  const form = await loadForm(tx, id, lock);
  if (form === undefined || !canSeeForm(scope.access, form)) {
    throw refuse('NOT_FOUND', UNKNOWN_FORM);
  }
  return form;
}

/** The workspace's forms a member may see, newest first: the active ones, or the archived ones. */
export async function listForms(
  scope: EngineScope,
  input: { readonly archived: boolean },
): Promise<{ items: FormSummary[] }> {
  return inWorkspace(scope, async (tx) => {
    const rows = await tx
      .select({
        id: forms.id,
        name: forms.name,
        status: sql<FormStatus>`${forms.status}`,
        mainObjectId: forms.mainObjectId,
        liveVersionId: forms.liveVersionId,
        liveObjectId: liveObjectOf(),
        publicKey: forms.publicKey,
        liveNumber: sql<
          number | null
        >`(select v.number from ${formVersions} v where v.workspace_id = ${forms.workspaceId} and v.id = ${forms.liveVersionId})`,
        updatedAt: sql<string>`${millis('forms.updated_at')}`,
      })
      .from(forms)
      .where(input.archived ? eq(forms.status, 'archived') : ne(forms.status, 'archived'))
      .orderBy(desc(forms.createdAt), desc(forms.id))
      .limit(FORMS_LIST_MAX);
    const shown = rows.filter((row) => canSeeForm(scope.access, row));
    const counts = await countsOf(
      tx,
      shown.map((row) => row.id),
    );
    const items = shown.map((row): FormSummary => {
      const count = counts.get(row.id);
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        ...(row.mainObjectId === null ? {} : { mainObjectId: row.mainObjectId }),
        publicKey: row.publicKey,
        ...(row.liveNumber === null ? {} : { liveVersionNumber: row.liveNumber }),
        submissionsThisMonth: count?.month ?? 0,
        spamCount: count?.spam ?? 0,
        ...(count?.last === undefined || count.last === null ? {} : { lastSubmissionAt: count.last }),
        submissionCount: count?.total ?? 0,
        updatedAt: row.updatedAt,
      };
    });
    return { items };
  });
}

/** One form, with its draft and live documents (spec 0023: filing and owner too, to any reader). */
export async function getForm(scope: EngineScope, input: { readonly formId: string }): Promise<FormView> {
  return inWorkspace(scope, async (tx) => viewOf(tx, scope, await visibleForm(tx, scope, input.formId)));
}

/** The draft as visitors would see it (AC-657), for the builder's preview: the hosted page's shape, sending nothing. */
export async function previewForm(scope: EngineScope, input: { readonly formId: string }): Promise<PublicForm> {
  return inWorkspace(scope, async (tx) => {
    const form = await visibleForm(tx, scope, input.formId);
    if (form.draftVersionId === null) throw new Error('A form always has a draft version.');
    const draft = (await loadVersions(tx, [form.draftVersionId])).get(form.draftVersionId);
    if (draft === undefined) throw new Error('The draft version went away.');
    return publicFormOf(draft.document, { publicKey: form.publicKey, status: 'live', versionNumber: draft.number });
  });
}

/**
 * The target object and the attributes a question may be filed on, with whether the reader may write each
 * (AC-658); no object and no attributes while the draft keeps its submissions only.
 */
export async function formAttributes(
  scope: EngineScope,
  input: { readonly formId: string },
): Promise<FormTargetChoices> {
  return inWorkspace(scope, async (tx) => {
    const form = await visibleForm(tx, scope, input.formId);
    const objectId = form.mainObjectId;
    if (objectId === null) return { items: [] };
    const attributes = fileable(await loadAttributes(tx, objectId));
    const writesObject = objectLevel(scope.access, objectId) === 'write';
    const items = attributes.flatMap((attribute) => {
      const level = fieldLevel(scope.access, { id: attribute.id, objectId });
      if (level === 'hidden') return [];
      return [
        {
          attributeId: attribute.id,
          title: attribute.title,
          type: attribute.type,
          isRequired: attribute.isRequired,
          isUnique: attribute.isUnique,
          canWrite: writesObject && level === 'write',
        },
      ];
    });
    return { objectId, objectName: await objectName(tx, objectId), items };
  });
}

/** Whether an address is another form's, through the public key lookup (it spans workspaces, ids only). */
async function slugOwner(tx: WorkspaceTx, slug: string): Promise<string | undefined> {
  const found = await tx.execute<{ form_id: string }>(sql`select form_id::text from crm_form_by_key(${slug})`);
  return found.rows[0]?.form_id;
}

/** Whether `slug` is free for this form: well formed, and no other form's anywhere. */
export async function isSlugAvailable(
  scope: EngineScope,
  input: { readonly formId: string; readonly slug: string },
): Promise<{ available: boolean }> {
  const slug = input.slug.trim().toLowerCase();
  if (!FORM_SLUG.test(slug)) return { available: false };
  return inWorkspace(scope, async (tx) => {
    const form = await visibleForm(tx, scope, input.formId);
    const owner = await slugOwner(tx, slug);
    return { available: owner === undefined || owner === form.id };
  });
}

/** Refuses a change that started from another revision of the form (409 `FORM_CHANGED`). */
function checkRevision(form: FormRow, expected: number): void {
  if (form.revision !== expected) {
    throw refuse('FORM_CHANGED', 'Someone else changed this form since you opened it. Load their version.');
  }
}

/** Changes the form row with who and when; `bump` moves its revision too (draft saves and publishes). */
async function touchForm(
  tx: WorkspaceTx,
  scope: EngineScope,
  formId: string,
  set: PgUpdateSetSource<typeof forms>,
  bump: boolean,
) {
  const by = actorRow(scope.actor);
  await tx
    .update(forms)
    .set({
      ...set,
      ...(bump ? { revision: sql`${forms.revision} + 1` } : {}),
      updatedAt: sql`now()`,
      updatedByType: by.type,
      updatedById: by.id,
      updatedByMemberId: by.memberId,
    })
    .where(eq(forms.id, formId));
}

/** Gives the form `slug`, refusing one another form holds (409 `SLUG_TAKEN`, on `slug`). */
async function takeSlug(tx: WorkspaceTx, scope: EngineScope, form: FormRow, slug: string): Promise<void> {
  if (slug === form.publicKey) return;
  const owner = await slugOwner(tx, slug);
  if (owner !== undefined && owner !== form.id) throw refuseOn('SLUG_TAKEN', SLUG_TAKEN_MESSAGE, 'slug');
  try {
    await touchForm(tx, scope, form.id, { publicKey: slug }, false);
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === '23505')
      throw refuseOn('SLUG_TAKEN', SLUG_TAKEN_MESSAGE, 'slug');
    throw error;
  }
}

/** Refuses an owner who isn't an active member. */
async function checkOwner(tx: WorkspaceTx, memberId: string): Promise<void> {
  const [found] = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.status, 'active')));
  if (found === undefined) throw refuseOn('CONFIG_INVALID', 'That member isn’t in this workspace.', 'ownerMemberId');
}

/** The audit columns of a row this scope writes. */
function audit(scope: EngineScope) {
  const by = actorRow(scope.actor);
  return {
    createdByType: by.type,
    createdById: by.id,
    createdByMemberId: by.memberId,
    updatedByType: by.type,
    updatedById: by.id,
    updatedByMemberId: by.memberId,
  };
}

/** Inserts a form and its first draft version, answering the stored row. */
async function insertForm(
  tx: WorkspaceTx,
  scope: EngineScope,
  input: {
    readonly id: string;
    readonly name: string;
    readonly objectId: string | null;
    readonly document: FormDocument;
  },
): Promise<FormRow> {
  await tx.insert(forms).values({
    workspaceId: scope.workspaceId,
    id: input.id,
    name: input.name,
    mainObjectId: input.objectId,
    publicKey: newPublicKey(),
    signingSecret: newSecret(),
    ...(scope.actor.type === 'member' && scope.actor.id !== null ? { ownerMemberId: scope.actor.id } : {}),
    ...audit(scope),
  });
  const [version] = await tx
    .insert(formVersions)
    .values({ workspaceId: scope.workspaceId, formId: input.id, number: 1, document: input.document, ...audit(scope) })
    .returning({ id: formVersions.id });
  if (version === undefined) throw new Error('The first version was not stored.');
  await tx.update(forms).set({ draftVersionId: version.id }).where(eq(forms.id, input.id));
  const form = await loadForm(tx, input.id);
  if (form === undefined) throw new Error('The form was not stored.');
  return form;
}

/** The workspace's People object, else its first live object: where a new form files. */
async function defaultObject(tx: WorkspaceTx): Promise<string> {
  const [row] = await tx
    .select({ id: objects.id })
    .from(objects)
    .where(sql`${objects.archivedAt} is null`)
    .orderBy(sql`(${objects.standardKey} = 'people') desc nulls last`, objects.position)
    .limit(1);
  if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_OBJECT);
  return row.id;
}

/** What creating a form takes: `mainObjectId` absent is People (or the first object), `null` keeps submissions only. */
export interface CreateFormInput {
  readonly id: string;
  readonly name?: string;
  readonly mainObjectId?: string | null;
}

/**
 * Creates a form at once (AC-649): "Untitled form" on People unless named,
 * with Name, Email and Phone, a generated address and the creator as owner;
 * or, with `mainObjectId: null`, a form that keeps its submissions only.
 * The id is the browser's UUID v7 and the retry key: the same call again
 * answers the same form; an id someone else used is 409 `ID_TAKEN`.
 */
export async function createForm(
  scope: EngineScope,
  input: CreateFormInput,
  hooks: readonly AfterWrite[] = [],
): Promise<FormView> {
  requirePermission(scope, 'forms.manage');
  if (!isUuidV7(input.id)) throw refuse('CONFIG_INVALID', 'The form id must be a UUID v7.');
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const existing = await loadForm(tx, input.id);
      if (existing !== undefined) {
        if (existing.createdById === scope.actor.id) return viewOf(tx, scope, existing);
        throw refuse('ID_TAKEN', 'A form with that id already exists.');
      }
      if (input.mainObjectId === null) {
        const kept = await insertForm(tx, scope, {
          id: input.id,
          name: input.name?.trim() ?? UNTITLED_FORM,
          objectId: null,
          document: firstDraft(undefined),
        });
        return viewOf(tx, scope, kept);
      }
      const objectId =
        input.mainObjectId === undefined ? await defaultObject(tx) : checkId(input.mainObjectId, UNKNOWN_OBJECT);
      const object = await writableObject(tx, scope, objectId);
      const attributes = await loadAttributes(tx, objectId);
      const form = await insertForm(tx, scope, {
        id: input.id,
        name: input.name?.trim() ?? UNTITLED_FORM,
        objectId,
        document: firstDraft({ objectId, attributes, primaryId: object.primaryAttributeId }),
      });
      return viewOf(tx, scope, form);
    },
    hooks,
  );
  return result;
}

/** The refusal on `after` when the booking page a draft points at can't be used (AC-1056). */
async function checkBookingTarget(
  tx: WorkspaceTx,
  scope: EngineScope,
  document: FormDocument,
  check: 'seen' | 'live',
): Promise<void> {
  const { after } = document;
  if (after.kind !== 'booking') return;
  const problem = await bookingTargetProblem(tx, scope, after.bookingPageId, check);
  if (problem === undefined) return;
  throw refuseOn(
    'CONFIG_INVALID',
    check === 'seen'
      ? 'Pick a booking page you can see that is taking bookings.'
      : 'The booking page this form sends visitors to is paused or gone. Pick another, or thank them instead.',
    'after',
  );
}

/** The booking page a document sends visitors to, if any. */
function bookingPageOf(document: FormDocument | undefined): string | undefined {
  return document?.after.kind === 'booking' ? document.after.bookingPageId : undefined;
}

/** Refuses a document filed onto another object than the form's draft is set to (setFormTarget changes it). */
function checkDraft(form: FormRow, document: FormDocument): void {
  if ((document.targets.main?.objectId ?? null) !== form.mainObjectId) {
    throw refuse('CONFIG_INVALID', 'A form’s answers go to one object. Change it in Settings, where answers go.');
  }
}

/** Saves `document` as the draft, starting the next version when the draft is the live one. */
async function writeDraft(tx: WorkspaceTx, scope: EngineScope, form: FormRow, document: FormDocument): Promise<void> {
  const by = actorRow(scope.actor);
  let draftVersionId = form.draftVersionId;
  if (draftVersionId === null || draftVersionId === form.liveVersionId) {
    const [top] = await tx
      .select({ number: max(formVersions.number) })
      .from(formVersions)
      .where(eq(formVersions.formId, form.id));
    const [version] = await tx
      .insert(formVersions)
      .values({
        workspaceId: scope.workspaceId,
        formId: form.id,
        number: (top?.number ?? 0) + 1,
        document,
        ...audit(scope),
      })
      .returning({ id: formVersions.id });
    draftVersionId = version?.id ?? null;
  } else {
    await tx
      .update(formVersions)
      .set({
        document,
        updatedAt: sql`now()`,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .where(eq(formVersions.id, draftVersionId));
  }
  await touchForm(tx, scope, form.id, { draftVersionId }, true);
}

/** What saving a draft takes. */
export interface SaveDraftInput {
  readonly formId: string;
  readonly document: FormDocument;
  readonly expectedRevision: number;
}

/** Saves the draft (AC-548), quietly: edits stay out of the live form until Publish. */
export async function saveFormDraft(
  scope: EngineScope,
  input: SaveDraftInput,
  hooks: readonly AfterWrite[] = [],
): Promise<FormView> {
  requirePermission(scope, 'forms.manage');
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const form = await visibleForm(tx, scope, input.formId, true);
      if (form.status === 'archived') throw refuse('FORM_STATE', 'Restore this form before you change it.');
      checkRevision(form, input.expectedRevision);
      checkDraft(form, input.document);
      // A newly chosen booking page goes through the access door; one already chosen stays, so others can still edit.
      const chosen = bookingPageOf(input.document);
      if (chosen !== undefined && form.draftVersionId !== null) {
        const before = (await loadVersions(tx, [form.draftVersionId])).get(form.draftVersionId);
        if (bookingPageOf(before?.document) !== chosen) await checkBookingTarget(tx, scope, input.document, 'seen');
      } else if (chosen !== undefined) await checkBookingTarget(tx, scope, input.document, 'seen');
      await writeDraft(tx, scope, form, input.document);
      const saved = await loadForm(tx, form.id);
      if (saved === undefined) throw new Error('The form went away under its save.');
      return viewOf(tx, scope, saved);
    },
    hooks,
  );
  return result;
}

/** What publishing takes: the revision it started from, and on the first publish the name and address. */
export interface PublishInput {
  readonly formId: string;
  readonly expectedRevision: number;
  readonly name?: string;
  readonly slug?: string;
}

/**
 * Publishes the draft as the next live version (AC-548), after the shared
 * publish check (`publishProblem`, AC-546, AC-655), whose first problem is
 * the refusal, on the question at fault (`field` is its id). A draft form
 * goes live; a paused one stays paused; publishing a draft already live
 * changes nothing.
 */
export async function publishForm(
  scope: EngineScope,
  input: PublishInput,
  hooks: readonly AfterWrite[] = [],
): Promise<FormView> {
  requirePermission(scope, 'forms.manage');
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      let form = await visibleForm(tx, scope, input.formId, true);
      if (form.status === 'archived') throw refuse('FORM_STATE', 'Restore this form before you publish it.');
      checkRevision(form, input.expectedRevision);
      if (input.slug !== undefined) await takeSlug(tx, scope, form, input.slug.trim().toLowerCase());
      if (input.name !== undefined) await touchForm(tx, scope, form.id, { name: input.name.trim() }, false);
      form = (await loadForm(tx, form.id, true)) ?? form;
      if (form.draftVersionId === null) throw new Error('A form always has a draft version.');
      if (form.draftVersionId === form.liveVersionId) return viewOf(tx, scope, form);
      const draft = (await loadVersions(tx, [form.draftVersionId])).get(form.draftVersionId);
      if (draft === undefined) throw new Error('The draft version went away.');
      checkDraft(form, draft.document);
      await checkBookingTarget(tx, scope, draft.document, 'live');
      const problem = publishProblem({
        name: form.name,
        slug: form.publicKey,
        document: draft.document,
        attributes: await publishAttributes(tx, scope.access, form.mainObjectId),
      });
      if (problem !== undefined) {
        const code = problem.code === 'FILING_FORBIDDEN' ? 'FORBIDDEN' : 'CONFIG_INVALID';
        throw refuseOn(
          code,
          problem.message,
          problem.questionId ?? (problem.code === 'ADDRESS_INVALID' ? 'slug' : 'name'),
        );
      }
      const by = actorRow(scope.actor);
      await tx
        .update(formVersions)
        .set({
          publishedAt: sql`now()`,
          publishedByType: by.type,
          publishedById: by.id,
          publishedByMemberId: by.memberId,
        })
        .where(eq(formVersions.id, form.draftVersionId));
      await touchForm(
        tx,
        scope,
        form.id,
        { liveVersionId: form.draftVersionId, status: form.status === 'draft' ? 'live' : form.status },
        true,
      );
      const published = await loadForm(tx, form.id);
      if (published === undefined) throw new Error('The form went away under its publish.');
      return viewOf(tx, scope, published);
    },
    hooks,
  );
  return result;
}

/** The settings that apply at once. */
export interface FormSettingsInput {
  readonly formId: string;
  readonly name?: string;
  readonly slug?: string;
  readonly ownerMemberId?: string | null;
  readonly allowedOrigins?: readonly string[];
  readonly requireSignature?: boolean;
}

/**
 * Changes what applies at once (0023-experience.md, Settings): the name, the
 * address (the old link stops working, AC-552), the owner of new records
 * (AC-567), and the sites that may post their own form and whether their
 * posts must be signed. The draft's revision stays, so an open editor's
 * quiet save still lands.
 */
export async function updateFormSettings(
  scope: EngineScope,
  input: FormSettingsInput,
  hooks: readonly AfterWrite[] = [],
): Promise<FormView> {
  requirePermission(scope, 'forms.manage');
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const form = await visibleForm(tx, scope, input.formId, true);
      if (input.slug !== undefined) await takeSlug(tx, scope, form, input.slug.trim().toLowerCase());
      if (input.ownerMemberId !== undefined && input.ownerMemberId !== null) await checkOwner(tx, input.ownerMemberId);
      const set: PgUpdateSetSource<typeof forms> = {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.ownerMemberId === undefined ? {} : { ownerMemberId: input.ownerMemberId }),
        ...(input.allowedOrigins === undefined ? {} : { allowedOrigins: [...new Set(input.allowedOrigins)] }),
        ...(input.requireSignature === undefined ? {} : { requireSignature: input.requireSignature }),
      };
      if (Object.keys(set).length > 0) await touchForm(tx, scope, form.id, set, false);
      const changed = await loadForm(tx, form.id);
      if (changed === undefined) throw new Error('The form went away under its change.');
      return viewOf(tx, scope, changed);
    },
    hooks,
  );
  return result;
}

/**
 * Gives a form a new signing secret (`forms.manage`; Install, Your own HTML):
 * the old one stops working at once, so a site's server signing with it is
 * refused from the next post. Answers the form with the new secret.
 */
export async function rotateFormSecret(
  scope: EngineScope,
  input: { readonly formId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<FormView> {
  requirePermission(scope, 'forms.manage');
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const form = await visibleForm(tx, scope, input.formId, true);
      await touchForm(tx, scope, form.id, { signingSecret: newSecret() }, false);
      const changed = await loadForm(tx, form.id);
      if (changed === undefined) throw new Error('The form went away under its change.');
      return viewOf(tx, scope, changed);
    },
    hooks,
  );
  return result;
}

/** The moves a form may make (spec 0023, state transitions). */
function nextStatus(form: FormRow, wanted: FormStatus): FormStatus | undefined {
  const { status } = form;
  if (wanted === status) return status;
  if (wanted === 'archived') return status === 'archived' ? undefined : 'archived';
  if (status === 'live' && wanted === 'paused') return 'paused';
  if (status === 'paused' && wanted === 'live') return 'live';
  // Restoring an archived form: to paused, or to draft when it never went live.
  if (status === 'archived') {
    return form.liveVersionId === null ? 'draft' : 'paused';
  }
  return undefined;
}

/** Pauses and resumes a form (Accepting), archives and restores it (AC-549); anything else is 409 `FORM_STATE`. */
export async function setFormStatus(
  scope: EngineScope,
  input: { readonly formId: string; readonly status: FormStatus },
  hooks: readonly AfterWrite[] = [],
): Promise<FormView> {
  requirePermission(scope, 'forms.manage');
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const form = await visibleForm(tx, scope, input.formId, true);
      const next = nextStatus(form, input.status);
      if (next === undefined) {
        throw refuse(
          'FORM_STATE',
          input.status === 'live' && form.status === 'draft'
            ? 'Publish the form to make it live.'
            : 'A form can’t move there from where it is.',
        );
      }
      if (next === form.status) return viewOf(tx, scope, form);
      await touchForm(tx, scope, form.id, { status: next, archivedAt: next === 'archived' ? sql`now()` : null }, false);
      const moved = await loadForm(tx, form.id);
      if (moved === undefined) throw new Error('The form went away under its change.');
      return viewOf(tx, scope, moved);
    },
    hooks,
  );
  return result;
}

/** An object a member may file a form's submissions onto: live, and one they may write. */
async function writableObject(tx: WorkspaceTx, scope: EngineScope, objectId: string) {
  await checkObject(tx, scope.access, objectId, 'write');
  const [object] = await tx
    .select({ archivedAt: objects.archivedAt, primaryAttributeId: objects.primaryAttributeId })
    .from(objects)
    .where(eq(objects.id, objectId));
  if (object === undefined || object.archivedAt !== null) throw refuse('NOT_FOUND', UNKNOWN_OBJECT);
  return object;
}

/**
 * Files the questions a new form starts with onto a newly chosen object, as a
 * new form's first draft does (AC-649): the email question on the object's
 * match (a unique email), the name question on its primary attribute, the
 * phone on its first phone attribute. Only unfiled questions, onto attributes
 * no other question holds, so a connected form can go live as it is.
 */
function fileDefaults(
  questions: readonly FormQuestion[],
  attributes: ReadonlyMap<string, AttributeDef>,
  primaryId: string | null,
): FormQuestion[] {
  const live = fileable(attributes);
  const match = matchOf(live);
  const primary = primaryId === null ? undefined : attributes.get(primaryId);
  const used = new Set(questions.flatMap((question) => question.filedOn?.attributeId ?? []));
  const take = (attribute: AttributeDef | undefined) => {
    if (attribute === undefined || used.has(attribute.id)) return undefined;
    used.add(attribute.id);
    return { objectRole: 'main' as const, attributeId: attribute.id };
  };
  const firstEmail = questions.find((question) => question.answerType === 'email' && question.filedOn === undefined);
  return questions.map((question) => {
    if (question.filedOn !== undefined) return question;
    const filedOn =
      question === firstEmail && match?.type === 'email'
        ? take(match)
        : question.key === 'name' && primary !== undefined && fitsAttribute(question.answerType, primary.type)
          ? take(primary)
          : question.answerType === 'phone'
            ? take(live.find((attribute) => attribute.type === 'phone'))
            : undefined;
    return filedOn === undefined ? question : { ...question, filedOn };
  });
}

/** A question filed nowhere: kept with the submission only. */
function unfiled(question: FormQuestion): FormQuestion {
  const { filedOn, ...rest } = question;
  return filedOn === undefined ? question : rest;
}

/**
 * Points a form's draft at another object, or at none (the first publish's
 * "Where the answers go", and Settings' "Add each submission to the CRM"):
 * its questions keep their filing where the new object has that attribute (a
 * new object built from the form), the rest go unfiled, and it matches on the
 * object's own unique email (or first unique). `null` keeps the submissions
 * only, every filing cleared. On a published form the change is the draft's
 * and goes live with the next publish; each version files its submissions
 * with its own target, so nothing already sent moves.
 */
export async function setFormTarget(
  scope: EngineScope,
  input: { readonly formId: string; readonly mainObjectId: string | null; readonly expectedRevision: number },
  hooks: readonly AfterWrite[] = [],
): Promise<FormView> {
  requirePermission(scope, 'forms.manage');
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const form = await visibleForm(tx, scope, input.formId, true);
      if (form.status === 'archived') throw refuse('FORM_STATE', 'Restore this form before you change it.');
      checkRevision(form, input.expectedRevision);
      const objectId = input.mainObjectId === null ? null : checkId(input.mainObjectId, UNKNOWN_OBJECT);
      if (objectId === form.mainObjectId) return viewOf(tx, scope, form);
      if (form.draftVersionId === null) throw new Error('A form always has a draft version.');
      const draft = (await loadVersions(tx, [form.draftVersionId])).get(form.draftVersionId);
      if (draft === undefined) throw new Error('The draft version went away.');
      let document: FormDocument;
      if (objectId === null) {
        document = { ...draft.document, questions: draft.document.questions.map(unfiled), targets: {} };
      } else {
        const object = await writableObject(tx, scope, objectId);
        const attributes = await loadAttributes(tx, objectId);
        const match = matchOf(fileable(attributes));
        const kept = draft.document.questions.map((question) =>
          question.filedOn !== undefined && attributes.has(question.filedOn.attributeId) ? question : unfiled(question),
        );
        document = {
          ...draft.document,
          questions: fileDefaults(kept, attributes, object.primaryAttributeId),
          targets: { main: { objectId, ...(match === undefined ? {} : { matchAttributeId: match.id }) } },
        };
      }
      await tx.update(forms).set({ mainObjectId: objectId }).where(eq(forms.id, form.id));
      await writeDraft(tx, scope, { ...form, mainObjectId: objectId }, document);
      const moved = await loadForm(tx, form.id);
      if (moved === undefined) throw new Error('The form went away under its change.');
      return viewOf(tx, scope, moved);
    },
    hooks,
  );
  return result;
}

/**
 * Copies a form's draft as a new, never published form with its own address,
 * named "<name> copy". A booking page the draft sends visitors to comes along
 * as chosen (AC-1056 checks a page when it is chosen), and publishing the copy
 * still refuses one that is paused or gone.
 */
export async function duplicateForm(
  scope: EngineScope,
  input: { readonly formId: string; readonly id: string },
  hooks: readonly AfterWrite[] = [],
): Promise<FormView> {
  requirePermission(scope, 'forms.manage');
  if (!isUuidV7(input.id)) throw refuse('CONFIG_INVALID', 'The form id must be a UUID v7.');
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const existing = await loadForm(tx, input.id);
      if (existing !== undefined) {
        if (existing.createdById === scope.actor.id) return viewOf(tx, scope, existing);
        throw refuse('ID_TAKEN', 'A form with that id already exists.');
      }
      const form = await visibleForm(tx, scope, input.formId);
      if (form.draftVersionId === null) throw new Error('A form always has a draft version.');
      const draft = (await loadVersions(tx, [form.draftVersionId])).get(form.draftVersionId);
      if (draft === undefined) throw new Error('The draft version went away.');
      const copy = await insertForm(tx, scope, {
        id: input.id,
        name: `${form.name} copy`.slice(0, 80),
        objectId: form.mainObjectId,
        document: draft.document,
      });
      return viewOf(tx, scope, copy);
    },
    hooks,
  );
  return result;
}

/** Deletes a form with its versions and submissions; the records its submissions made stay (spec 0023, the forms list). */
export async function deleteForm(
  scope: EngineScope,
  input: { readonly formId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly deleted: true }> {
  requirePermission(scope, 'forms.manage');
  await runWrite(
    scope,
    async ({ tx }) => {
      const form = await visibleForm(tx, scope, input.formId, true);
      await tx.delete(formSubmissions).where(eq(formSubmissions.formId, form.id));
      await tx.delete(forms).where(eq(forms.id, form.id));
    },
    hooks,
  );
  return { deleted: true };
}
