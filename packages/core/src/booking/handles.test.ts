// Handles and handle addresses (22 Oct 2026), against the real Postgres: claiming a handle (shape, reserved words,
// uniqueness everywhere), an old handle that keeps finding its person, a slug unique per person across workspaces,
// `/<handle>/<slug>` naming exactly one page, the profile's Public links a page at a time, and the fence: the app
// role reads none of schema auth itself.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingAddress, enterBookingPage, enterBookingProfile, readHandleOffer } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { getMyProfile, updateMyMemberProfile } from '../members/profile.ts';
import { testScope } from '../testing.ts';
import { createBookingPage, deleteBookingPage, updateBookingPage } from './pages.ts';
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
    expect(await readAddressedPage(entry)).toEqual({ publicKey: made.publicKey, handle, slug: made.slug });
    const renamed = fresh('lovelace');
    await updateMyMemberProfile(ada.scope, { handle: renamed });
    expect(await readAddressedPage(await enterBookingAddress({ db }, handle, made.slug))).toEqual({
      publicKey: made.publicKey,
      handle: renamed,
      slug: made.slug,
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

/** The refusal message a promise rejects with. */
async function refusalMessage(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return isRefusal(error) ? error.refusal.message : 'thrown';
  }
}

describe('slug history (22 Oct 2026)', () => {
  const rename = (scope: ReturnType<typeof testScope>, pageId: string, slug: string) =>
    updateBookingPage(scope, { pageId, settings: { slug } });

  it('keeps an old slug’s address finding the page, which answers its current address', async () => {
    const ada = await person('Ada');
    const handle = fresh('ada');
    await updateMyMemberProfile(ada.scope, { handle });
    const made = await page(ada.scope, 'Intro call');
    await rename(ada.scope, made.id, 'meet');
    const moved = { publicKey: made.publicKey, handle, slug: 'meet' };
    expect(await readAddressedPage(await enterBookingAddress({ db }, handle, made.slug))).toEqual(moved);
    expect(await readAddressedPage(await enterBookingAddress({ db }, handle, 'meet'))).toEqual(moved);
    // An old handle and an old slug together still find it.
    const renamed = fresh('lovelace');
    await updateMyMemberProfile(ada.scope, { handle: renamed });
    expect(await readAddressedPage(await enterBookingAddress({ db }, handle, made.slug))).toEqual({
      ...moved,
      handle: renamed,
    });
  });

  it('refuses an old slug to another page of the person’s, in any workspace, but lets its own page take it back', async () => {
    const ada = await person('Ada');
    const elsewhere = await person('Ada', ada.userId);
    const made = await page(ada.scope, 'Intro call');
    await rename(ada.scope, made.id, 'meet');
    const other = await page(elsewhere.scope, 'Other');
    const refused = rename(elsewhere.scope, other.id, made.slug);
    expect(await refusalMessage(refused)).toBe(
      'Another of your booking pages used this address before, so it stays with that page. Pick another.',
    );
    expect(await refusalOf(rename(ada.scope, other.id, made.slug))).toBe('NOT_FOUND');
    // A new page's default slug skips it too.
    expect((await page(elsewhere.scope, 'Intro call')).slug).toBe(`${made.slug}-2`);
    expect((await rename(ada.scope, made.id, made.slug)).slug).toBe(made.slug);
  });

  it('keeps 20 old slugs, then lets the oldest go', async () => {
    const ada = await person('Ada');
    const handle = fresh('ada');
    await updateMyMemberProfile(ada.scope, { handle });
    const made = await page(ada.scope, 'Intro call');
    for (let n = 1; n <= 21; n += 1) await rename(ada.scope, made.id, `intro-${String(n)}`);
    expect(await refusalOf(enterBookingAddress({ db }, handle, made.slug))).toBe('NOT_FOUND');
    expect((await readAddressedPage(await enterBookingAddress({ db }, handle, 'intro-1'))).slug).toBe('intro-21');
    expect((await page(ada.scope, 'Again', { slug: made.slug })).slug).toBe(made.slug);
  });

  it('never answers an old slug of a Link only page', async () => {
    const ada = await person('Ada');
    const handle = fresh('ada');
    await updateMyMemberProfile(ada.scope, { handle });
    const made = await page(ada.scope, 'Intro call');
    await rename(ada.scope, made.id, 'meet');
    await updateBookingPage(ada.scope, { pageId: made.id, settings: { isPrivate: true } });
    expect(await refusalOf(enterBookingAddress({ db }, handle, made.slug))).toBe('NOT_FOUND');
    expect(await refusalOf(enterBookingAddress({ db }, handle, 'meet'))).toBe('NOT_FOUND');
  });

  it('goes with the page when it is deleted, freeing its old slugs', async () => {
    const ada = await person('Ada');
    const handle = fresh('ada');
    await updateMyMemberProfile(ada.scope, { handle });
    const made = await page(ada.scope, 'Intro call');
    await rename(ada.scope, made.id, 'meet');
    await deleteBookingPage(ada.scope, { pageId: made.id });
    expect(await refusalOf(enterBookingAddress({ db }, handle, made.slug))).toBe('NOT_FOUND');
    expect(await refusalOf(enterBookingAddress({ db }, handle, 'meet'))).toBe('NOT_FOUND');
    expect((await page(ada.scope, 'Again', { slug: made.slug })).slug).toBe(made.slug);
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

  it('marks each workspace’s links with their own opaque group, the same on every read (owner ask, 24 Oct)', async () => {
    const ada = await person('Ada');
    const handle = fresh('split');
    await updateMyMemberProfile(ada.scope, { handle });
    const other = await person('Ada', ada.userId);
    await page(ada.scope, 'Quick chat', { profilePosition: 0 });
    await page(other.scope, 'Brijraj', { profilePosition: 0 });
    await page(ada.scope, 'Pitch', { profilePosition: 1, profileSection: 'Sales' });
    await page(other.scope, 'Demo', { profilePosition: 1, profileSection: 'Sales' });
    const read = async (search?: string) =>
      readBookingProfile(
        await enterBookingProfile({ db }, handle, { ...(search === undefined ? {} : { search }), max: 21 }),
      );
    const profile = await read();
    const groupOf = (title: string) => profile.links.find((link) => link.title === title)?.group;
    expect(groupOf('Quick chat')).toMatch(/^[0-9a-f]{16}$/);
    expect(groupOf('Pitch')).toBe(groupOf('Quick chat'));
    expect(groupOf('Demo')).toBe(groupOf('Brijraj'));
    expect(groupOf('Brijraj')).not.toBe(groupOf('Quick chat'));
    // Never the workspace itself.
    const body = JSON.stringify(profile);
    for (const workspace of [ada, other]) {
      expect(body).not.toContain(workspace.workspaceId);
      expect(body).not.toContain(workspace.workspaceId.replaceAll('-', ''));
    }
    expect(body).not.toContain('Handles');
    // Stable across reads, so a group read on a later page (or by a search) joins its cards.
    expect((await read('demo')).links.map((link) => link.group)).toEqual([groupOf('Demo')]);
  });

  it('is NOT_FOUND for a handle no one holds', async () => {
    expect(await refusalOf(enterBookingProfile({ db }, fresh('nobody'), { max: 5 }))).toBe('NOT_FOUND');
  });
});

/*
 * Whether an address is free (25 Oct 2026), and the one rule that matters: `free` only for a handle genuinely
 * nobody holds, and a handle somebody holds reads exactly as a word kept for Timefix does, whether or not
 * anything of theirs is public. Not because that keeps a secret (it cannot: the reserved words ship in the
 * browser, and a handle somebody holds answers with their profile anyway), but so the offer is only ever made for
 * an address a visitor could really take.
 */
describe('a free address', () => {
  it('is free for a handle nobody holds', async () => {
    expect(await readHandleOffer({ db }, fresh('nobody'))).toBe('free');
  });

  it('is absent for a handle somebody holds', async () => {
    const ada = await person('Ada');
    const handle = fresh('ada');
    await updateMyMemberProfile(ada.scope, { handle });
    expect(await readHandleOffer({ db }, handle)).toBe('absent');
  });

  it('is absent for a handle whose pages are all unlisted, exactly as a reserved word is', async () => {
    const ada = await person('Ada');
    const handle = fresh('quiet');
    await updateMyMemberProfile(ada.scope, { handle });
    // A Link only page: it works by its own key but is never on the profile, so there is nothing public here.
    await page(ada.scope, 'Hidden', { isPrivate: true });
    const held = await readHandleOffer({ db }, handle);
    expect(held).toBe('absent');
    // The one claim this test exists for: held but unlisted and reserved are the same answer, not two, so the
    // offer is never made for either.
    expect(held).toBe(await readHandleOffer({ db }, 'settings'));
    expect(held).toBe(await readHandleOffer({ db }, 'book'));
    // The profile read itself still answers the profile, with no links: unlisted pages are absent, not locked.
    expect((await readBookingProfile(await enterBookingProfile({ db }, handle, { max: 5 }))).links).toEqual([]);
  });

  it('offers only an address the claim then accepts, and that address stops being free once claimed', async () => {
    const ada = await person('Ada');
    const handle = fresh('ada');
    expect(await readHandleOffer({ db }, handle)).toBe('free');
    // What `free` promised: the claim goes through, with the same checks the offer made.
    expect(await updateMyMemberProfile(ada.scope, { handle })).toMatchObject({ handle });
    expect(await readHandleOffer({ db }, handle)).toBe('absent');
  });

  it('is absent for an old handle its person still holds', async () => {
    const ada = await person('Ada');
    const first = fresh('first');
    await updateMyMemberProfile(ada.scope, { handle: first });
    await updateMyMemberProfile(ada.scope, { handle: fresh('second') });
    expect(await readHandleOffer({ db }, first)).toBe('absent');
  });

  it('is absent for every word kept for Timefix, and for anything no handle could be', async () => {
    for (const reserved of ['settings', 'api', 'book', 'admin', 'sign-up', 'www']) {
      expect(await readHandleOffer({ db }, reserved)).toBe('absent');
    }
    for (const malformed of ['ab', 'Ada', 'has_underscore', '-leading', 'trailing-', 'a'.repeat(41), '']) {
      expect(await readHandleOffer({ db }, malformed)).toBe('absent');
    }
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
