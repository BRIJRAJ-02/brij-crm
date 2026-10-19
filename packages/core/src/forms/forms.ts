// Forms for members (spec 0023, milestone 1): listing and reading forms (any
// member), and creating, saving, publishing, pausing, archiving and rotating
// the key of one (`forms.manage`). A form is a row plus numbered versions;
// the draft is the version being edited, and publishing freezes it as the
// live one (AC-548). Every change moves the form's `revision`, and a save or
// publish names the revision it started from, so a stale editor is refused
// `FORM_CHANGED` rather than overwriting someone else's draft.
import { randomBytes } from 'node:crypto';
import { and, desc, eq, max, ne, sql } from 'drizzle-orm';
import {
  FORM_COUNT_CAP,
  FORMS_LIST_MAX,
  isFormQuestionType,
  questionsOf,
  type EngineRefusal,
  type FormAttributeChoice,
  type FormDocument,
  type FormStatus,
  type FormSummary,
  type FormView,
} from '@crm/contracts';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { schema, type WorkspaceTx } from '@crm/db';
import { checkId, isUuidV7 } from '../engine/ids.ts';
import { isArchivedNow, loadAttributes, type AttributeDef } from '../engine/values.ts';
import { refuse, refuseAll } from '../engine/refusals.ts';
import { actorRow, type EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { requirePermission } from '../access/check.ts';
import { can, fieldLevel, objectLevel } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { checkObject, UNKNOWN_OBJECT } from '../access/visibility.ts';
import { loadForm, loadVersions, millis, type FormRow } from './shared.ts';

const { forms, formSubmissions, formVersions, members, objects } = schema;

/** What a form the reader can't see, or one that doesn't exist, answers. */
export const UNKNOWN_FORM = 'That form does not exist.';

/** The types a form can match its main record on: a unique attribute's, with a public editor. */
const MATCH_TYPES: readonly string[] = ['email', 'domain', 'text', 'url', 'number'];

/** A new public key: 24 URL safe characters (144 random bits). */
export function newPublicKey(): string {
  return randomBytes(18).toString('base64url');
}

/** The main object's attributes a question may map to: live, not the system's, with a public editor. */
function mappable(attributes: ReadonlyMap<string, AttributeDef>): readonly AttributeDef[] {
  return [...attributes.values()]
    .filter((attribute) => !attribute.isSystem && !isArchivedNow(attribute) && isFormQuestionType(attribute.type))
    .sort((a, b) => a.position - b.position);
}

/** The attribute a form on this object matches on by default: its first unique attribute of a matchable type. */
function defaultMatch(attributes: ReadonlyMap<string, AttributeDef>): AttributeDef | undefined {
  return mappable(attributes).find((attribute) => attribute.isUnique && MATCH_TYPES.includes(attribute.type));
}

/**
 * A new form's first draft: its object's name attribute and its match
 * attribute as required questions, a thank you message, and no owner.
 */
function firstDraft(
  name: string,
  objectId: string,
  attributes: ReadonlyMap<string, AttributeDef>,
  primaryAttributeId: string | null,
): FormDocument {
  const match = defaultMatch(attributes);
  if (match === undefined) {
    throw refuse(
      'CONFIG_INVALID',
      'This object has no unique attribute a form can match submissions on. Add one first.',
    );
  }
  const primary = primaryAttributeId === null ? undefined : attributes.get(primaryAttributeId);
  const questions = [
    ...(primary !== undefined && primary.id !== match.id && isFormQuestionType(primary.type) ? [primary] : []),
    match,
  ];
  return {
    steps: [
      {
        id: 'main',
        blocks: questions.map((attribute, index) => ({
          kind: 'question' as const,
          id: attribute.type === 'email' ? 'email' : attribute.id === primary?.id ? 'name' : `q${String(index + 1)}`,
          label: attribute.type === 'email' ? 'Email' : attribute.title,
          required: true,
          target: { role: 'main' as const, attributeId: attribute.id },
          update: 'fill' as const,
        })),
      },
    ],
    targets: { main: { objectId, matchAttributeId: match.id } },
    owner: { kind: 'none' },
    after: { kind: 'message', text: 'Thanks, we got your message.' },
    style: { title: name, buttonText: 'Submit', language: 'en' },
    spam: { minFillMs: 2_500, scoreThreshold: 0.3 },
  };
}

/** Submissions counted up to the cap, per form. */
const COUNT = sql<number>`(select count(*)::int from (
  select 1 from ${formSubmissions} s where s.workspace_id = ${forms.workspaceId} and s.form_id = ${forms.id} limit ${FORM_COUNT_CAP}
) c)`;

/** The live version's number, when there is one. */
const LIVE_NUMBER = sql<number | null>`(select v.number from ${formVersions} v
  where v.workspace_id = ${forms.workspaceId} and v.id = ${forms.liveVersionId})`;

/** A form as members read it, with its draft and live documents. */
async function viewOf(tx: WorkspaceTx, scope: EngineScope, form: FormRow): Promise<FormView> {
  const ids = [form.draftVersionId, form.liveVersionId].filter((id): id is string => id !== null);
  const versions = await loadVersions(tx, ids);
  const draft = form.draftVersionId === null ? undefined : versions.get(form.draftVersionId);
  const live = form.liveVersionId === null ? undefined : versions.get(form.liveVersionId);
  if (draft === undefined) throw new Error('A form always has a draft version.');
  const [counted] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(sql`(select 1 from ${formSubmissions} s where s.form_id = ${form.id} limit ${FORM_COUNT_CAP}) c`);
  return {
    id: form.id,
    name: form.name,
    status: form.status,
    mainObjectId: form.mainObjectId,
    publicKey: form.publicKey,
    ...(live === undefined ? {} : { liveVersionNumber: live.number, live: live.document }),
    submissionCount: counted?.n ?? 0,
    updatedAt: form.updatedAt,
    createdAt: form.createdAt,
    draftNumber: draft.number,
    revision: form.revision,
    draft: draft.document,
    hasUnpublished: form.draftVersionId !== form.liveVersionId,
    canManage: can(scope.access, 'forms.manage'),
  };
}

/** A form the reader may see (its main object visible to them), or NOT_FOUND. */
async function visibleForm(tx: WorkspaceTx, scope: EngineScope, formId: string, lock = false): Promise<FormRow> {
  const id = checkId(formId, UNKNOWN_FORM);
  const form = await loadForm(tx, id, lock);
  if (form === undefined || objectLevel(scope.access, form.mainObjectId) === 'none') {
    throw refuse('NOT_FOUND', UNKNOWN_FORM);
  }
  return form;
}

/** The forms of the workspace a member may see, newest first: the active ones, or the archived ones. */
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
        publicKey: forms.publicKey,
        liveVersionNumber: LIVE_NUMBER,
        submissionCount: COUNT,
        updatedAt: sql<string>`${millis('forms.updated_at')}`,
      })
      .from(forms)
      .where(input.archived ? eq(forms.status, 'archived') : ne(forms.status, 'archived'))
      .orderBy(desc(forms.createdAt), desc(forms.id))
      .limit(FORMS_LIST_MAX);
    const items = rows
      .filter((row) => objectLevel(scope.access, row.mainObjectId) !== 'none')
      .map((row): FormSummary => ({
        id: row.id,
        name: row.name,
        status: row.status,
        mainObjectId: row.mainObjectId,
        publicKey: row.publicKey,
        ...(row.liveVersionNumber === null ? {} : { liveVersionNumber: row.liveVersionNumber }),
        submissionCount: row.submissionCount,
        updatedAt: row.updatedAt,
      }));
    return { items };
  });
}

/** One form, with its draft and live documents (spec 0023: mappings and owner rules too, to any reader). */
export async function getForm(scope: EngineScope, input: { readonly formId: string }): Promise<FormView> {
  return inWorkspace(scope, async (tx) => viewOf(tx, scope, await visibleForm(tx, scope, input.formId)));
}

/** The attributes a question of this form may map to, with whether the reader may write each (AC-546). */
export async function formAttributes(
  scope: EngineScope,
  input: { readonly formId: string },
): Promise<{ items: FormAttributeChoice[] }> {
  return inWorkspace(scope, async (tx) => {
    const form = await visibleForm(tx, scope, input.formId);
    const attributes = await loadAttributes(tx, form.mainObjectId);
    const items = mappable(attributes).flatMap((attribute): FormAttributeChoice[] => {
      const level = fieldLevel(scope.access, { id: attribute.id, objectId: form.mainObjectId });
      if (level === 'hidden' || !isFormQuestionType(attribute.type)) return [];
      return [
        {
          attributeId: attribute.id,
          title: attribute.title,
          type: attribute.type,
          isRequired: attribute.isRequired,
          isUnique: attribute.isUnique,
          canWrite: level === 'write' && objectLevel(scope.access, form.mainObjectId) === 'write',
        },
      ];
    });
    return { items };
  });
}

/** Refuses a document that doesn't belong to the form: another object, or two blocks with one id. */
function checkDraft(form: FormRow, document: FormDocument): void {
  if (document.targets.main.objectId !== form.mainObjectId) {
    throw refuse('CONFIG_INVALID', 'A form’s main record stays on the object it was made for.');
  }
  const ids = document.steps.flatMap((step) => [step.id, ...step.blocks.map((block) => block.id)]);
  if (new Set(ids).size !== ids.length) throw refuse('CONFIG_INVALID', 'Give each block of the form its own id.');
}

/**
 * Everything publishing checks (spec 0023, AC-546): the draft's own shape;
 * the match attribute unique, with a public editor and asked by a required
 * question; each mapped attribute live, with a public editor, asked once, and
 * writable by the publisher (403 naming it otherwise); and a fixed owner who
 * is an active member.
 */
async function checkPublishable(tx: WorkspaceTx, scope: EngineScope, form: FormRow, document: FormDocument) {
  checkDraft(form, document);
  const attributes = await loadAttributes(tx, form.mainObjectId);
  const problems: EngineRefusal[] = [];
  const questions = questionsOf(document);
  const mappedIds = new Set<string>();
  for (const question of questions) {
    if (!('attributeId' in question.target)) continue;
    const attribute = attributes.get(question.target.attributeId);
    if (
      attribute === undefined ||
      attribute.isSystem ||
      isArchivedNow(attribute) ||
      !isFormQuestionType(attribute.type)
    ) {
      problems.push({
        code: 'CONFIG_INVALID',
        message: `“${question.label}” maps to a field a form can’t write. Pick another, or make it a form only question.`,
      });
      continue;
    }
    if (mappedIds.has(attribute.id)) {
      problems.push({
        code: 'CONFIG_INVALID',
        message: `${attribute.title} is asked twice. Keep one question for it.`,
        attributeId: attribute.id,
      });
      continue;
    }
    mappedIds.add(attribute.id);
    const writable =
      objectLevel(scope.access, form.mainObjectId) === 'write' &&
      fieldLevel(scope.access, { id: attribute.id, objectId: form.mainObjectId }) === 'write';
    if (!writable) {
      problems.push({
        code: 'FORBIDDEN',
        message: `You can’t change ${attribute.title}, so this form can’t write it. Remove the question or ask an admin.`,
        attributeId: attribute.id,
      });
    }
  }
  const match = attributes.get(document.targets.main.matchAttributeId);
  if (match === undefined || isArchivedNow(match) || !match.isUnique || !MATCH_TYPES.includes(match.type)) {
    problems.push({ code: 'CONFIG_INVALID', message: 'Pick a unique field to match submissions on.' });
  } else if (
    !questions.some(
      (question) => question.required && 'attributeId' in question.target && question.target.attributeId === match.id,
    )
  ) {
    problems.push({
      code: 'CONFIG_INVALID',
      message: `Ask for ${match.title} with a required question: submissions are matched on it.`,
      attributeId: match.id,
    });
  }
  if (document.owner.kind === 'member') {
    const [owner] = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, document.owner.memberId), eq(members.status, 'active')));
    if (owner === undefined) {
      problems.push({ code: 'CONFIG_INVALID', message: 'The owner you picked isn’t a member any more. Pick another.' });
    }
  }
  const [first, ...rest] = problems;
  if (first !== undefined) throw refuseAll([first, ...rest]);
}

/** Refuses a change that started from another revision of the form (409 `FORM_CHANGED`). */
function checkRevision(form: FormRow, expected: number): void {
  if (form.revision !== expected) {
    throw refuse('FORM_CHANGED', 'Someone else changed this form since you opened it. Reload it to see their change.');
  }
}

/** Moves a form's revision on, with who and when. */
async function touchForm(
  tx: WorkspaceTx,
  scope: EngineScope,
  formId: string,
  set: PgUpdateSetSource<typeof forms> = {},
) {
  const by = actorRow(scope.actor);
  await tx
    .update(forms)
    .set({
      ...set,
      revision: sql`${forms.revision} + 1`,
      updatedAt: sql`now()`,
      updatedByType: by.type,
      updatedById: by.id,
      updatedByMemberId: by.memberId,
    })
    .where(eq(forms.id, formId));
}

/** What creating a form takes. */
export interface CreateFormInput {
  readonly id: string;
  readonly name: string;
  readonly mainObjectId: string;
}

/**
 * Creates a form on an object (AC-545), as a draft with a first version
 * asking for the object's name and its match attribute. The id is the
 * browser's UUID v7 and the retry key: the same call again answers the same
 * form; an id someone else used is 409 `ID_TAKEN`.
 */
export async function createForm(
  scope: EngineScope,
  input: CreateFormInput,
  hooks: readonly AfterWrite[] = [],
): Promise<FormView> {
  requirePermission(scope, 'forms.manage');
  if (!isUuidV7(input.id)) throw refuse('CONFIG_INVALID', 'The form id must be a UUID v7.');
  const objectId = checkId(input.mainObjectId, UNKNOWN_OBJECT);
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const existing = await loadForm(tx, input.id);
      if (existing !== undefined) {
        if (existing.createdById === scope.actor.id && existing.mainObjectId === objectId) {
          return viewOf(tx, scope, existing);
        }
        throw refuse('ID_TAKEN', 'A form with that id already exists.');
      }
      await checkObject(tx, scope.access, objectId, 'write');
      const [object] = await tx
        .select({ archivedAt: objects.archivedAt, primaryAttributeId: objects.primaryAttributeId })
        .from(objects)
        .where(eq(objects.id, objectId));
      if (object === undefined || object.archivedAt !== null) throw refuse('NOT_FOUND', UNKNOWN_OBJECT);
      const attributes = await loadAttributes(tx, objectId);
      const document = firstDraft(input.name.trim(), objectId, attributes, object.primaryAttributeId);
      const by = actorRow(scope.actor);
      const audit = {
        createdByType: by.type,
        createdById: by.id,
        createdByMemberId: by.memberId,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      };
      await tx.insert(forms).values({
        workspaceId: scope.workspaceId,
        id: input.id,
        name: input.name.trim(),
        mainObjectId: objectId,
        publicKey: newPublicKey(),
        ...audit,
      });
      const [version] = await tx
        .insert(formVersions)
        .values({ workspaceId: scope.workspaceId, formId: input.id, number: 1, document, ...audit })
        .returning({ id: formVersions.id });
      if (version === undefined) throw new Error('The first version was not stored.');
      await tx.update(forms).set({ draftVersionId: version.id }).where(eq(forms.id, input.id));
      const form = await loadForm(tx, input.id);
      if (form === undefined) throw new Error('The form was not stored.');
      return viewOf(tx, scope, form);
    },
    hooks,
  );
  return result;
}

/** What saving a draft takes. */
export interface SaveDraftInput {
  readonly formId: string;
  readonly name?: string;
  readonly document: FormDocument;
  readonly expectedRevision: number;
}

/**
 * Saves the draft (AC-548): edits stay out of the live form until a publish.
 * When the draft was just published, the save starts the next version.
 */
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
      const by = actorRow(scope.actor);
      const stamp = {
        updatedAt: sql`now()`,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      };
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
            document: input.document,
            createdByType: by.type,
            createdById: by.id,
            createdByMemberId: by.memberId,
            updatedByType: by.type,
            updatedById: by.id,
            updatedByMemberId: by.memberId,
          })
          .returning({ id: formVersions.id });
        draftVersionId = version?.id ?? null;
      } else {
        await tx
          .update(formVersions)
          .set({ document: input.document, ...stamp })
          .where(eq(formVersions.id, draftVersionId));
      }
      await touchForm(tx, scope, form.id, {
        draftVersionId,
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
      });
      const saved = await loadForm(tx, form.id);
      if (saved === undefined) throw new Error('The form went away under its save.');
      return viewOf(tx, scope, saved);
    },
    hooks,
  );
  return result;
}

/**
 * Publishes the draft as the live version (AC-548), after every publish
 * check (AC-546). A draft form goes live; a paused one stays paused with the
 * new version ready; a live one stays live. Publishing a draft already live
 * changes nothing.
 */
export async function publishForm(
  scope: EngineScope,
  input: { readonly formId: string; readonly expectedRevision: number },
  hooks: readonly AfterWrite[] = [],
): Promise<FormView> {
  requirePermission(scope, 'forms.manage');
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const form = await visibleForm(tx, scope, input.formId, true);
      if (form.status === 'archived') throw refuse('FORM_STATE', 'Restore this form before you publish it.');
      checkRevision(form, input.expectedRevision);
      if (form.draftVersionId === null) throw new Error('A form always has a draft version.');
      if (form.draftVersionId === form.liveVersionId) return viewOf(tx, scope, form);
      const draft = (await loadVersions(tx, [form.draftVersionId])).get(form.draftVersionId);
      if (draft === undefined) throw new Error('The draft version went away.');
      await checkPublishable(tx, scope, form, draft.document);
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
      await touchForm(tx, scope, form.id, {
        liveVersionId: form.draftVersionId,
        status: form.status === 'draft' ? 'live' : form.status,
      });
      const published = await loadForm(tx, form.id);
      if (published === undefined) throw new Error('The form went away under its publish.');
      return viewOf(tx, scope, published);
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
  // Restoring: back to paused, or to draft for a form never published.
  if (status === 'archived' && (wanted === 'paused' || wanted === 'draft')) {
    return form.liveVersionId === null ? 'draft' : 'paused';
  }
  return undefined;
}

/**
 * Moves a form between live, paused and archived (AC-549). Paused shows a
 * "not taking responses" message at its link; archived refuses submissions
 * and leaves the list until restored (to paused, or draft if it never went
 * live). Anything else is 409 `FORM_STATE`.
 */
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
      await touchForm(tx, scope, form.id, {
        status: next,
        archivedAt: next === 'archived' ? sql`now()` : null,
      });
      const moved = await loadForm(tx, form.id);
      if (moved === undefined) throw new Error('The form went away under its change.');
      return viewOf(tx, scope, moved);
    },
    hooks,
  );
  return result;
}

/**
 * Gives a form a new public key (AC-552): its old link and every embed of it
 * stop working at once, on purpose.
 */
export async function rotateFormKey(
  scope: EngineScope,
  input: { readonly formId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<FormView> {
  requirePermission(scope, 'forms.manage');
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const form = await visibleForm(tx, scope, input.formId, true);
      await touchForm(tx, scope, form.id, { publicKey: newPublicKey() });
      const rotated = await loadForm(tx, form.id);
      if (rotated === undefined) throw new Error('The form went away under its change.');
      return viewOf(tx, scope, rotated);
    },
    hooks,
  );
  return result;
}
