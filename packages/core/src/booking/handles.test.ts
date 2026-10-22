// Handles and handle addresses (22 Oct 2026), against the real Postgres: claiming a handle (shape, reserved words,
// uniqueness everywhere), an old handle that keeps finding its person, a slug unique per person across workspaces,
// `/<handle>/<slug>` naming exactly one page, the profile's Public links a page at a time, and the fence: the app
// role reads none of schema auth itself.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingAddress, enterBookingPage, enterBookingProfile } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { getMyProfile, updateMyMemberProfile } from '../members/profile.ts';
import { testScope } from '../testing.ts';
import { createBookingPage, updateBookingPage } from './pages.ts';
import { getPublicBookingPage, readAddressedPage, readBookingProfile } from './public.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-handles-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;

/** A person who can sign in, and a workspace of theirs (or another one), as its owner. */
async function person(name: string, userId: string = randomUUID()) {
  count += 1;
  await testQuery(
    ownerUrl,
    `insert into auth."user" (id, name, email) values ($1, $2, $3) on conflict (id) do nothing`,
    [userId, name, `${userId}@example.com`],
  );
  const created = await createWorkspace(db, {
    name: 'Handles',
    slug: `handles-${String(count)}-${String(Date.now())}`,
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

/** A unique handle for this run. */
const fresh = (stem: string) => `${stem}-${randomUUID().slice(0, 8)}`;

/** The refusal code a promise rejects with. */
async function refusalOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return isRefusal(error) ? error.refusal.code : 'thrown';
  }
}

const page = (scope: ReturnType<typeof testScope>, title: string, settings = {}) =>
  createBookingPage(scope, { id: newId(), title, timeZone: 'Europe/London', settings });

describe('a handle', () => {
  it('starts as a suggestion from the name, and is claimed by saving it', async () => {
    const ada = await person('Ada Lovelace');
    const before = await getMyProfile(ada.scope);
    expect(before.handle).toBeUndefined();
    expect(before.suggestedHandle).toMatch(/^ada-lovelace(-\d)?$/);
    const handle = fresh('ada');
    const after = await updateMyMemberProfile(ada.scope, { handle, bio: 'Product at Acme.' });
    expect(after).toMatchObject({ handle, bio: 'Product at Acme.' });
  });

  it('refuses a reserved word, a bad shape, and a bio before any handle', async () => {
    const ada = await person('Ada');
    expect(await refusalOf(updateMyMemberProfile(ada.scope, { handle: 'settings' }))).toBe('CONFIG_INVALID');
    expect(await refusalOf(updateMyMemberProfile(ada.scope, { handle: 'ab' }))).toBe('CONFIG_INVALID');
    expect(await refusalOf(updateMyMemberProfile(ada.scope, { handle: 'Bad_Handle' }))).toBe('CONFIG_INVALID');
    expect(await refusalOf(updateMyMemberProfile(ada.scope, { bio: 'Hello' }))).toBe('VALUE_REQUIRED');
  });

  it('is unique everywhere, an old one included, and an old one keeps finding its person', async () => {
    const ada = await person('Ada');
    const bob = await person('Bob');
    const first = fresh('first');
    const second = fresh('second');
    await updateMyMemberProfile(ada.scope, { handle: first });
    expect(await refusalOf(updateMyMemberProfile(bob.scope, { handle: first }))).toBe('SLUG_TAKEN');
    await updateMyMemberProfile(ada.scope, { handle: second });
    // Ada's old handle is still hers: Bob can't take it, and it answers with her current one.
    expect(await refusalOf(updateMyMemberProfile(bob.scope, { handle: first }))).toBe('SLUG_TAKEN');
    const found = await enterBookingProfile({ db }, first, { max: 5 });
    expect(found.owner.handle).toBe(second);
    // And she can go back to it.
    expect(await updateMyMemberProfile(ada.scope, { handle: first })).toMatchObject({ handle: first });
  });

  it('is the same in each of the person’s workspaces', async () => {
    const ada = await person('Ada');
    const handle = fresh('ada');
    await updateMyMemberProfile(ada.scope, { handle });
    const other = await person('Ada', ada.userId);
    expect((await getMyProfile(other.scope)).handle).toBe(handle);
  });
});

describe('a handle address', () => {
  it('names one page by /<handle>/<slug>, by an old handle too, and nothing else', async () => {
    const ada = await person('Ada');
    const made = await page(ada.scope, 'Intro call');
    expect(made.handle).toBeUndefined();
    const handle = fresh('ada');
    await updateMyMemberProfile(ada.scope, { handle });
    const entry = await enterBookingAddress({ db }, handle, made.slug);
    expect(await readAddressedPage(entry)).toEqual({ publicKey: made.publicKey, handle });
    const renamed = fresh('lovelace');
    await updateMyMemberProfile(ada.scope, { handle: renamed });
    expect(await readAddressedPage(await enterBookingAddress({ db }, handle, made.slug))).toEqual({
      publicKey: made.publicKey,
      handle: renamed,
    });
    expect(await refusalOf(enterBookingAddress({ db }, renamed, 'no-such-page'))).toBe('NOT_FOUND');
    expect(await refusalOf(enterBookingAddress({ db }, fresh('nobody'), made.slug))).toBe('NOT_FOUND');
    expect(await refusalOf(enterBookingAddress({ db }, 'settings', made.slug))).toBe('NOT_FOUND');
    // The page's own facts carry its address, so a plain /b/<key> visit moves there.
    const facts = await getPublicBookingPage(await enterBookingPage({ db }, made.publicKey));
    expect(facts.path).toBe(`/${renamed}/${made.slug}`);
  });

  it('never answers for a Link only page: it keeps its random /b/<key> link alone', async () => {
    const ada = await person('Ada');
    const handle = fresh('ada');
    await updateMyMemberProfile(ada.scope, { handle });
    const hidden = await page(ada.scope, 'Reserved', { isPrivate: true });
    expect(hidden.handle).toBe(handle);
    expect(await refusalOf(enterBookingAddress({ db }, handle, hidden.slug))).toBe('NOT_FOUND');
    const facts = await getPublicBookingPage(await enterBookingPage({ db }, hidden.publicKey));
    expect(facts.path).toBeUndefined();
  });

  it('keeps a slug unique per person across workspaces, so each address names one page', async () => {
    const ada = await person('Ada');
    const elsewhere = await person('Ada', ada.userId);
    const one = await page(ada.scope, 'Sync');
    const two = await page(elsewhere.scope, 'Sync');
    expect(one.slug).toBe('sync');
    expect(two.slug).toBe('sync-2');
    expect(await refusalOf(updateBookingPage(elsewhere.scope, { pageId: two.id, settings: { slug: 'sync' } }))).toBe(
      'SLUG_TAKEN',
    );
  });

  it('lets two people in one workspace use the same slug', async () => {
    const ada = await person('Ada');
    const bobId = randomUUID();
    await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, 'Bob', $2)`, [
      bobId,
      `${bobId}@example.com`,
    ]);
    const bobMember = newId();
    await db.withWorkspace(ada.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type) values (${ada.workspaceId}, ${bobMember}, ${bobId}, 'Bob', ${`${bobId}@example.com`}, 'member', 'system', 'system')`,
      ),
    );
    const bob = testScope({
      db,
      workspaceId: ada.workspaceId,
      actor: { type: 'member', id: bobMember },
      role: 'member',
      userId: bobId,
    });
    expect((await page(ada.scope, 'Chat')).slug).toBe('chat');
    expect((await page(bob, 'Chat')).slug).toBe('chat');
  });
});

describe('what a workspace may publish under a person', () => {
  it('lets only the owner change a page’s address and place on their profile', async () => {
    const ada = await person('Ada');
    const bobId = randomUUID();
    await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, 'Bob', $2)`, [
      bobId,
      `${bobId}@example.com`,
    ]);
    const bobMember = newId();
    await db.withWorkspace(ada.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type) values (${ada.workspaceId}, ${bobMember}, ${bobId}, 'Bob', ${`${bobId}@example.com`}, 'member', 'system', 'system')`,
      ),
    );
    const bobsPage = await page(
      testScope({ db, workspaceId: ada.workspaceId, actor: { type: 'member', id: bobMember }, role: 'member' }),
      'Bob call',
    );
    // Ada owns the workspace and may change Bob's page, but not what is published under Bob's name.
    expect(
      await refusalOf(updateBookingPage(ada.scope, { pageId: bobsPage.id, settings: { slug: 'taken-over' } })),
    ).toBe('FORBIDDEN');
    expect(
      await refusalOf(updateBookingPage(ada.scope, { pageId: bobsPage.id, settings: { profilePosition: 1 } })),
    ).toBe('FORBIDDEN');
    expect((await updateBookingPage(ada.scope, { pageId: bobsPage.id, settings: { title: 'Renamed' } })).title).toBe(
      'Renamed',
    );
  });

  it('stops addressing and listing a page once its owner has left that workspace', async () => {
    const ada = await person('Ada');
    const handle = fresh('gone');
    await updateMyMemberProfile(ada.scope, { handle });
    // Ada joins Bob's workspace as a member, and makes a page there.
    const bob = await person('Bob');
    const adaThere = newId();
    await db.withWorkspace(bob.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type) values (${bob.workspaceId}, ${adaThere}, ${ada.userId}, 'Ada', ${`${ada.userId}@example.com`}, 'member', 'system', 'system')`,
      ),
    );
    const made = await page(
      testScope({ db, workspaceId: bob.workspaceId, actor: { type: 'member', id: adaThere }, role: 'member' }),
      'Elsewhere',
    );
    expect((await readAddressedPage(await enterBookingAddress({ db }, handle, made.slug))).publicKey).toBe(
      made.publicKey,
    );
    await db.withWorkspace(bob.workspaceId, (tx) =>
      tx.execute(
        sql`update members set status = 'removed', left_at = now(), removed_by_type = 'system' where id = ${adaThere}`,
      ),
    );
    expect(await refusalOf(enterBookingAddress({ db }, handle, made.slug))).toBe('NOT_FOUND');
    const profile = await readBookingProfile(await enterBookingProfile({ db }, handle, { max: 21 }));
    expect(profile.links.map((link) => link.slug)).not.toContain(made.slug);
  });
});

describe('a profile', () => {
  it('lists the person’s Public, live pages in their order, a page at a time, and finds them by title', async () => {
    const ada = await person('Ada Lovelace');
    const handle = fresh('ada');
    await updateMyMemberProfile(ada.scope, { handle, bio: 'Hi.' });
    await page(ada.scope, 'Later', { profilePosition: 5 });
    await page(ada.scope, 'First', { profilePosition: 1, profileSection: 'Sales' });
    await page(ada.scope, 'Hidden', { isPrivate: true });
    await page(ada.scope, 'Off', { status: 'paused' });
    const read = async (query: { after?: { position: number; id: string }; search?: string }) =>
      readBookingProfile(await enterBookingProfile({ db }, handle, { ...query, max: 21 }));
    const profile = await read({});
    expect(profile).toMatchObject({ handle, name: 'Ada Lovelace', initials: 'AL', bio: 'Hi.' });
    expect(profile.links.map((link) => link.title)).toEqual(['First', 'Later']);
    expect(profile.links[0]).toMatchObject({ slug: 'first', section: 'Sales', durations: [30], isTeam: false });
    expect(profile.next).toBeUndefined();
    expect((await read({ search: 'lat' })).links.map((link) => link.title)).toEqual(['Later']);
  });

  it('pages past 20 links with a cursor, never reading them all', async () => {
    const ada = await person('Ada');
    const handle = fresh('many');
    await updateMyMemberProfile(ada.scope, { handle });
    for (let n = 0; n < 22; n += 1) await page(ada.scope, `Link ${String(n)}`);
    const first = await readBookingProfile(await enterBookingProfile({ db }, handle, { max: 21 }));
    expect(first.links).toHaveLength(20);
    expect(first.next).toBeDefined();
    const [position, id] = (first.next ?? '').split('.');
    const rest = await readBookingProfile(
      await enterBookingProfile({ db }, handle, { after: { position: Number(position), id: id ?? '' }, max: 21 }),
    );
    expect(rest.links).toHaveLength(2);
    expect(rest.next).toBeUndefined();
  });

  it('is NOT_FOUND for a handle no one holds', async () => {
    expect(await refusalOf(enterBookingProfile({ db }, fresh('nobody'), { max: 5 }))).toBe('NOT_FOUND');
  });
});

describe('the fence', () => {
  it('leaves schema auth closed to the app role: handles are read only through their functions', async () => {
    await expect(
      db.withWorkspace(randomUUID(), (tx) => tx.execute(sql`select handle from auth.public_handles`)),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    await expect(
      db.withWorkspace(randomUUID(), (tx) => tx.execute(sql`select bio from auth.public_profiles`)),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });
});
