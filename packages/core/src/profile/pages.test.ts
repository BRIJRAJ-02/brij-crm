// Several link pages (spec 0064, slice 2, AC-6413 to AC-6417), against the real Postgres: up to 5 pages per person and
// workspace, each with its own handle, name, blocks, look and numbers; the handle rules of spec 0056 kept; the primary
// page and Make primary; delete asking for a page that isn't the only one and keeping its handle reserved; and every
// call that names no page reading and writing the primary page, exactly as before.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { DEFAULT_PAGE_THEME, type ProfileBlock } from '@crm/contracts';
import { countProfileView, enterLinkPage, findHandleOwner, readHandleOffer } from '../access/door.ts';
import { publicProfilesOf } from '../booking/handles.ts';
import { inWorkspace } from '../access/run.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { getMyProfile, updateMyMemberProfile } from '../members/profile.ts';
import { testScope } from '../testing.ts';
import { readProfileCounts, readProfileItems, saveProfileItem, saveProfileTheme } from './items.ts';
import { createLinkPage, deleteLinkPage, listLinkPages, renameLinkPage, setPrimaryLinkPage } from './pages.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-link-pages-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
const fresh = (stem: string) => `${stem}-${randomUUID().slice(0, 8)}`;

/** A person, a workspace of theirs and their first page there (their primary page), as the app makes them. */
async function person(name: string) {
  count += 1;
  const userId = randomUUID();
  await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, $2, $3)`, [
    userId,
    name,
    `${userId}@example.com`,
  ]);
  const created = await createWorkspace(db, {
    name: 'Pages',
    slug: `pages-${String(count)}-${String(Date.now())}`,
    firstMember: { name, email: `${userId}@example.com`, userId },
  });
  const scope = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    userId,
  });
  const handle = fresh('first');
  await updateMyMemberProfile(scope, { handle });
  return { ...created, userId, scope, handle };
}

const link = (title: string): ProfileBlock => ({ kind: 'link', title, url: `https://${title.toLowerCase()}.dev` });

async function refusalOf(promise: Promise<unknown>): Promise<{ code: string; message: string } | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isRefusal(error)) return { code: error.refusal.code, message: error.refusal.message };
    throw error;
  }
}

describe('several link pages (spec 0064)', () => {
  it('lists the first page as the primary one, and makes up to 5, refusing a sixth (AC-6413)', async () => {
    const ada = await person('Ada');
    const [first] = await listLinkPages(ada.scope);
    expect(first).toMatchObject({ handle: ada.handle, isPrimary: true, isPublic: true, name: '' });
    for (let n = 2; n <= 5; n += 1) {
      await createLinkPage(ada.scope, { id: newId(), handle: fresh(`page-${String(n)}`), name: `Page ${String(n)}` });
    }
    const five = await listLinkPages(ada.scope);
    expect(five).toHaveLength(5);
    expect(five.filter((page) => page.isPrimary)).toHaveLength(1);
    expect(five[0]?.handle).toBe(ada.handle);
    expect(five.slice(1).map((page) => page.name)).toEqual(['Page 2', 'Page 3', 'Page 4', 'Page 5']);
    expect(await refusalOf(createLinkPage(ada.scope, { id: newId(), handle: fresh('six'), name: '' }))).toMatchObject({
      code: 'LIMIT_REACHED',
    });
  });

  it('keeps spec 0056’s handle rules: a handle anyone holds or held is taken, and a retry adds nothing', async () => {
    const ada = await person('Ada');
    const grace = await person('Grace');
    // Another person's current handle, and one of Ada's own pages' handles, are both taken.
    expect(await refusalOf(createLinkPage(ada.scope, { id: newId(), handle: grace.handle, name: '' }))).toMatchObject({
      code: 'SLUG_TAKEN',
    });
    expect(await refusalOf(createLinkPage(ada.scope, { id: newId(), handle: ada.handle, name: '' }))).toMatchObject({
      code: 'SLUG_TAKEN',
    });
    // A word kept for the app is refused before anything is sent.
    expect(await refusalOf(createLinkPage(ada.scope, { id: newId(), handle: 'settings', name: '' }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
    // Idempotent on the id the browser minted.
    const id = newId();
    const handle = fresh('side');
    await createLinkPage(ada.scope, { id, handle, name: 'Side project' });
    await createLinkPage(ada.scope, { id, handle, name: 'Side project' });
    expect((await listLinkPages(ada.scope)).filter((page) => page.id === id)).toHaveLength(1);
    // A name is one line of at most 40.
    expect(await refusalOf(renameLinkPage(ada.scope, { profileId: id, name: 'x'.repeat(41) }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
    const renamed = await renameLinkPage(ada.scope, { profileId: id, name: 'Work' });
    expect(renamed.find((page) => page.id === id)?.name).toBe('Work');
  });

  it('keeps each page’s blocks, look and numbers its own, and a call naming no page means the primary (AC-6417)', async () => {
    const ada = await person('Ada');
    const side = newId();
    const sideHandle = fresh('side');
    await createLinkPage(ada.scope, { id: side, handle: sideHandle, name: 'Side' });
    await saveProfileItem(ada.scope, { id: newId(), block: link('Main') });
    await saveProfileItem(ada.scope, { id: newId(), block: link('Shop') }, {}, side);
    expect((await readProfileItems(ada.scope)).items.map((item) => item.kind === 'link' && item.title)).toEqual([
      'Main',
    ]);
    expect(
      (await readProfileItems(ada.scope, {}, side)).items.map((item) => item.kind === 'link' && item.title),
    ).toEqual(['Shop']);
    // Visitors read each page by its own handle.
    const mainRead = await enterLinkPage({ db }, ada.handle, { max: 21 });
    const sideRead = await enterLinkPage({ db }, sideHandle, { max: 21 });
    expect(mainRead.rows).toHaveLength(1);
    expect(sideRead.rows).toHaveLength(1);
    expect(sideRead.owner.profileId).toBe(side);
    expect(sideRead.rows[0]?.id).not.toBe(mainRead.rows[0]?.id);
    // The look is the page's own.
    await saveProfileTheme(ada.scope, { ...DEFAULT_PAGE_THEME, ground: 'ink' }, side);
    expect((await getMyProfile(ada.scope, {}, side)).theme?.ground).toBe('ink');
    expect((await getMyProfile(ada.scope)).theme?.ground).toBe(DEFAULT_PAGE_THEME.ground);
    // Views count on the page that was read.
    const visitor = 'b'.repeat(32);
    await countProfileView({ db }, ada.userId, ada.workspaceId, visitor, {}, side);
    await countProfileView({ db }, ada.userId, ada.workspaceId, visitor, {}, side);
    expect((await readProfileCounts(ada.scope, new Date(), 30, side)).views).toBe(2);
    expect((await readProfileCounts(ada.scope)).views).toBe(0);
  });

  it('never reads or writes another person’s page by its id', async () => {
    const ada = await person('Ada');
    const grace = await person('Grace');
    const [graces] = await listLinkPages(grace.scope);
    if (graces === undefined) throw new Error('Grace has a page.');
    expect((await readProfileItems(ada.scope, {}, graces.id)).items).toEqual([]);
    expect(
      await refusalOf(saveProfileItem(ada.scope, { id: newId(), block: link('Sneak') }, {}, graces.id)),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(getMyProfile(ada.scope, {}, graces.id))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(setPrimaryLinkPage(ada.scope, graces.id))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(deleteLinkPage(ada.scope, graces.id))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(renameLinkPage(ada.scope, { profileId: graces.id, name: 'Mine' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await listLinkPages(grace.scope))[0]).toMatchObject({ id: graces.id, isPrimary: true, name: '' });
  });

  it('makes another page primary: Home’s card and the booking pages’ handle follow it (AC-6415)', async () => {
    const ada = await person('Ada');
    const side = newId();
    const sideHandle = fresh('side');
    await createLinkPage(ada.scope, { id: side, handle: sideHandle, name: 'Side' });
    const after = await setPrimaryLinkPage(ada.scope, side);
    expect(after.filter((page) => page.isPrimary).map((page) => page.id)).toEqual([side]);
    expect(after[0]?.id).toBe(side);
    const primary = await inWorkspace(ada.scope, (tx) => publicProfilesOf(tx, ada.workspaceId, [ada.userId]));
    expect(primary.get(ada.userId)?.handle).toBe(sideHandle);
    expect((await getMyProfile(ada.scope)).handle).toBe(sideHandle);
  });

  it('deletes a page but never the only one, keeps its handle reserved, and passes primacy on (AC-6416)', async () => {
    const ada = await person('Ada');
    const [only] = await listLinkPages(ada.scope);
    if (only === undefined) throw new Error('Ada has a page.');
    expect(await refusalOf(deleteLinkPage(ada.scope, only.id))).toMatchObject({ code: 'CONFIG_INVALID' });
    const side = newId();
    const sideHandle = fresh('side');
    await createLinkPage(ada.scope, { id: side, handle: sideHandle, name: 'Side' });
    await saveProfileItem(ada.scope, { id: newId(), block: link('Gone') }, {}, side);
    const left = await deleteLinkPage(ada.scope, side);
    expect(left.handle).toBe(sideHandle);
    expect(left.pages.map((page) => page.id)).toEqual([only.id]);
    // The handle stays Ada's: nobody else may take it, and it finds her primary page.
    expect(await readHandleOffer({ db }, sideHandle)).toBe('absent');
    expect((await findHandleOwner({ db }, sideHandle)).handle).toBe(ada.handle);
    const grace = await person('Grace');
    expect(await refusalOf(createLinkPage(grace.scope, { id: newId(), handle: sideHandle, name: '' }))).toMatchObject({
      code: 'SLUG_TAKEN',
    });
    // Deleting the primary page makes the next one primary.
    const next = newId();
    await createLinkPage(ada.scope, { id: next, handle: fresh('next'), name: 'Next' });
    const remaining = await deleteLinkPage(ada.scope, only.id);
    expect(remaining.pages).toEqual([expect.objectContaining({ id: next, isPrimary: true })]);
    // And a call naming no page now means that one.
    expect((await getMyProfile(ada.scope)).profileId).toBe(next);
  });

  it('changes one page’s handle without touching the others, its old handle moving to the new one', async () => {
    const ada = await person('Ada');
    const side = newId();
    const before = fresh('before');
    await createLinkPage(ada.scope, { id: side, handle: before, name: 'Side' });
    const renamed = fresh('after');
    await updateMyMemberProfile(ada.scope, { handle: renamed }, {}, [], {}, side);
    const pages = await listLinkPages(ada.scope);
    expect(pages.find((page) => page.id === side)?.handle).toBe(renamed);
    expect(pages.find((page) => page.isPrimary)?.handle).toBe(ada.handle);
    expect((await findHandleOwner({ db }, before)).handle).toBe(renamed);
  });
});
