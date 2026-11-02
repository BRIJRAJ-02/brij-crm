// Managed booking pages (spec 0037, AC-1333 to AC-1336): one template holding a page's settings, the members it
// makes a page for, and which parts those members may not change. `booking.admin`, or one of the template's editors
// (AC-1331), makes and changes it; each member gets a page of their own, owned by them, at
// `<template slug>-<first name>`. The template is a `booking_pages` row of kind `managed`: it is never bookable, so
// its own public link answers "This page is no longer available" (`liveOf`, `public.ts`).
//
// The three rules that make this safe, each tested:
//   - Saving the template copies every locked part to every member page in ONE statement inside the caller's
//     transaction (AC-1334), so no member is ever left on older settings than another and 200 pages cost one round
//     trip, not 200 (the spec's Consequences are explicit about this).
//   - A locked part is unwritable by the member ON THE SERVER (`lockedPartOfWrite`, called from
//     `updateBookingPage`), not merely read only in their editor.
//   - Removing a member deletes their page the way spec 0025 AC-648 deletes one (bookings stay, the link answers no
//     longer available); deleting the TEMPLATE keeps every member page as that member's own (AC-1335). These are
//     opposites, and getting them the wrong way round destroys customers' pages, so both directions are tested.
// Templates are settings, as pages are: their writes store no outbox row.
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  BookingQuestions,
  defaultAvailability,
  MANAGED_MEMBERS_MAX,
  MANAGED_PART_KEYS,
  PERMISSIONS,
  slugFromTitle,
  type BookingPageSettings,
  type CreateManagedPageInput,
  type DeleteManagedPageInput,
  type GetManagedPageInput,
  type ManagedMemberView,
  type ManagedPageList,
  type ManagedPageView,
  type ManagedPart,
  type SetManagedMembersInput,
  type UpdateManagedPageInput,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { queueEmail } from '../emails/queue.ts';
import { newId } from '../engine/ids.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { writeAudit } from '../members/audit.ts';
import type { RemovalEffect } from '../members/removal-effect.ts';
import { checkNotRouted } from '../routing/in-use.ts';
import { deleteEditorsOf, editedBy } from '../scheduling/editor-rows.ts';
import { freeSlug, newPublicKey, nextProfilePosition, slugRefusal } from './pages.ts';
import { locksOf } from './managed-locks.ts';
import { checkAnswersObject, checkPageQuestions } from './questions.ts';

const { bookingPageMembers, bookingPages, managedPageMembers, members, workspaces } = schema;

/** What a template the reader may not see or change answers, saying nothing of whose it is. */
const NOT_FOUND_MESSAGE = 'That managed page doesn’t exist any more.';

/** What a template naming more than 200 members is refused with (AC-1333). */
const MEMBERS_LIMIT_MESSAGE = `A managed page makes pages for at most ${String(MANAGED_MEMBERS_MAX)} people.`;

/** The member the scope acts for, or undefined (a key, the system). */
function memberOf(scope: EngineScope): string | undefined {
  return scope.access.principal.kind === 'member' ? scope.access.principal.memberId : undefined;
}

/** A template's stored row, as this module reads it. */
type TemplateRow = typeof bookingPages.$inferSelect;

/**
 * The template, live, as the reader may change it (AC-1333): `booking.admin`, or one of its editors (AC-1331). A
 * template the reader may not change answers as absent (NOT_FOUND), so nobody learns a template exists from a
 * refusal. Making the page's owner enough would be wrong here: a template is the workspace's, not a person's.
 */
async function templateToChange(
  tx: WorkspaceTx,
  scope: EngineScope,
  templateId: string,
  lock: boolean,
): Promise<TemplateRow> {
  const query = tx
    .select()
    .from(bookingPages)
    .where(and(eq(bookingPages.id, templateId), eq(bookingPages.kind, 'managed'), isNull(bookingPages.deletedAt)));
  const [row] = lock ? await query.for('no key update') : await query;
  if (row === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
  if (can(scope.access, 'booking.admin')) return row;
  const edits = await editedBy(tx, scope, 'booking_page');
  if (!edits.has(row.id)) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
  return row;
}

/**
 * The two parts whose lock is not a copy. `hours` is the member's own default schedule (AC-1336); `address` is a
 * slug built per member at `<template slug>-<first name>` (AC-1333's Value sourcing table), so copying the
 * template's one value onto every member page would both be wrong and break `booking_pages_slug`. Locking either
 * means "the member may not change this", which the write check enforces on its own.
 */
const NOT_COPIED = ['address', 'hours'] as const;

/** A part whose lock is not a copy. */
type NotCopied = (typeof NOT_COPIED)[number];

/**
 * Every setting a lock propagates as a value: each key of each lockable part but the two in `NOT_COPIED`. The type
 * is exhaustive on purpose, so a part gained later without a column here is a type error rather than a silent half
 * lock that refuses the member and propagates nothing.
 */
type PropagatedKey = (typeof MANAGED_PART_KEYS)[Exclude<ManagedPart, NotCopied>][number];

/** The column each propagated setting lives in: what the one propagation statement sets. */
const SETTING_COLUMNS: Record<PropagatedKey, string> = {
  title: 'title',
  description: 'description',
  durations: 'durations',
  slotStep: 'slot_step',
  location: 'location',
  questions: 'questions',
  fileToCrm: 'file_to_crm',
  answersObjectId: 'answers_object_id',
  bufferBefore: 'buffer_before',
  bufferAfter: 'buffer_after',
  minNoticeMinutes: 'min_notice_minutes',
  windowDays: 'window_days',
  dailyLimit: 'daily_limit',
};

/**
 * Copies every locked part of `template` onto every one of its member pages (AC-1334), in ONE statement inside the
 * caller's transaction: 200 pages cost one round trip, and a failure anywhere rolls the whole save back, so nobody
 * is left on older locked settings with nothing to show it (the partial propagation this lane's brief warns about
 * is impossible by construction).
 *
 * The Hours rule is the one part not copied as a value (AC-1336): a member page books on its own member's hours, so
 * locking Hours means "your default schedule" — `schedule_id` null — and never the template owner's schedule, which
 * belongs to someone else and spec 0035 AC-966 refuses on another person's page. Unlocked, the member's own choice
 * stands and nothing here touches it.
 */
async function propagateLocked(tx: WorkspaceTx, scope: EngineScope, template: TemplateRow): Promise<void> {
  const locked = locksOf(template);
  if (locked.length === 0) return;
  const columns = locked
    .filter((part): part is Exclude<ManagedPart, NotCopied> => !(NOT_COPIED as readonly string[]).includes(part))
    .flatMap((part) => MANAGED_PART_KEYS[part].map((key: PropagatedKey) => SETTING_COLUMNS[key]));
  const sets = columns.map((column) => sql`${sql.raw(column)} = t.${sql.raw(column)}`);
  // Locked Hours: every member page follows its own owner's default schedule (AC-1336).
  if (locked.includes('hours')) sets.push(sql`schedule_id = null`, sql`hours_mode = 'mine'`);
  if (sets.length === 0) return;
  const by = actorRow(scope.actor);
  await tx.execute(sql`
    update booking_pages p
    set ${sql.join(sets, sql`, `)},
      updated_at = now(), updated_by_type = ${by.type}, updated_by_id = ${by.id}::uuid,
      updated_by_member_id = ${by.memberId}::uuid
    from booking_pages t
    where t.workspace_id = ${scope.workspaceId}::uuid and t.id = ${template.id}::uuid
      and p.workspace_id = t.workspace_id and p.template_id = t.id and p.deleted_at is null
  `);
}

/** A member's first name in the slug alphabet, for `<template slug>-<first name>` (the Value sourcing table). */
function firstNameSlug(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  const slug = slugFromTitle(first);
  return slug === 'meeting' ? 'me' : slug;
}

/**
 * The template's member pages' owners, by member id, with the page each holds: one indexed read
 * (`booking_pages_by_template`).
 */
async function pagesByMember(
  tx: WorkspaceTx,
  templateId: string,
): Promise<ReadonlyMap<string, { readonly id: string; readonly slug: string }>> {
  const rows = await tx
    .select({ id: bookingPages.id, slug: bookingPages.slug, ownerMemberId: bookingPages.ownerMemberId })
    .from(bookingPages)
    .where(and(eq(bookingPages.templateId, templateId), isNull(bookingPages.deletedAt)));
  return new Map(rows.map((row) => [row.ownerMemberId, { id: row.id, slug: row.slug }]));
}

/** The member ids a template should make pages for: its chosen members, or the active non guests of the team it follows. */
async function wantedMembers(tx: WorkspaceTx, template: TemplateRow): Promise<readonly string[]> {
  if (template.followTeamId !== null) {
    const found = await tx.execute<{ id: string }>(sql`
      select m.id::text as id from team_members tm
      join members m on m.workspace_id = tm.workspace_id and m.id = tm.member_id
      where tm.workspace_id = ${template.workspaceId}::uuid and tm.team_id = ${template.followTeamId}::uuid
        and m.status = 'active' and m.role::text <> 'guest'
      order by m.name, m.id
    `);
    return found.rows.map((row) => row.id);
  }
  const rows = await tx
    .select({ memberId: managedPageMembers.memberId, name: members.name })
    .from(managedPageMembers)
    .innerJoin(
      members,
      and(eq(members.workspaceId, managedPageMembers.workspaceId), eq(members.id, managedPageMembers.memberId)),
    )
    .where(eq(managedPageMembers.templateId, template.id))
    .orderBy(asc(members.name), asc(managedPageMembers.memberId));
  return rows.map((row) => row.memberId);
}

/** The template as its editor reads it (AC-1333): its locks, and each member with the page they hold. */
async function viewOf(tx: WorkspaceTx, scope: EngineScope, template: TemplateRow): Promise<ManagedPageView> {
  const wanted = await wantedMembers(tx, template);
  const pages = await pagesByMember(tx, template.id);
  const names =
    wanted.length === 0
      ? []
      : await tx
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(inArray(members.id, [...wanted]));
  const byId = new Map(names.map((row) => [row.id, row.name]));
  const list: readonly ManagedMemberView[] = wanted.map((memberId) => {
    const page = pages.get(memberId);
    return {
      id: memberId,
      name: byId.get(memberId) ?? '',
      ...(page === undefined ? {} : { pageId: page.id, slug: page.slug }),
    };
  });
  return {
    id: template.id,
    title: template.title,
    slug: template.slug,
    description: template.description,
    locked: [...locksOf(template)],
    followTeamId: template.followTeamId,
    members: [...list],
    canChange: true,
  };
}

/** Every managed template in the workspace, newest first (AC-1333): the ones the reader may change. */
export async function listManagedPages(scope: EngineScope): Promise<ManagedPageList> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const rows = await tx
      .select()
      .from(bookingPages)
      .where(and(eq(bookingPages.kind, 'managed'), isNull(bookingPages.deletedAt)))
      .orderBy(desc(bookingPages.createdAt), asc(bookingPages.id));
    const admin = can(scope.access, 'booking.admin');
    const edits = admin ? undefined : await editedBy(tx, scope, 'booking_page');
    const mine = rows.filter((row) => admin || (edits?.has(row.id) ?? false));
    const templates: ManagedPageView[] = [];
    for (const row of mine) templates.push(await viewOf(tx, scope, row));
    return { templates };
  });
}

/** One managed template (AC-1333); one the reader may not change answers as absent. */
export async function getManagedPage(
  scope: EngineScope,
  input: Pick<GetManagedPageInput, 'templateId'>,
): Promise<ManagedPageView> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const template = await templateToChange(tx, scope, input.templateId, false);
    return viewOf(tx, scope, template);
  });
}

/**
 * A new managed template (AC-1333): `booking.admin`'s, since a template is the workspace's, not a person's. It is a
 * page row of kind `managed`, private (so it is on nobody's profile and in nobody's link page) and never bookable.
 * The members named get their pages in the same transaction, each emailed. The same id again answers the template it
 * made (a retry).
 */
export async function createManagedPage(
  scope: EngineScope,
  input: Pick<
    CreateManagedPageInput,
    'id' | 'title' | 'timeZone' | 'settings' | 'locked' | 'memberIds' | 'followTeamId'
  >,
): Promise<ManagedPageView> {
  requirePermission(scope, 'booking.admin');
  const owner = memberOf(scope);
  if (owner === undefined) throw refuse('FORBIDDEN', PERMISSIONS['booking.admin'].message);
  const wanted = [...new Set(input.memberIds ?? [])];
  if (wanted.length > MANAGED_MEMBERS_MAX) throw refuse('MANAGED_MEMBERS_LIMIT', MEMBERS_LIMIT_MESSAGE);
  // Following a team is modelled (the column, its `on delete restrict` key and the read) but not driven: nothing
  // yet makes or removes a page when the team's membership changes, the way AC-1327 does for a rotation through
  // `rotation_roster`. A template made this way could not be repaired (`setManagedMembers` is refused on it), so it
  // is refused until that hook lands. See scratchpad/0037-l10-spec-notes.md.
  if (input.followTeamId !== undefined) {
    throw refuseOn(
      'CONFIG_INVALID',
      'A managed page can’t follow a team yet. Name the people it covers instead.',
      'followTeamId',
    );
  }
  return inWorkspace(scope, async (tx) => {
    const [existing] = await tx.select().from(bookingPages).where(eq(bookingPages.id, input.id));
    if (existing !== undefined) {
      if (existing.kind !== 'managed') throw refuse('ID_TAKEN', 'A booking page with that id already exists.');
      return viewOf(tx, scope, existing);
    }
    const given = input.settings ?? {};
    const settings = defaulted(input.title, given);
    if (settings.answersObjectId !== null) {
      await checkAnswersObject(tx, scope, settings.answersObjectId, settings.questions);
    }
    await checkPageQuestions(tx, scope, settings.questions, [], settings.answersObjectId);
    const by = actorRow(scope.actor);
    const slug = given.slug ?? (await freeSlug(tx, scope.workspaceId, owner, slugFromTitle(input.title)));
    try {
      const [row] = await tx
        .insert(bookingPages)
        .values({
          workspaceId: scope.workspaceId,
          id: input.id,
          publicKey: newPublicKey(),
          slug,
          kind: 'managed',
          scope: 'member',
          ownerMemberId: owner,
          title: settings.title,
          description: settings.description,
          durations: [...settings.durations],
          availability: defaultAvailability(input.timeZone),
          location: settings.location,
          bufferBefore: settings.bufferBefore,
          bufferAfter: settings.bufferAfter,
          minNoticeMinutes: settings.minNoticeMinutes,
          windowDays: settings.windowDays,
          dailyLimit: settings.dailyLimit,
          slotStep: settings.slotStep,
          // A template is never bookable and never on anyone's profile: its link answers no longer available.
          status: 'paused',
          isPrivate: true,
          scheduleId: null,
          hoursMode: 'mine',
          questions: settings.questions,
          fileToCrm: settings.fileToCrm,
          answersObjectId: settings.answersObjectId,
          locked: [...(input.locked ?? [])],
          followTeamId: input.followTeamId ?? null,
          createdByType: by.type,
          createdById: by.id,
          createdByMemberId: by.memberId,
          updatedByType: by.type,
          updatedById: by.id,
          updatedByMemberId: by.memberId,
        })
        .returning();
      if (row === undefined) throw new Error('The managed page was not created.');
      if (wanted.length > 0) {
        await tx.insert(managedPageMembers).values(
          wanted.map((memberId) => ({
            workspaceId: scope.workspaceId,
            templateId: row.id,
            memberId,
            createdByType: by.type,
            createdById: by.id,
            createdByMemberId: by.memberId,
            updatedByType: by.type,
            updatedById: by.id,
            updatedByMemberId: by.memberId,
          })),
        );
      }
      await makePagesFor(tx, scope, row, await wantedMembers(tx, row));
      await writeAudit(tx, scope.workspaceId, scope.actor, {
        action: 'managed_page.changed',
        targetType: 'booking_page',
        targetId: row.id,
        before: {},
        after: { name: row.title, locked: locksOf(row), added: wanted.length, removed: 0 },
      });
      return await viewOf(tx, scope, row);
    } catch (error) {
      throw slugRefusal(error) ?? error;
    }
  });
}

/** Every setting a template holds, the ones given and the rest defaulted as a page's are. */
function defaulted(title: string, given: Partial<BookingPageSettings>) {
  return {
    title,
    description: given.description ?? '',
    durations: given.durations ?? [30],
    location: given.location ?? { type: 'video' as const },
    bufferBefore: given.bufferBefore ?? 0,
    bufferAfter: given.bufferAfter ?? 0,
    minNoticeMinutes: given.minNoticeMinutes ?? 0,
    windowDays: given.windowDays ?? 60,
    dailyLimit: given.dailyLimit ?? null,
    slotStep: given.slotStep ?? null,
    questions: given.questions ?? [],
    fileToCrm: given.fileToCrm ?? true,
    answersObjectId: given.answersObjectId ?? null,
  };
}

/**
 * A change to a template (AC-1334): only the settings given, and the locks when given, then every locked part
 * copied to every member page in the same transaction. A member page made later takes the unlocked parts as they
 * stand then, which is what "copied only when a member's page is first made" means.
 */
export async function updateManagedPage(
  scope: EngineScope,
  input: Pick<UpdateManagedPageInput, 'templateId' | 'settings' | 'locked'>,
): Promise<ManagedPageView> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const template = await templateToChange(tx, scope, input.templateId, true);
    const settings = input.settings ?? {};
    if (settings.questions !== undefined || settings.answersObjectId !== undefined) {
      const target = settings.answersObjectId === undefined ? template.answersObjectId : settings.answersObjectId;
      // The template's stored questions come back as jsonb: parsed with the shared schema, as `pageOf` parses a
      // page's, so a stored list the schema no longer takes reads as none rather than reaching the checks as unknown.
      const stored = BookingQuestions.safeParse(template.questions).data ?? [];
      const questions = settings.questions ?? stored;
      if (target !== null) await checkAnswersObject(tx, scope, target, questions);
      await checkPageQuestions(tx, scope, questions, stored, target);
    }
    const by = actorRow(scope.actor);
    const [saved] = await tx
      .update(bookingPages)
      .set({
        ...(settings.title === undefined ? {} : { title: settings.title }),
        ...(settings.description === undefined ? {} : { description: settings.description }),
        ...(settings.durations === undefined ? {} : { durations: [...settings.durations] }),
        ...(settings.slotStep === undefined ? {} : { slotStep: settings.slotStep }),
        ...(settings.location === undefined ? {} : { location: settings.location }),
        ...(settings.questions === undefined ? {} : { questions: settings.questions }),
        ...(settings.fileToCrm === undefined ? {} : { fileToCrm: settings.fileToCrm }),
        ...(settings.answersObjectId === undefined ? {} : { answersObjectId: settings.answersObjectId }),
        ...(settings.bufferBefore === undefined ? {} : { bufferBefore: settings.bufferBefore }),
        ...(settings.bufferAfter === undefined ? {} : { bufferAfter: settings.bufferAfter }),
        ...(settings.minNoticeMinutes === undefined ? {} : { minNoticeMinutes: settings.minNoticeMinutes }),
        ...(settings.windowDays === undefined ? {} : { windowDays: settings.windowDays }),
        ...(settings.dailyLimit === undefined ? {} : { dailyLimit: settings.dailyLimit }),
        ...(input.locked === undefined ? {} : { locked: [...input.locked] }),
        updatedAt: sql`now()`,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .where(eq(bookingPages.id, template.id))
      .returning();
    if (saved === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
    await propagateLocked(tx, scope, saved);
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'managed_page.changed',
      targetType: 'booking_page',
      targetId: saved.id,
      before: { name: template.title, locked: locksOf(template) },
      after: { name: saved.title, locked: locksOf(saved), added: 0, removed: 0 },
    });
    return viewOf(tx, scope, saved);
  });
}

/**
 * The template's members, replaced (AC-1335): someone added gets their page at once, with every part of the
 * template, locked and unlocked; someone removed has theirs deleted the way spec 0025 AC-648 deletes one, their
 * bookings kept and the link answering no longer available. Each is emailed. A template that follows a team has no
 * chosen members, so this is refused on it.
 */
export async function setManagedMembers(
  scope: EngineScope,
  input: Pick<SetManagedMembersInput, 'templateId' | 'memberIds'>,
): Promise<ManagedPageView> {
  requirePermission(scope, 'booking.manage');
  const wanted = [...new Set(input.memberIds)];
  if (wanted.length !== input.memberIds.length) {
    throw refuseOn('CONFIG_INVALID', 'Add each person once.', 'memberIds');
  }
  if (wanted.length > MANAGED_MEMBERS_MAX) throw refuse('MANAGED_MEMBERS_LIMIT', MEMBERS_LIMIT_MESSAGE);
  return inWorkspace(scope, async (tx) => {
    const template = await templateToChange(tx, scope, input.templateId, true);
    if (template.followTeamId !== null) {
      throw refuseOn(
        'CONFIG_INVALID',
        'This managed page follows a team, so its people come from the team.',
        'memberIds',
      );
    }
    const held = new Set(await wantedMembers(tx, template));
    const added = wanted.filter((memberId) => !held.has(memberId));
    const removed = [...held].filter((memberId) => !wanted.includes(memberId));
    // Adding someone to a page is an access question (AC-1340): only `booking.admin`, since a template is the
    // workspace's. An editor who isn't an admin changes the template's settings, never who it makes pages for.
    if ((added.length > 0 || removed.length > 0) && !can(scope.access, 'booking.admin')) {
      throw refuse('FORBIDDEN', 'Only an admin changes who a managed page makes pages for.');
    }
    if (added.length > 0) {
      const found = await tx
        .select({ id: members.id })
        .from(members)
        .where(and(inArray(members.id, added), eq(members.status, 'active'), sql`${members.role}::text <> 'guest'`));
      const ok = new Set(found.map((row) => row.id));
      const index = input.memberIds.findIndex((memberId) => added.includes(memberId) && !ok.has(memberId));
      if (index >= 0) {
        throw refuseOn('CONFIG_INVALID', 'Pick active teammates who aren’t guests.', `memberIds.${String(index)}`);
      }
      const by = actorRow(scope.actor);
      await tx.insert(managedPageMembers).values(
        added.map((memberId) => ({
          workspaceId: scope.workspaceId,
          templateId: template.id,
          memberId,
          createdByType: by.type,
          createdById: by.id,
          createdByMemberId: by.memberId,
          updatedByType: by.type,
          updatedById: by.id,
          updatedByMemberId: by.memberId,
        })),
      );
      await makePagesFor(tx, scope, template, added);
    }
    if (removed.length > 0) {
      await tx
        .delete(managedPageMembers)
        .where(and(eq(managedPageMembers.templateId, template.id), inArray(managedPageMembers.memberId, removed)));
      await removePagesOf(tx, scope, template, removed);
    }
    if (added.length > 0 || removed.length > 0) {
      await writeAudit(tx, scope.workspaceId, scope.actor, {
        action: 'managed_page.changed',
        targetType: 'booking_page',
        targetId: template.id,
        before: { name: template.title },
        after: { name: template.title, locked: locksOf(template), added: added.length, removed: removed.length },
      });
    }
    return viewOf(tx, scope, template);
  });
}

/**
 * Makes each member their page from the template (AC-1333): owned by them, with every part of the template, locked
 * and unlocked, at `<template slug>-<first name>` with -2, -3 on clashes, cut to the slug check's 60 characters.
 * Its hours are its own member's (AC-1336): `schedule_id` null, their default schedule, which they may then change
 * while Hours is unlocked. Someone who already has a page from this template keeps it. Each new page's owner is
 * emailed. One insert for every page.
 */
async function makePagesFor(
  tx: WorkspaceTx,
  scope: EngineScope,
  template: TemplateRow,
  memberIds: readonly string[],
): Promise<void> {
  if (memberIds.length === 0) return;
  const have = await pagesByMember(tx, template.id);
  const fresh = memberIds.filter((memberId) => !have.has(memberId));
  if (fresh.length === 0) return;
  const named = await tx
    .select({ id: members.id, name: members.name })
    .from(members)
    .where(inArray(members.id, [...fresh]));
  const byId = new Map(named.map((row) => [row.id, row.name]));
  const by = actorRow(scope.actor);
  const made: { readonly pageId: string; readonly memberId: string }[] = [];
  const rows = [];
  for (const memberId of fresh) {
    const name = byId.get(memberId);
    if (name === undefined) continue;
    const wanted = `${template.slug}-${firstNameSlug(name)}`.slice(0, 60).replace(/-+$/, '');
    const slug = await freeSlug(tx, scope.workspaceId, memberId, wanted);
    const pageId = newId();
    made.push({ pageId, memberId });
    rows.push({
      workspaceId: scope.workspaceId,
      id: pageId,
      publicKey: newPublicKey(),
      slug,
      kind: 'personal',
      scope: 'member' as const,
      ownerMemberId: memberId,
      templateId: template.id,
      title: template.title,
      description: template.description,
      durations: [...template.durations],
      availability: template.availability,
      location: template.location,
      bufferBefore: template.bufferBefore,
      bufferAfter: template.bufferAfter,
      minNoticeMinutes: template.minNoticeMinutes,
      windowDays: template.windowDays,
      dailyLimit: template.dailyLimit,
      slotStep: template.slotStep,
      status: 'live',
      // The member's own hours (AC-1336): their default schedule, which they may change while Hours is unlocked.
      scheduleId: null,
      hoursMode: 'mine',
      questions: template.questions,
      fileToCrm: template.fileToCrm,
      answersObjectId: template.answersObjectId,
      profilePosition: await nextProfilePosition(tx, memberId),
      createdByType: by.type,
      createdById: by.id,
      createdByMemberId: by.memberId,
      updatedByType: by.type,
      updatedById: by.id,
      updatedByMemberId: by.memberId,
    });
  }
  if (rows.length === 0) return;
  try {
    await tx.insert(bookingPages).values(rows);
  } catch (error) {
    throw slugRefusal(error) ?? error;
  }
  // Every page hosts its own owner, as a personal page does.
  await tx.insert(bookingPageMembers).values(
    made.map((each) => ({
      workspaceId: scope.workspaceId,
      pageId: each.pageId,
      memberId: each.memberId,
      position: 0,
    })),
  );
  await tellMembers(tx, scope, template, made, false);
}

/**
 * Deletes the pages these members hold from the template, exactly as spec 0025 AC-648 deletes one (AC-1335): the
 * page is hidden, its bookings stay and its link answers "no longer available". A page a published form still books
 * is refused `ROUTING_IN_USE` (AC-1341), which refuses the whole removal rather than leaving a form pointing at a
 * page that can't book. Each member is emailed. One statement for every page.
 */
async function removePagesOf(
  tx: WorkspaceTx,
  scope: EngineScope,
  template: TemplateRow,
  memberIds: readonly string[],
): Promise<void> {
  if (memberIds.length === 0) return;
  const have = await pagesByMember(tx, template.id);
  const going = memberIds.flatMap((memberId) => {
    const page = have.get(memberId);
    return page === undefined ? [] : [{ pageId: page.id, memberId }];
  });
  if (going.length === 0) return;
  for (const each of going) await checkNotRouted(tx, scope.access, each.pageId);
  await deleteEditorsOf(
    tx,
    'booking_page',
    going.map((each) => each.pageId),
  );
  const by = actorRow(scope.actor);
  await tx
    .update(bookingPages)
    .set({
      deletedAt: sql`now()`,
      updatedAt: sql`now()`,
      updatedByType: by.type,
      updatedById: by.id,
      updatedByMemberId: by.memberId,
    })
    .where(
      inArray(
        bookingPages.id,
        going.map((each) => each.pageId),
      ),
    );
  await tellMembers(tx, scope, template, going, true);
}

/**
 * "You have a new booking page: <title>" to each member a page was made for, and "Your <title> page was removed" to
 * each one whose page went (AC-1335), but the one who made the change. Ids only in the key.
 */
async function tellMembers(
  tx: WorkspaceTx,
  scope: EngineScope,
  template: TemplateRow,
  told: readonly { readonly pageId: string; readonly memberId: string }[],
  removed: boolean,
): Promise<void> {
  const actor = memberOf(scope);
  const reach = told.filter((each) => each.memberId !== actor);
  if (reach.length === 0) return;
  const [place] = await tx
    .select({ slug: workspaces.slug, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, scope.workspaceId));
  if (place === undefined) return;
  // A key or the system made the change: the workspace's own name stands in, so nobody is left unaware their page
  // was made or removed just because no member did it.
  const named =
    actor === undefined
      ? undefined
      : (await tx.select({ name: members.name }).from(members).where(eq(members.id, actor)))[0]?.name;
  const byName = named ?? place.name;
  for (const each of reach) {
    await queueEmail(tx, {
      kind: 'managed_page',
      // `made` or `removed` in the key: the same page made and later removed are two emails, not one (the key is
      // the kind and these ids), while each event stays idempotent on a retry.
      ids: [template.id, each.memberId, each.pageId, removed ? 'removed' : 'made'],
      to: { memberId: each.memberId },
      params: {
        pageTitle: template.title,
        byName,
        path: removed ? `/w/${place.slug}/captures/links` : `/w/${place.slug}/captures/links/${each.pageId}`,
        ...(removed ? { removed: true } : {}),
      },
    });
  }
}

/**
 * Deletes a template (AC-1335): every member page STAYS, as that member's own, no longer linked to it — the
 * opposite of taking a member off, which deletes their page. This is the direction that destroys customers' data
 * when it is the wrong way round, so it is tested both ways. `booking.admin`'s alone: an editor changes everything
 * on a resource except its deletion (AC-1331).
 */
export async function deleteManagedPage(
  scope: EngineScope,
  input: Pick<DeleteManagedPageInput, 'templateId'>,
): Promise<{ readonly deleted: true }> {
  requirePermission(scope, 'booking.admin');
  return inWorkspace(scope, async (tx) => {
    const template = await templateToChange(tx, scope, input.templateId, true);
    const by = actorRow(scope.actor);
    // Each member page is its member's own from now on: nothing locks it, and nothing propagates to it again.
    await tx
      .update(bookingPages)
      .set({
        templateId: null,
        updatedAt: sql`now()`,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .where(and(eq(bookingPages.templateId, template.id), isNull(bookingPages.deletedAt)));
    await tx.delete(managedPageMembers).where(eq(managedPageMembers.templateId, template.id));
    await deleteEditorsOf(tx, 'booking_page', [template.id]);
    await tx
      .update(bookingPages)
      .set({
        deletedAt: sql`now()`,
        templateId: null,
        updatedAt: sql`now()`,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .where(eq(bookingPages.id, template.id));
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'managed_page.changed',
      targetType: 'booking_page',
      targetId: template.id,
      before: { name: template.title, locked: locksOf(template) },
      after: { name: template.title, deleted: true, added: 0, removed: 0 },
    });
    return { deleted: true as const };
  });
}

/**
 * A member who leaves is on no template any more (spec 0031, AC-814 widened): their rows go with them. Their page
 * is handled by the booking pages' own removal effect, as any page of theirs is.
 */
export const managedMembersRemoval: RemovalEffect = {
  feature: 'managed booking page members',
  constraints: ['managed_page_members_member'],
  run: async (context, memberId) => {
    await context.tx
      .delete(managedPageMembers)
      .where(
        and(eq(managedPageMembers.workspaceId, context.scope.workspaceId), eq(managedPageMembers.memberId, memberId)),
      );
  },
};
