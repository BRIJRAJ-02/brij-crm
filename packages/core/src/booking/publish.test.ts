// Publish for booking pages (spec 0068, AC-6810 to AC-6814), against the real Postgres: an edit goes into the draft
// and guests (the slot engine's `loadPage`) keep the published page; Publish checks the draft as a save does, writes it
// and keeps a version; a broken draft is refused with the setting to fix and nothing published; Discard drops the
// draft; a version comes back as a draft; versions stop at 20; instant settings stay instant; and the fence: another
// member's page and another workspace's are NOT_FOUND, and a version row never crosses workspaces.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { createBookingPage, getBookingPage, updateBookingPage } from './pages.ts';
import {
  discardBookingPageDraft,
  listBookingPageVersions,
  publishBookingPage,
  restoreBookingPageVersion,
  saveBookingPageDraft,
} from './publish.ts';
import { loadPage } from './slots.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-publish-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;

/** A person and a workspace of theirs, as its owner. */
async function person(name: string) {
  count += 1;
  const userId = randomUUID();
  await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, $2, $3)`, [
    userId,
    name,
    `${userId}@example.com`,
  ]);
  const created = await createWorkspace(db, {
    name: 'Publish',
    slug: `publish-${String(count)}-${String(Date.now())}`,
    firstMember: { name, email: `${userId}@example.com`, userId },
  });
  const scope = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    userId,
  });
  return { ...created, userId, scope };
}

/** A plain member of `workspaceId`. */
async function colleague(workspaceId: string, name: string) {
  const userId = randomUUID();
  await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, $2, $3)`, [
    userId,
    name,
    `${userId}@example.com`,
  ]);
  const memberId = newId();
  await db.withWorkspace(workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type) values (${workspaceId}, ${memberId}, ${userId}, ${name}, ${`${userId}@example.com`}, 'member', 'system', 'system')`,
    ),
  );
  return testScope({ db, workspaceId, actor: { type: 'member', id: memberId }, role: 'member' });
}

const page = (scope: ReturnType<typeof testScope>, title = 'Intro') =>
  createBookingPage(scope, { id: newId(), title, timeZone: 'Europe/London' });

/** What guests see: the page the slot engine and every public read load. */
const guestsSee = (workspaceId: string, pageId: string) => db.withWorkspace(workspaceId, (tx) => loadPage(tx, pageId));

async function refusalOf(promise: Promise<unknown>): Promise<{ code?: string; field?: string } | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (!isRefusal(error)) return { code: 'thrown' };
    return { code: error.refusal.code, ...(error.refusal.field === undefined ? {} : { field: error.refusal.field }) };
  }
}

describe('a booking page’s draft (AC-6810, AC-6811)', () => {
  it('keeps edits in the draft, shown to the editor and named as changes, while guests see the published page', async () => {
    const ada = await person('Ada');
    const made = await page(ada.scope);
    // A page is published as it is made (AC-6814): version 1, nothing to publish.
    expect(made.publication).toBeUndefined();
    expect((await listBookingPageVersions(ada.scope, { pageId: made.id })).versions).toHaveLength(1);
    const drafted = await saveBookingPageDraft(ada.scope, {
      pageId: made.id,
      settings: { title: 'Intro call', durations: [45] },
    });
    expect(drafted.title).toBe('Intro call');
    expect(drafted.durations).toEqual([45]);
    expect(drafted.publication?.changes).toEqual(['Title “Intro” → “Intro call”', 'Length 30 min → 45 min']);
    const guest = await guestsSee(ada.workspaceId, made.id);
    expect(guest?.title).toBe('Intro');
    expect(guest?.durations).toEqual([30]);
    // Set back to what guests see, a change leaves the draft; with none left, there is nothing to publish.
    const back = await saveBookingPageDraft(ada.scope, { pageId: made.id, settings: { title: 'Intro' } });
    expect(back.publication?.changes).toEqual(['Length 30 min → 45 min']);
    const none = await saveBookingPageDraft(ada.scope, { pageId: made.id, settings: { durations: [30] } });
    expect(none.publication).toBeUndefined();
  });

  it('publishes the draft for guests and keeps a version, and Discard drops it after asking (the editor asks)', async () => {
    const ada = await person('Ada');
    const made = await page(ada.scope);
    await saveBookingPageDraft(ada.scope, { pageId: made.id, settings: { title: 'Intro call' } });
    const published = await publishBookingPage(ada.scope, { pageId: made.id });
    expect(published.title).toBe('Intro call');
    expect(published.publication).toBeUndefined();
    expect((await guestsSee(ada.workspaceId, made.id))?.title).toBe('Intro call');
    const { versions } = await listBookingPageVersions(ada.scope, { pageId: made.id });
    expect(versions.map((one) => [one.version, one.isCurrent, one.publishedBy])).toEqual([
      [2, true, 'Ada'],
      [1, false, 'Ada'],
    ]);
    // Publish with nothing to publish answers the page and keeps no version.
    await publishBookingPage(ada.scope, { pageId: made.id });
    expect((await listBookingPageVersions(ada.scope, { pageId: made.id })).versions).toHaveLength(2);
    await saveBookingPageDraft(ada.scope, { pageId: made.id, settings: { description: 'Thirty minutes' } });
    const discarded = await discardBookingPageDraft(ada.scope, { pageId: made.id });
    expect(discarded.description).toBe('');
    expect(discarded.publication).toBeUndefined();
  });

  it('refuses a broken draft at Publish, naming the setting to fix, and publishes nothing', async () => {
    const ada = await person('Ada');
    const made = await page(ada.scope);
    await saveBookingPageDraft(ada.scope, { pageId: made.id, settings: { title: 'Intro call' } });
    // A schedule that isn't the owner's: refused as a save refuses it.
    await db.withWorkspace(ada.workspaceId, (tx) =>
      tx.execute(
        sql`update booking_pages set draft = draft || ${JSON.stringify({ scheduleId: newId() })}::jsonb where id = ${made.id}`,
      ),
    );
    const refused = await refusalOf(publishBookingPage(ada.scope, { pageId: made.id }));
    expect(refused?.code).toBeDefined();
    expect(refused?.code).not.toBe('thrown');
    // Nothing published, the draft kept to fix.
    expect((await guestsSee(ada.workspaceId, made.id))?.title).toBe('Intro');
    expect((await getBookingPage(ada.scope, { pageId: made.id })).publication?.changes.length).toBeGreaterThan(0);
    expect((await listBookingPageVersions(ada.scope, { pageId: made.id })).versions).toHaveLength(1);
  });

  it('drafts what happens after booking, the cutoffs, confirming first and links only, and Publish checks them', async () => {
    const ada = await person('Ada');
    const made = await page(ada.scope);
    const drafted = await saveBookingPageDraft(ada.scope, {
      pageId: made.id,
      settings: {
        requiresConfirmation: true,
        cancelCutoffMinutes: 120,
        moveCutoffMinutes: 60,
        linksOnly: true,
        afterBooking: 'redirect',
      },
    });
    // The editor shows the draft and names each change; guests (the slot engine, every public read) see none of it.
    expect(drafted.requiresConfirmation).toBe(true);
    expect(drafted.publication?.changes).toEqual([
      'Bookings wait for your confirmation',
      'After booking Confirmation page → Redirect',
      'Cancel cutoff none → 2 h',
      'Move cutoff none → 1 h',
      'Books only through one-time links',
    ]);
    const before = await guestsSee(ada.workspaceId, made.id);
    expect(before).toMatchObject({
      requiresConfirmation: false,
      cancelCutoffMinutes: 0,
      moveCutoffMinutes: 0,
      linksOnly: false,
      afterBooking: 'confirmation',
    });
    // A redirect with nowhere to send visitors: Publish runs the save's check, names the setting and publishes nothing.
    const refused = await refusalOf(publishBookingPage(ada.scope, { pageId: made.id }));
    expect(refused).toEqual({ code: 'VALUE_REQUIRED', field: 'redirectUrl' });
    expect((await guestsSee(ada.workspaceId, made.id))?.linksOnly).toBe(false);
    await saveBookingPageDraft(ada.scope, {
      pageId: made.id,
      settings: { redirectUrl: 'https://example.com/thanks', sendBookingDetails: true },
    });
    const published = await publishBookingPage(ada.scope, { pageId: made.id });
    expect(published.publication).toBeUndefined();
    expect(await guestsSee(ada.workspaceId, made.id)).toMatchObject({
      requiresConfirmation: true,
      cancelCutoffMinutes: 120,
      moveCutoffMinutes: 60,
      linksOnly: true,
      afterBooking: 'redirect',
      redirectUrl: 'https://example.com/thanks',
      sendBookingDetails: true,
    });
  });

  it('brings a version back as a draft, and keeps only the last 20 (AC-6812)', async () => {
    const ada = await person('Ada');
    const made = await page(ada.scope);
    for (let round = 1; round <= 21; round += 1) {
      await saveBookingPageDraft(ada.scope, { pageId: made.id, settings: { title: `Intro ${String(round)}` } });
      await publishBookingPage(ada.scope, { pageId: made.id });
    }
    const { versions } = await listBookingPageVersions(ada.scope, { pageId: made.id });
    expect(versions).toHaveLength(20);
    expect(versions[0]?.version).toBe(22);
    expect(versions.at(-1)?.version).toBe(3);
    expect((await refusalOf(restoreBookingPageVersion(ada.scope, { pageId: made.id, version: 1 })))?.code).toBe(
      'NOT_FOUND',
    );
    const restored = await restoreBookingPageVersion(ada.scope, { pageId: made.id, version: 3 });
    expect(restored.title).toBe('Intro 2');
    expect(restored.publication?.changes).toEqual(['Title “Intro 21” → “Intro 2”']);
    expect((await guestsSee(ada.workspaceId, made.id))?.title).toBe('Intro 21');
  });

  it('keeps instant settings instant, and a draft beside them (AC-6813)', async () => {
    const ada = await person('Ada');
    const made = await page(ada.scope);
    await saveBookingPageDraft(ada.scope, { pageId: made.id, settings: { title: 'Intro call' } });
    const paused = await updateBookingPage(ada.scope, { pageId: made.id, settings: { status: 'paused' } });
    expect(paused.status).toBe('paused');
    expect(paused.title).toBe('Intro call');
    expect((await guestsSee(ada.workspaceId, made.id))?.status).toBe('paused');
    expect((await guestsSee(ada.workspaceId, made.id))?.title).toBe('Intro');
    // Pausing keeps no version; a save of what guests see straight to the page (outside the editor) keeps one.
    expect((await listBookingPageVersions(ada.scope, { pageId: made.id })).versions).toHaveLength(1);
    await updateBookingPage(ada.scope, { pageId: made.id, settings: { durations: [60] } });
    expect((await listBookingPageVersions(ada.scope, { pageId: made.id })).versions).toHaveLength(2);
  });

  it('answers NOT_FOUND for another member’s page and another workspace’s, and their versions never cross', async () => {
    const ada = await person('Ada');
    const made = await page(ada.scope);
    const bea = await colleague(ada.workspaceId, 'Bea');
    const other = await person('Cy');
    for (const scope of [bea, other.scope]) {
      expect((await refusalOf(saveBookingPageDraft(scope, { pageId: made.id, settings: { title: 'x' } })))?.code).toBe(
        'NOT_FOUND',
      );
      expect((await refusalOf(publishBookingPage(scope, { pageId: made.id })))?.code).toBe('NOT_FOUND');
      expect((await refusalOf(listBookingPageVersions(scope, { pageId: made.id })))?.code).toBe('NOT_FOUND');
    }
    const seen = await db.withWorkspace(other.workspaceId, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from page_versions where page_id = ${made.id}`),
    );
    expect(seen.rows[0]?.n).toBe(0);
  });
});
