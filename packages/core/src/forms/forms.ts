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
import { and, desc, eq, inArray, isNull, max, ne, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import {
  choiceKeysOf,
  defaultQuestions,
  fitsAttribute,
  FORM_COUNT_CAP,
  FORM_SLUG,
  FORMS_LIST_MAX,
  generatedSlug,
  publishProblem,
  recordFactProblem,
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
import { writeAudit } from '../members/audit.ts';
import { changedRuleIds, checkFormAddresses, checkFormRoutes, rulesChanged } from '../routing/check.ts';
import { can, fieldLevel, objectLevel, type Access } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { checkObject, UNKNOWN_OBJECT } from '../access/visibility.ts';
import { withdrawSubmissionNotices } from '../notifications/notify.ts';
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

const { bookingPages, forms, formSubmissions, formVersions, members, objects, rotationRoster, rotations } = schema;

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
    routing: { rules: [] },
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
    ...(form.ownerRotationId === null ? {} : { ownerRotationId: form.ownerRotationId }),
    notifyMemberIds: [...form.notifyMemberIds],
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
    return targetChoices(tx, scope, objectId);
  });
}

/**
 * An object and the attributes an answer may be filed on (AC-658): its live, non system attributes the reader can
 * see, with whether they may write each. A form's Where it goes and a booking page's (spec 0057, AC-5706) list these.
 */
export async function targetChoices(tx: WorkspaceTx, scope: EngineScope, objectId: string): Promise<FormTargetChoices> {
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

/** What listing someone to tell who isn't an active member answers. */
export const NOTIFY_MEMBER_UNKNOWN = 'Pick people who are in this workspace.';

/** Refuses a list to tell that names anyone who isn't an active member; answers it without repeats, in its order. */
async function checkNotify(tx: WorkspaceTx, memberIds: readonly string[]): Promise<string[]> {
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return [];
  const found = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(inArray(members.id, unique), eq(members.status, 'active')));
  if (found.length !== unique.length) throw refuseOn('CONFIG_INVALID', NOTIFY_MEMBER_UNKNOWN, 'notifyMemberIds');
  return unique;
}

/** Refuses an owner who isn't an active member. */
async function checkOwner(tx: WorkspaceTx, memberId: string): Promise<void> {
  const [found] = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.status, 'active')));
  if (found === undefined) throw refuseOn('CONFIG_INVALID', 'That member isn’t in this workspace.', 'ownerMemberId');
}

/** What naming a rotation the member can't pick answers: gone, or one they can't see (on screen, a round robin group). */
export const OWNER_ROTATION_UNSEEN = 'Pick a round robin group you can see.';

/** What naming a member and a rotation as the owner at once answers. */
export const OWNER_BOTH = 'Pick a teammate or a round robin group as the owner, not both.';

/**
 * Refuses a rotation the member can't pick as a form's owner (spec 0029,
 * AC-755): one deleted, or one they can't see as Settings lists them (any with
 * `booking.admin`, else those they are in with `booking.manage`, else none).
 * Every refusal reads the same, so it never says whether a hidden one exists.
 */
async function checkOwnerRotation(tx: WorkspaceTx, scope: EngineScope, rotationId: string): Promise<void> {
  const principal = scope.access.principal;
  const me = principal.kind === 'member' ? principal.memberId : undefined;
  const everyone = can(scope.access, 'booking.admin');
  const theirs = !everyone && can(scope.access, 'booking.manage') && me !== undefined;
  if (!everyone && !theirs) throw refuseOn('CONFIG_INVALID', OWNER_ROTATION_UNSEEN, 'ownerRotationId');
  const [found] = await tx
    .select({ id: rotations.id })
    .from(rotations)
    .where(
      and(
        eq(rotations.id, rotationId),
        isNull(rotations.deletedAt),
        everyone
          ? undefined
          : sql`exists (select 1 from ${rotationRoster} m where m.workspace_id = "rotations"."workspace_id"
              and m.rotation_id = "rotations"."id" and m.member_id = ${me ?? null}::uuid)`,
      ),
    )
    // Shared, so a delete running now waits for this change and then counts this form ("Used by 1 form").
    .for('share');
  if (found === undefined) throw refuseOn('CONFIG_INVALID', OWNER_ROTATION_UNSEEN, 'ownerRotationId');
}

/**
 * The owner columns a settings change writes: a member or a rotation, never
 * both, so naming one clears the other; `null` clears only its own.
 */
function ownerColumns(input: FormSettingsInput): PgUpdateSetSource<typeof forms> {
  return {
    ...(input.ownerMemberId === undefined ? {} : { ownerMemberId: input.ownerMemberId }),
    ...(input.ownerRotationId === undefined ? {} : { ownerRotationId: input.ownerRotationId }),
    ...(typeof input.ownerRotationId === 'string' ? { ownerMemberId: null } : {}),
    ...(typeof input.ownerMemberId === 'string' ? { ownerRotationId: null } : {}),
  };
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
    // Its maker owns its leads and hears of each submission until someone changes either (AC-567, AC-568).
    ...(scope.actor.type === 'member' && scope.actor.id !== null
      ? { ownerMemberId: scope.actor.id, notifyMemberIds: [scope.actor.id] }
      : {}),
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
async function defaultObject(tx: WorkspaceTx, access: Access): Promise<string | undefined> {
  const rows = await tx
    .select({ id: objects.id })
    .from(objects)
    .where(sql`${objects.archivedAt} is null`)
    .orderBy(sql`(${objects.standardKey} = 'people') desc nulls last`, objects.position);
  // The first one the creator may write (late trap #16): a member who reads People but can't write it was refused
  // "New form" outright. Undefined when they write none, and the form keeps its submissions only.
  return rows.find((row) => objectLevel(access, row.id) === 'write')?.id;
}

/** What creating a form takes: `mainObjectId` absent is People (or the first object), `null` keeps submissions only. */
export interface CreateFormInput {
  readonly id: string;
  readonly name?: string;
  readonly mainObjectId?: string | null;
  /** `team_link` makes the Team link (spec 0037, AC-1353) instead of an empty form. */
  readonly starter?: 'team_link';
}

/** The Team link's name, unless the maker names it. */
export const TEAM_LINK_NAME = 'Book a call';
/** The most team pages the Team link offers (spec 0037's Numbers). */
export const TEAM_LINK_PAGES_MAX = 8;
/** The Team link's choice question's key: its rules read it. */
const TEAM_LINK_KEY = 'meeting';

/** One team page the Team link offers: its id and title. */
interface TeamLinkPage {
  readonly id: string;
  readonly title: string;
}

/**
 * The live team pages the maker may send visitors to (the same door a form's booking route goes through), the
 * workspace link first and then by title, at most 8.
 */
async function teamLinkPages(tx: WorkspaceTx, scope: EngineScope): Promise<readonly TeamLinkPage[]> {
  const rows = await tx
    .select({ id: bookingPages.id, title: bookingPages.title })
    .from(bookingPages)
    .where(and(eq(bookingPages.kind, 'round_robin'), eq(bookingPages.status, 'live'), isNull(bookingPages.deletedAt)))
    .orderBy(sql`(${bookingPages.scope} = 'workspace') desc`, sql`lower(${bookingPages.title})`, bookingPages.id);
  const usable: TeamLinkPage[] = [];
  for (const row of rows) {
    if (usable.length === TEAM_LINK_PAGES_MAX) break;
    if ((await bookingTargetProblem(tx, scope, row.id, 'seen')) === undefined) usable.push(row);
  }
  return usable;
}

/**
 * The Team link's document (AC-1353): Name and Email, then "What would you like to book?" with one choice per page
 * (two pages with one title told apart by a number), one rule per choice booking that page, and the first page
 * (the workspace link when there is one) as After someone sends it. From then on it is an ordinary form.
 */
function teamLinkDocument(draft: FormDocument, pages: readonly TeamLinkPage[]): FormDocument {
  const seen = new Map<string, number>();
  const choices = pages.map((page) => {
    const base = page.title.trim().slice(0, 70) || 'Meeting';
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), count);
    return count === 1 ? base : `${base} (${String(count)})`;
  });
  const choiceKeys = choiceKeysOf({ choices });
  const [first] = pages;
  const question: FormQuestion = {
    id: TEAM_LINK_KEY,
    key: TEAM_LINK_KEY,
    label: 'What would you like to book?',
    answerType: 'choice',
    choices,
    choiceKeys,
    required: true,
    update: 'fill',
    kept: true,
  };
  return {
    ...draft,
    headline: TEAM_LINK_NAME,
    buttonText: 'Continue',
    questions: [...draft.questions.filter((each) => each.key !== 'phone'), question],
    routing: {
      rules: pages.map((page, index) => ({
        id: `book-${String(index + 1)}`,
        when: { join: 'all' as const, rules: [{ key: TEAM_LINK_KEY, op: 'is' as const, value: choices[index] ?? '' }] },
        then: { kind: 'book' as const, bookingPageId: page.id, message: '' },
      })),
    },
    ...(first === undefined
      ? {}
      : {
          after: {
            kind: 'booking' as const,
            bookingPageId: first.id,
            countdownSeconds: 0,
            message: '',
          },
        }),
  };
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
      // The Team link (spec 0037, AC-1353): the live team pages its maker may use, the workspace link first.
      const teamPages = input.starter === 'team_link' ? await teamLinkPages(tx, scope) : undefined;
      if (teamPages?.length === 0) {
        throw refuse('CONFIG_INVALID', 'Make a team page or the workspace link first.');
      }
      const shaped = (document: FormDocument) =>
        teamPages === undefined ? document : teamLinkDocument(document, teamPages);
      const name = input.name?.trim() ?? (teamPages === undefined ? UNTITLED_FORM : TEAM_LINK_NAME);
      const objectId =
        input.mainObjectId === undefined
          ? await defaultObject(tx, scope.access)
          : input.mainObjectId === null
            ? undefined
            : checkId(input.mainObjectId, UNKNOWN_OBJECT);
      if (objectId === undefined) {
        const kept = await insertForm(tx, scope, {
          id: input.id,
          name,
          objectId: null,
          document: shaped(firstDraft(undefined)),
        });
        return viewOf(tx, scope, kept);
      }
      const object = await writableObject(tx, scope, objectId);
      const attributes = await loadAttributes(tx, objectId);
      const form = await insertForm(tx, scope, {
        id: input.id,
        name,
        objectId,
        document: shaped(firstDraft({ objectId, attributes, primaryId: object.primaryAttributeId })),
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

/**
 * Our own public origins, which a redirect's address is checked against (spec 0056, AC-5610): the app's, the forms'
 * and the booking pages'. The api passes the deployment's; with none, no address is one of ours.
 */
export interface AddressOptions {
  readonly publicOrigins?: readonly string[];
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
  options: AddressOptions = {},
): Promise<FormView> {
  requirePermission(scope, 'forms.manage');
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const form = await visibleForm(tx, scope, input.formId, true);
      if (form.status === 'archived') throw refuse('FORM_STATE', 'Restore this form before you change it.');
      checkRevision(form, input.expectedRevision);
      checkDraft(form, input.document);
      await checkFormAddresses(tx, scope.workspaceId, input.document, options.publicOrigins ?? []);
      // A form's conditions never read a person's or a company's field (its editor offers none), refused in publish's
      // words: every member who sees the form reads its draft, so a stored one would show them a field's id and the
      // value looked for, even a field hidden from them (security review, 23 October 2026).
      const readsField = recordFactProblem(input.document);
      if (readsField !== undefined) {
        throw refuseOn('CONFIG_INVALID', readsField.message, readsField.questionId ?? 'routing');
      }
      // A newly chosen booking page goes through the access door; one already chosen stays, so others can still edit.
      const chosen = bookingPageOf(input.document);
      if (chosen !== undefined && form.draftVersionId !== null) {
        const before = (await loadVersions(tx, [form.draftVersionId])).get(form.draftVersionId);
        if (bookingPageOf(before?.document) !== chosen) await checkBookingTarget(tx, scope, input.document, 'seen');
      } else if (chosen !== undefined) await checkBookingTarget(tx, scope, input.document, 'seen');
      // Routing's booking pages go through the door the same way: only pages newly named (spec 0043, AC-1605).
      const earlier =
        form.draftVersionId === null
          ? undefined
          : (await loadVersions(tx, [form.draftVersionId])).get(form.draftVersionId);
      await checkFormRoutes(tx, scope, input.document.routing.rules, 'seen', earlier?.document.routing.rules ?? []);
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
  options: AddressOptions = {},
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
      await checkFormRoutes(tx, scope, draft.document.routing.rules, 'live');
      // Again on publish (spec 0056, AC-5612): a redirect that has come to name another workspace's page is refused.
      await checkFormAddresses(tx, scope.workspaceId, draft.document, options.publicOrigins ?? []);
      const problem = publishProblem({
        name: form.name,
        slug: form.publicKey,
        document: draft.document,
        attributes: await publishAttributes(tx, scope.access, form.mainObjectId),
        // So a refusal names the object the form files onto, not People whatever it is (27 October 2026).
        ...(form.mainObjectId === null ? {} : { objectName: await objectName(tx, form.mainObjectId) }),
        canChangeAttributes: can(scope.access, 'schema.manage'),
      });
      if (problem !== undefined) {
        const code = problem.code === 'FILING_FORBIDDEN' ? 'FORBIDDEN' : 'CONFIG_INVALID';
        throw refuseOn(
          code,
          problem.message,
          problem.questionId ??
            (problem.ruleId !== undefined ? 'routing' : problem.code === 'ADDRESS_INVALID' ? 'slug' : 'name'),
        );
      }
      // A change to the rules is audited when it goes live (spec 0043, AC-1616).
      const was =
        form.liveVersionId === null
          ? undefined
          : (await loadVersions(tx, [form.liveVersionId])).get(form.liveVersionId);
      const rulesBefore = was?.document.routing.rules ?? [];
      if (rulesChanged(rulesBefore, draft.document.routing.rules)) {
        await writeAudit(tx, scope.workspaceId, scope.actor, {
          action: 'routing.changed',
          targetType: 'form',
          targetId: form.id,
          before: { rules: rulesBefore.length },
          after: {
            rules: draft.document.routing.rules.length,
            version: draft.number,
            changed: changedRuleIds(rulesBefore, draft.document.routing.rules),
          },
        });
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
  /** The rotation whose fairest member owns each new lead (spec 0029 milestone 3); `null` is none. */
  readonly ownerRotationId?: string | null;
  readonly allowedOrigins?: readonly string[];
  readonly requireSignature?: boolean;
  /** Who is told about each new submission besides the lead's owner, replacing the list. */
  readonly notifyMemberIds?: readonly string[];
}

/**
 * Changes what applies at once (0023-experience.md, Settings): the name, the
 * address (the old link stops working, AC-552), the owner of new records
 * (AC-567), who hears of each submission (AC-568), and the sites that may post their own form and whether their
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
      if (typeof input.ownerMemberId === 'string' && typeof input.ownerRotationId === 'string') {
        throw refuseOn('CONFIG_INVALID', OWNER_BOTH, 'ownerRotationId');
      }
      if (input.ownerMemberId !== undefined && input.ownerMemberId !== null) await checkOwner(tx, input.ownerMemberId);
      if (input.ownerRotationId !== undefined && input.ownerRotationId !== null) {
        await checkOwnerRotation(tx, scope, input.ownerRotationId);
      }
      const notify = input.notifyMemberIds === undefined ? undefined : await checkNotify(tx, input.notifyMemberIds);
      const set: PgUpdateSetSource<typeof forms> = {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...ownerColumns(input),
        ...(input.allowedOrigins === undefined ? {} : { allowedOrigins: [...new Set(input.allowedOrigins)] }),
        ...(input.requireSignature === undefined ? {} : { requireSignature: input.requireSignature }),
        ...(notify === undefined ? {} : { notifyMemberIds: notify }),
      };
      if (Object.keys(set).length > 0) await touchForm(tx, scope, form.id, set, false);
      // Who gets the form's new records is audited when it changes, as its routing rules are.
      const owner = (row: { ownerMemberId: string | null; ownerRotationId: string | null }) => ({
        ownerMemberId: row.ownerMemberId,
        ownerRotationId: row.ownerRotationId,
      });
      const changed = await loadForm(tx, form.id);
      if (changed === undefined) throw new Error('The form went away under its change.');
      if (JSON.stringify(owner(form)) !== JSON.stringify(owner(changed))) {
        await writeAudit(tx, scope.workspaceId, scope.actor, {
          action: 'form.owner_changed',
          targetType: 'form',
          targetId: form.id,
          before: owner(form),
          after: owner(changed),
        });
      }
      if (notify !== undefined && JSON.stringify(form.notifyMemberIds) !== JSON.stringify(changed.notifyMemberIds)) {
        await writeAudit(tx, scope.workspaceId, scope.actor, {
          action: 'form.notify_changed',
          targetType: 'form',
          targetId: form.id,
          before: { notifyMemberIds: form.notifyMemberIds },
          after: { notifyMemberIds: changed.notifyMemberIds },
        });
      }
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
  // The first unfiled email is the visitor's own. Kept off the CRM, it stays where it is, and no later email question
  // takes the match in its place: a referrer's email filed as the match would put every visitor's answers on the
  // referrer's record (security review, 28 October 2026).
  const firstEmail = questions.find((question) => question.answerType === 'email' && question.filedOn === undefined);
  return questions.map((question) => {
    // Filed already, or kept off the CRM by choice: either way, not ours to file.
    if (question.filedOn !== undefined || question.kept === true) return question;
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
 * Whether pointing a form at the object it already has left the draft exactly as it was: the same questions, filed
 * the same way, matching on the same attribute. Both documents are built from the same draft a few lines apart, so
 * their keys are written in the same order and comparing them as text is enough.
 */
function sameDraft(before: FormDocument, after: FormDocument): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
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
      // The object a form already files onto is not a no-op (27 October 2026). Its attributes may have moved under
      // the draft since it was chosen: the builder creates the ones its questions need and then asks for the same
      // object again, and that is the moment the match has to be worked out afresh. Nothing is written below when
      // the draft comes out unchanged, so asking again still costs no version.
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
      if (objectId === form.mainObjectId && sameDraft(draft.document, document)) return viewOf(tx, scope, form);
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
    async (context) => {
      const { tx } = context;
      const form = await visibleForm(tx, scope, input.formId, true);
      // Its submissions' notifications go with them: the inboxes showing one hear of it.
      await withdrawSubmissionNotices(
        context,
        sql`n.submission_id in (select id from form_submissions where form_id = ${form.id})`,
      );
      await tx.delete(formSubmissions).where(eq(formSubmissions.formId, form.id));
      await tx.delete(forms).where(eq(forms.id, form.id));
    },
    hooks,
  );
  return { deleted: true };
}
