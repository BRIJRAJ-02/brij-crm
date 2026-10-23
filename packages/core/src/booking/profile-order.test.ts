// A profile's order (owner ask A102, 22 Oct 2026), against the real Postgres: the owner's pages put in a new order in
// one write, dense from 0 with their other pages after them, the profile at /<handle> listing them so at once, new
// pages joining the end, one audit entry per move that moved something, and the fence: another member's page, a page
// in another workspace and a deleted one are all refused as NOT_FOUND, with nothing changed.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingProfile } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { updateMyMemberProfile } from '../members/profile.ts';
import { testScope } from '../testing.ts';
import { createBookingPage, deleteBookingPage, listBookingPages, reorderProfilePages } from './pages.ts';
import { readBookingProfile } from './public.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-profile-order-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;

/** A person who can sign in, and a workspace of theirs (or another one of the same person's), as its owner. */
async function person(name: string, userId: string = randomUUID()) {
  count += 1;
  await testQuery(
    ownerUrl,
    `insert into auth."user" (id, name, email) values ($1, $2, $3) on conflict (id) do nothing`,
    [userId, name, `${userId}@example.com`],
  );
  const created = await createWorkspace(db, {
    name: 'Profile order',
    slug: `profile-order-${String(count)}-${String(Date.now())}`,
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

/** A second person in `workspaceId`, a plain member. */
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
  return { memberId, scope: testScope({ db, workspaceId, actor: { type: 'member', id: memberId }, role: 'member' }) };
}

/** A unique handle for this run. */
const fresh = (stem: string) => `${stem}-${randomUUID().slice(0, 8)}`;

const page = (scope: ReturnType<typeof testScope>, title: string, settings = {}) =>
  createBookingPage(scope, { id: newId(), title, timeZone: 'Europe/London', settings });

/** The refusal code a promise rejects with. */
async function refusalOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return isRefusal(error) ? error.refusal.code : 'thrown';
  }
}

/** Each of the reader's pages by title, with its place on the profile. */
async function places(scope: ReturnType<typeof testScope>): Promise<Record<string, number>> {
  const pages = await listBookingPages(scope);
  return Object.fromEntries(pages.map((each) => [each.title, each.profilePosition]));
}

/** The audit entries of profile reorders in a workspace, oldest first. */
function reorders(workspaceId: string) {
  return testQuery<{ target_type: string; target_id: string; before: unknown; after: unknown }>(
    ownerUrl,
    `select target_type, target_id, before, after from audit_events
     where workspace_id = $1 and action = 'booking_page.profile_reordered' order by at, id`,
    [workspaceId],
  );
}

describe('a profile’s order', () => {
  it('puts the owner’s pages in the order given, dense from 0, and the profile lists them so at once', async () => {
    const ada = await person('Ada');
    const handle = fresh('ada');
    await updateMyMemberProfile(ada.scope, { handle });
    const intro = await page(ada.scope, 'Intro', { profileSection: 'Sales' });
    const coffee = await page(ada.scope, 'Coffee');
    const demo = await page(ada.scope, 'Demo', { profileSection: 'Sales' });
    const hidden = await page(ada.scope, 'Hidden', { isPrivate: true });
    const off = await page(ada.scope, 'Off', { status: 'paused' });
    // Each new page joined the end.
    expect(await places(ada.scope)).toEqual({ Intro: 0, Coffee: 1, Demo: 2, Hidden: 3, Off: 4 });

    const answer = await reorderProfilePages(ada.scope, { pageIds: [demo.id, intro.id, off.id, coffee.id] });
    // The pages named first, then the rest (the Link only page) after them.
    expect(answer.pages.map((each) => [each.id, each.profilePosition])).toEqual([
      [demo.id, 0],
      [intro.id, 1],
      [off.id, 2],
      [coffee.id, 3],
      [hidden.id, 4],
    ]);
    expect(answer.pages.every((each) => !Number.isNaN(Date.parse(each.updatedAt)))).toBe(true);
    expect(await places(ada.scope)).toEqual({ Demo: 0, Intro: 1, Off: 2, Coffee: 3, Hidden: 4 });

    // The profile reads the new order at once: Sales first (its first page leads), then the page with no section.
    const profile = await readBookingProfile(await enterBookingProfile({ db }, handle, { max: 21 }));
    expect(profile.links.map((link) => [link.title, link.section])).toEqual([
      ['Demo', 'Sales'],
      ['Intro', 'Sales'],
      ['Coffee', undefined],
    ]);

    // One audit entry, on the person, naming the pages' order before and after.
    expect(await reorders(ada.workspaceId)).toEqual([
      {
        target_type: 'member',
        target_id: ada.memberId,
        before: { pageIds: [intro.id, coffee.id, demo.id, off.id] },
        after: { pageIds: [demo.id, intro.id, off.id, coffee.id], moved: 5 },
      },
    ]);
  });

  it('changes nothing for the order it already has, and a new page joins the end', async () => {
    const ada = await person('Ada');
    const one = await page(ada.scope, 'One');
    const two = await page(ada.scope, 'Two');
    const first = await reorderProfilePages(ada.scope, { pageIds: [two.id, one.id] });
    const again = await reorderProfilePages(ada.scope, { pageIds: [two.id, one.id] });
    // Nothing moved: the same versions, and no second audit entry.
    expect(again).toEqual(first);
    expect(await reorders(ada.workspaceId)).toHaveLength(1);
    await page(ada.scope, 'Three');
    expect(await places(ada.scope)).toEqual({ Two: 0, One: 1, Three: 2 });
    // Naming only some pages puts them first; the others keep their order after them.
    await reorderProfilePages(ada.scope, { pageIds: [one.id] });
    expect(await places(ada.scope)).toEqual({ One: 0, Two: 1, Three: 2 });
  });
});

describe('what a profile’s order may name', () => {
  it('refuses another member’s page, even to the workspace’s owner, and changes nothing', async () => {
    const ada = await person('Ada');
    const bob = await colleague(ada.workspaceId, 'Bob');
    const adas = await page(ada.scope, 'Ada call');
    const bobs = await page(bob.scope, 'Bob call');
    const bobsOther = await page(bob.scope, 'Bob later');
    expect(await refusalOf(reorderProfilePages(ada.scope, { pageIds: [bobsOther.id, bobs.id] }))).toBe('NOT_FOUND');
    expect(await refusalOf(reorderProfilePages(ada.scope, { pageIds: [adas.id, bobs.id] }))).toBe('NOT_FOUND');
    expect(await refusalOf(reorderProfilePages(bob.scope, { pageIds: [adas.id] }))).toBe('NOT_FOUND');
    expect(await places(ada.scope)).toEqual({ 'Ada call': 0, 'Bob call': 0, 'Bob later': 1 });
    expect(await reorders(ada.workspaceId)).toEqual([]);
    // Bob's own order is his to set.
    await reorderProfilePages(bob.scope, { pageIds: [bobsOther.id, bobs.id] });
    expect(await places(bob.scope)).toEqual({ 'Bob later': 0, 'Bob call': 1 });
  });

  it('answers a page in another workspace, or a deleted one, as absent', async () => {
    const ada = await person('Ada');
    const elsewhere = await person('Ada', ada.userId);
    const here = await page(ada.scope, 'Here');
    const there = await page(elsewhere.scope, 'There');
    expect(await refusalOf(reorderProfilePages(ada.scope, { pageIds: [here.id, there.id] }))).toBe('NOT_FOUND');
    expect(await refusalOf(reorderProfilePages(ada.scope, { pageIds: [there.id] }))).toBe('NOT_FOUND');
    const gone = await page(ada.scope, 'Gone');
    await deleteBookingPage(ada.scope, { pageId: gone.id });
    expect(await refusalOf(reorderProfilePages(ada.scope, { pageIds: [gone.id, here.id] }))).toBe('NOT_FOUND');
    expect(await places(elsewhere.scope)).toEqual({ There: 0 });
  });

  it('refuses a page named twice, or none, from a caller that skipped the contract', async () => {
    const ada = await person('Ada');
    const one = await page(ada.scope, 'One');
    expect(await refusalOf(reorderProfilePages(ada.scope, { pageIds: [one.id, one.id] }))).toBe('CONFIG_INVALID');
    expect(await refusalOf(reorderProfilePages(ada.scope, { pageIds: [] }))).toBe('CONFIG_INVALID');
  });
});
