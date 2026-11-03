// Publish for booking pages (spec 0068, AC-6810 to AC-6816). An editor's change goes into the page's draft; guests
// keep seeing the live columns, which every public read and the slot engine use, until Publish writes the draft into
// them through the same checks a save runs (`updatePageIn`) and keeps a version, the last 20 per page, in one
// transaction. Discard drops the draft; Restore makes a version the draft again. Who may do any of it is who may
// change the page (`pageToChange`): someone else's page answers NOT_FOUND, as every page write does.
import { PAGE_VERSIONS_KEPT, type BookingPageDraft, type BookingPageView, type PageVersionList } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import { changedOnly, draftFromSnapshot, publishedSnapshot } from './drafts.ts';
import { LOCKED_PART_REFUSAL, lockedPartOfWrite, templateLocksOf } from './managed-locks.ts';
import { checkDurations, pageToChange, updatePageIn, viewWithCounts, type ReachedPage } from './pages.ts';
import { checkPageQuestions, questionsSeenBy, withHiddenFilings } from './questions.ts';
import { loadPage } from './slots.ts';
import { keepVersion, publisherOf } from './versions.ts';

const { bookingPages, members, pageVersions } = schema;

/** Writes the page's draft, or clears it when nothing differs from what guests see. */
async function writeDraft(
  tx: WorkspaceTx,
  page: ReachedPage,
  draft: BookingPageDraft,
  now: Date,
): Promise<ReachedPage> {
  const changed = changedOnly(draft, page);
  const isEmpty = Object.keys(changed).length === 0;
  await tx
    .update(bookingPages)
    .set(isEmpty ? { draft: null, draftChangedAt: null } : { draft: changed, draftChangedAt: now })
    .where(eq(bookingPages.id, page.id));
  const { draft: _draft, draftChangedAt: _at, ...rest } = page;
  return isEmpty ? rest : { ...rest, draft: changed, draftChangedAt: now };
}

/** A draft's questions with the filings hidden from the writer put back, and checked as a save checks them. */
async function draftedQuestions(
  tx: WorkspaceTx,
  scope: EngineScope,
  page: ReachedPage,
  sent: NonNullable<BookingPageDraft['questions']>,
): Promise<NonNullable<BookingPageDraft['questions']>> {
  const seen = await questionsSeenBy(tx, scope.access);
  const questions = withHiddenFilings(page.questions, sent, seen(page.questions, page.answersObjectId));
  await checkPageQuestions(tx, scope, questions, page.questions, page.answersObjectId);
  return questions;
}

/**
 * Changes some of a page's drafted settings (AC-6810): each given replaces the draft's, and one set back to what
 * guests see leaves the draft. Nothing a guest sees changes. A part its managed template locks is refused here as a
 * save refuses it (AC-6815); the rest of a save's checks run at Publish, which says what to fix.
 */
export async function saveBookingPageDraft(
  scope: EngineScope,
  input: { readonly pageId: string; readonly settings: BookingPageDraft },
  now: Date = new Date(),
): Promise<BookingPageView> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const page = await pageToChange(tx, scope, input.pageId, true);
    const locked = await templateLocksOf(tx, page.templateId);
    if (locked !== undefined) {
      const hit = lockedPartOfWrite(locked, input.settings);
      if (hit !== undefined) throw refuseOn('FORBIDDEN', LOCKED_PART_REFUSAL, hit.key);
    }
    // Whether the page shows its owner's links is the owner's alone, as a save holds it.
    if (
      input.settings.showSocials !== undefined &&
      page.scope === 'member' &&
      publisherOf(scope) !== page.ownerMemberId
    ) {
      throw refuseOn('FORBIDDEN', 'Only the page’s owner chooses whether it shows their social links.', 'showSocials');
    }
    checkDurations(input.settings.durations);
    // Questions as a save takes them (spec 0057, AC-5717): what the drafter can't see is put back from the page as it
    // is, and the rest is checked against their own access now, never the publisher's later.
    const settings: BookingPageDraft =
      input.settings.questions === undefined
        ? input.settings
        : { ...input.settings, questions: await draftedQuestions(tx, scope, page, input.settings.questions) };
    // A part locked since an older draft was made leaves the draft, so Publish never trips on it.
    const merged = { ...page.draft, ...settings };
    const kept =
      locked === undefined
        ? merged
        : (Object.fromEntries(
            Object.entries(merged).filter(([key]) => lockedPartOfWrite(locked, { [key]: true }) === undefined),
          ) as BookingPageDraft);
    const drafted = await writeDraft(tx, page, kept, now);
    return viewWithCounts(tx, scope, drafted, now);
  });
}

/**
 * Publishes the page's draft (AC-6811, AC-6812, AC-6814): written into the live columns through every check a save
 * runs, so a page that would be broken is refused with the reason and the setting to fix, and nothing is published.
 * Then the published settings are kept as the next version, and versions past the last 20 are let go. With nothing
 * to publish, the page answers as it is. The caller purges the page's edge copies once this commits (AC-6816).
 */
export async function publishBookingPage(
  scope: EngineScope,
  input: { readonly pageId: string },
  now: Date = new Date(),
): Promise<BookingPageView> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const page = await pageToChange(tx, scope, input.pageId, true);
    const draft = changedOnly(page.draft ?? {}, page);
    if (Object.keys(draft).length === 0) return viewWithCounts(tx, scope, page, now);
    // The draft leaves first, so the view the write answers is the published page; a refusal rolls it back.
    await tx.update(bookingPages).set({ draft: null, draftChangedAt: null }).where(eq(bookingPages.id, page.id));
    const view = await updatePageIn(tx, scope, { pageId: page.id, settings: draft }, now);
    const published = await loadPage(tx, page.id);
    if (published === undefined) throw refuse('NOT_FOUND', 'That booking page doesn’t exist, or isn’t yours.');
    await keepVersion(tx, scope, page.id, publishedSnapshot(published), now);
    return view;
  });
}

/** Drops the page's draft (AC-6811): the editor shows the page as guests see it again. The editor asks first. */
export async function discardBookingPageDraft(
  scope: EngineScope,
  input: { readonly pageId: string },
  now: Date = new Date(),
): Promise<BookingPageView> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const page = await pageToChange(tx, scope, input.pageId, true);
    return viewWithCounts(tx, scope, await writeDraft(tx, page, {}, now), now);
  });
}

/** The page's published versions, newest first, at most 20, each named by who published it while they are a member. */
export async function listBookingPageVersions(
  scope: EngineScope,
  input: { readonly pageId: string },
): Promise<PageVersionList> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const page = await pageToChange(tx, scope, input.pageId, false);
    const rows = await tx
      .select({ version: pageVersions.version, publishedAt: pageVersions.publishedAt, name: members.name })
      .from(pageVersions)
      .leftJoin(
        members,
        and(
          eq(members.workspaceId, pageVersions.workspaceId),
          eq(members.id, pageVersions.publishedByMemberId),
          sql`${members.status} = 'active'`,
        ),
      )
      .where(and(eq(pageVersions.pageKind, 'booking'), eq(pageVersions.pageId, page.id)))
      .orderBy(desc(pageVersions.version))
      .limit(PAGE_VERSIONS_KEPT);
    return {
      versions: rows.map((row, index) => ({
        version: row.version,
        publishedAt: row.publishedAt.toISOString(),
        ...(row.name === null ? {} : { publishedBy: row.name }),
        isCurrent: index === 0,
      })),
    };
  });
}

/**
 * Makes a version the page's draft (AC-6812): the settings it published that differ from what guests see now, over
 * nothing else, so the editor shows that version and Publish puts it back. A version past the last 20 is NOT_FOUND.
 */
export async function restoreBookingPageVersion(
  scope: EngineScope,
  input: { readonly pageId: string; readonly version: number },
  now: Date = new Date(),
): Promise<BookingPageView> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const page = await pageToChange(tx, scope, input.pageId, true);
    const [row] = await tx
      .select({ snapshot: pageVersions.snapshot })
      .from(pageVersions)
      .where(
        and(
          eq(pageVersions.pageKind, 'booking'),
          eq(pageVersions.pageId, page.id),
          eq(pageVersions.version, input.version),
        ),
      );
    if (row === undefined) throw refuseOn('NOT_FOUND', 'That version isn’t kept any more.', 'version');
    const locked = await templateLocksOf(tx, page.templateId);
    const restored = draftFromSnapshot(row.snapshot, page);
    // A part the workspace's template locks stays the template's: a restore never drafts it back.
    const kept =
      locked === undefined
        ? restored
        : (Object.fromEntries(
            Object.entries(restored).filter(([key]) => lockedPartOfWrite(locked, { [key]: true }) === undefined),
          ) as BookingPageDraft);
    return viewWithCounts(tx, scope, await writeDraft(tx, page, kept, now), now);
  });
}
