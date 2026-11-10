// One public page per business (spec 0065 H7, slice 3: AC-6592, AC-6593) against the real Postgres as the app role:
// the first business keeps the workspace's handle, another's address is only a wish until its first Publish takes
// it, a workspace makes at most 5 new handles a day, the public lookup finds the right business by a current or old
// handle and reads only that business's places, pictures and listing, and at a business's own address with two or
// more places Reserve asks for the place first.
import { randomUUID } from 'node:crypto';
import type { FirstBusiness } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { newId } from '../engine/ids.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { getTableSetup, saveTableSetup } from '../visits/table-service.ts';
import { installApp } from './apps.ts';
import {
  addBusinessPhoto,
  claimBusinessHandle,
  discardBusinessPage,
  getBusinessPage,
  publishBusinessPage,
  saveBusinessPage,
  setPlaceSlug,
} from './business-page.ts';
import { addResources } from './floor.ts';
import { createPlace, getBusiness } from './places.ts';
import { createProperty, removeProperty } from './property.ts';
import { businessEdgeTags } from './edge-tags.ts';
import { enterBusinessPage, listSitemapBusinesses, publicBusinessBrand, publicBusinessPhoto } from './public-page.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-property-page-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
const run = randomUUID().slice(0, 6);

const CARD: FirstBusiness = {
  name: 'Somewhere Nowhere',
  kind: 'restaurant',
  place: { country: 'IN', timeZone: 'Asia/Kolkata', city: 'Bengaluru', addressLine: '12 MG Road' },
  currency: 'INR',
};

const PLACE = { country: 'IN', timeZone: 'Asia/Kolkata', city: 'Bengaluru', addressLine: '1 Church Street' } as const;

/** A workspace with Table seating, its owner's scope, its first place, and a second business with one place. */
async function twoBusinesses() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Somewhere',
    slug: `pp-${run}-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  await installApp(owner, { app: 'table_seating', business: CARD });
  const firstPlace = (await getBusiness(owner)).places[0]?.id ?? '';
  const second = randomUUID();
  await createProperty(owner, { id: second, name: 'Harbour Bar', kind: 'bar', currency: 'INR' });
  const secondPlace = newId();
  await createPlace(owner, { id: secondPlace, place: { ...PLACE, name: 'Harbour' }, propertyId: second });
  return { ...created, owner, firstPlace, second, secondPlace };
}

/** The refusal code a promise rejects with, `INPUT_INVALID` for an input problem, and the field it names. */
async function refusalOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isInputError(error)) return 'INPUT_INVALID';
    if (isRefusal(error)) return error.refusal.code;
    throw error;
  }
}

/** Opens a place's table service for online reservations, answering its reservation page's path. */
async function openOnline(scope: ReturnType<typeof testScope>, placeId: string): Promise<string> {
  await addResources(scope, { placeId, kind: 'table', labels: ['T1'], minCapacity: 1, maxCapacity: 4 });
  const setup = await getTableSetup(scope, { placeId });
  await saveTableSetup(scope, { placeId, rules: { ...setup.rules, partyMax: 4, online: true } });
  return `/r/${setup.publicKey}`;
}

describe('a page per business (AC-6592)', () => {
  it('keeps the first business on the workspace’s handle and takes another’s only at its first Publish', async () => {
    const w = await twoBusinesses();
    const first = `pp-${run}-${String(made)}-one`;
    const wish = `pp-${run}-${String(made)}-two`;
    await claimBusinessHandle(w.owner, { handle: first });
    expect((await getBusinessPage(w.owner)).handleOnPublish).toBeUndefined();
    // Another business's address is a wish: shown, but held for nobody.
    const before = await getBusinessPage(w.owner, { propertyId: w.second });
    expect(before.handle).toBeUndefined();
    expect(before.handleOnPublish).toBe(true);
    const wished = await claimBusinessHandle(w.owner, { handle: wish, propertyId: w.second });
    expect(wished.view).toMatchObject({ handle: wish, handleOnPublish: true });
    expect(wished.stale).toBe(false);
    const held = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ taken: boolean }>(sql`select crm_handle_taken(${wish}) as taken`),
    );
    expect(held.rows[0]?.taken).toBe(false);
    // Its own first business's handle is taken for it, as anybody's is.
    expect(await refusalOf(claimBusinessHandle(w.owner, { handle: first, propertyId: w.second }))).toBe('SLUG_TAKEN');
    // Its places are its own: the first business's place is none of its business.
    expect(await refusalOf(setPlaceSlug(w.owner, { placeId: w.firstPlace, slug: 'main', propertyId: w.second }))).toBe(
      'NOT_FOUND',
    );
    expect((await getBusinessPage(w.owner, { propertyId: w.second })).places.map((place) => place.id)).toEqual([
      w.secondPlace,
    ]);
    // The first Publish takes the address; the page is the second business's own, at its own handle.
    const published = await publishBusinessPage(w.owner, { propertyId: w.second });
    expect(published.view).toMatchObject({ handle: wish, published: { version: 1 } });
    expect(published.view.handleOnPublish).toBeUndefined();
    const page = (await enterBusinessPage({ db }, wish)).page;
    expect(page).toMatchObject({ handle: wish, name: 'Harbour Bar', kind: 'bar', placeId: w.secondPlace });
    expect(page.places.map((place) => place.id)).toEqual([w.secondPlace]);
    // The first business's handle still finds nothing until the first business publishes, and then only its own page.
    expect(await refusalOf(enterBusinessPage({ db }, first))).toBe('NOT_FOUND');
    await publishBusinessPage(w.owner);
    const firstPage = (await enterBusinessPage({ db }, first)).page;
    expect(firstPage).toMatchObject({ name: 'Somewhere Nowhere', placeId: w.firstPlace });
    expect(firstPage.places.map((place) => place.id)).toEqual([w.firstPlace]);
    // One business's place is no place of another's page, by its slug either.
    const firstSlug = firstPage.places[0]?.slug ?? '';
    expect(await refusalOf(enterBusinessPage({ db }, wish, firstSlug))).toBe('NOT_FOUND');
    expect((await enterBusinessPage({ db }, first, firstSlug)).page.placeId).toBe(w.firstPlace);
    // Separate brands stay unlinkable (owner decision, 10 Nov 2026): each answer files under its own business tag, which
    // no other business of the workspace shares, and neither names the other's business, places or workspace.
    const secondPage = (await enterBusinessPage({ db }, wish)).page;
    const businessTag = (tags: readonly string[]) => tags.filter((tag) => tag.startsWith('business:'));
    expect(businessTag(firstPage.tags)).toHaveLength(1);
    expect(businessTag(secondPage.tags)).toHaveLength(1);
    expect(firstPage.tags.some((tag) => secondPage.tags.includes(tag))).toBe(false);
    for (const [page, other] of [
      [firstPage, secondPage],
      [secondPage, firstPage],
    ] as const) {
      const json = JSON.stringify(page);
      expect(json).not.toContain(w.workspaceId);
      expect(json).not.toContain(other.handle);
      expect(json).not.toContain(other.placeId);
    }
    // A write purges each business it changed, by its own tags: one place names its business only.
    const placeTags = await businessEdgeTags(w.owner, { places: [w.secondPlace] });
    expect(placeTags).toEqual(expect.arrayContaining([...secondPage.tags]));
    expect(placeTags).not.toContain(businessTag(firstPage.tags)[0]);
    const every = await businessEdgeTags(w.owner, { every: true });
    expect(every).toEqual(expect.arrayContaining([...businessTag(firstPage.tags), ...businessTag(secondPage.tags)]));
    const firstOnly = await businessEdgeTags(w.owner, { properties: [undefined] });
    expect(firstOnly).toContain(businessTag(firstPage.tags)[0]);
    expect(firstOnly).not.toContain(businessTag(secondPage.tags)[0]);
    // A cover is the business's own: another business's picture, of the same workspace, is refused.
    const theirs = randomUUID();
    await addBusinessPhoto(w.owner, {
      id: theirs,
      type: 'image/png',
      bytes: 10,
      width: 10,
      height: 10,
      propertyId: w.second,
    });
    expect(
      await refusalOf(
        saveBusinessPage(w.owner, {
          draft: { gallery: [], cover: { id: theirs, width: 10, height: 10 }, amenities: [], hiddenPlaces: [] },
        }),
      ),
    ).toBe('INPUT_INVALID');
    // Both are listed for search engines, each at its own handle.
    const listed = (await listSitemapBusinesses({ db }, { max: 50_000 })).map((row) => row.handle);
    expect(listed).toEqual(expect.arrayContaining([first, wish]));
    // A new address for the second business is now taken at once, and its old one keeps finding its page.
    const moved = `pp-${run}-${String(made)}-three`;
    expect((await claimBusinessHandle(w.owner, { handle: moved, propertyId: w.second })).view.handle).toBe(moved);
    expect((await enterBusinessPage({ db }, wish)).page).toMatchObject({ handle: moved, name: 'Harbour Bar' });
    expect(await publicBusinessBrand({ db }, wish)).toMatchObject({ workspaceId: w.workspaceId });
  });

  it('refuses a wished address taken by anybody before Publish, on the address', async () => {
    const w = await twoBusinesses();
    const other = await twoBusinesses();
    const wish = `pp-${run}-${String(made)}-race`;
    await claimBusinessHandle(w.owner, { handle: wish, propertyId: w.second });
    // Held for nobody: another workspace takes it first.
    await claimBusinessHandle(other.owner, { handle: wish });
    expect(await refusalOf(publishBusinessPage(w.owner, { propertyId: w.second }))).toBe('SLUG_TAKEN');
    expect((await getBusinessPage(w.owner, { propertyId: w.second })).published).toBeUndefined();
    // And now it can't be wished for at all.
    expect(await refusalOf(claimBusinessHandle(w.owner, { handle: wish, propertyId: w.second }))).toBe('SLUG_TAKEN');
  });

  it('lets a workspace take at most 5 new handles a day, its own old ones again for free', async () => {
    const w = await twoBusinesses();
    const name = (n: number) => `pp-${run}-${String(made)}-d${String(n)}`;
    for (let n = 0; n < 5; n += 1) await claimBusinessHandle(w.owner, { handle: name(n) });
    // The day's limit says so, apart from the business's 20 changes.
    await expect(claimBusinessHandle(w.owner, { handle: name(5) })).rejects.toMatchObject({
      refusal: { code: 'LIMIT_REACHED', message: expect.stringContaining('today') as unknown },
    });
    expect((await claimBusinessHandle(w.owner, { handle: name(0) })).view.handle).toBe(name(0));
    // A wish costs nothing; its Publish is a sixth new handle today, refused on the address.
    await claimBusinessHandle(w.owner, { handle: name(6), propertyId: w.second });
    expect(await refusalOf(publishBusinessPage(w.owner, { propertyId: w.second }))).toBe('LIMIT_REACHED');
  });

  it('keeps each business’s pictures and another workspace’s business apart, and a handle no business names finds nothing', async () => {
    const w = await twoBusinesses();
    const wish = `pp-${run}-${String(made)}-pics`;
    const first = `pp-${run}-${String(made)}-firstpics`;
    await claimBusinessHandle(w.owner, { handle: first });
    await claimBusinessHandle(w.owner, { handle: wish, propertyId: w.second });
    const photo = randomUUID();
    await addBusinessPhoto(w.owner, {
      id: photo,
      type: 'image/jpeg',
      bytes: 10,
      width: 4,
      height: 3,
      propertyId: w.second,
    });
    // The first business's draft can't use the second's picture.
    expect(
      await refusalOf(
        saveBusinessPage(w.owner, {
          draft: { gallery: [{ id: photo, width: 4, height: 3 }], amenities: [], hiddenPlaces: [] },
        }),
      ),
    ).toBe('INPUT_INVALID');
    await saveBusinessPage(w.owner, {
      draft: { gallery: [{ id: photo, width: 4, height: 3 }], amenities: [], hiddenPlaces: [] },
      propertyId: w.second,
    });
    await publishBusinessPage(w.owner, { propertyId: w.second });
    await publishBusinessPage(w.owner);
    expect(await publicBusinessPhoto({ db }, wish, photo)).toMatchObject({ workspaceId: w.workspaceId });
    expect(await publicBusinessPhoto({ db }, first, photo)).toBeUndefined();
    // Another workspace's business can't name this one.
    const other = await twoBusinesses();
    expect(await refusalOf(getBusinessPage(other.owner, { propertyId: w.second }))).toBe('NOT_FOUND');
    expect(await refusalOf(claimBusinessHandle(other.owner, { handle: `pp-${run}-x`, propertyId: w.second }))).toBe(
      'NOT_FOUND',
    );
    const draft = { gallery: [], amenities: [], hiddenPlaces: [] };
    expect(await refusalOf(saveBusinessPage(other.owner, { draft, propertyId: w.second }))).toBe('NOT_FOUND');
    expect(await refusalOf(publishBusinessPage(other.owner, { propertyId: w.second }))).toBe('NOT_FOUND');
    expect(await refusalOf(discardBusinessPage(other.owner, { propertyId: w.second }))).toBe('NOT_FOUND');
    expect(
      await refusalOf(setPlaceSlug(other.owner, { placeId: w.secondPlace, slug: 'pier', propertyId: w.second })),
    ).toBe('NOT_FOUND');
    expect(
      await refusalOf(
        addBusinessPhoto(other.owner, {
          id: randomUUID(),
          type: 'image/jpeg',
          bytes: 10,
          width: 4,
          height: 3,
          propertyId: w.second,
        }),
      ),
    ).toBe('NOT_FOUND');
    // Nor can one business hide another's place.
    expect(
      await refusalOf(
        saveBusinessPage(w.owner, { draft: { ...draft, hiddenPlaces: [w.firstPlace] }, propertyId: w.second }),
      ),
    ).toBe('NOT_FOUND');
    // A business with places and a page can't be removed.
    expect(await refusalOf(removeProperty(w.owner, { propertyId: w.second }))).toBe('IN_USE');
    // A handle its workspace holds but no business names (as a removed business's would) finds nothing at all.
    await testQuery(ownerUrl, `delete from property_handles where workspace_id = $1 and handle = $2`, [
      w.workspaceId,
      wish,
    ]);
    expect(await refusalOf(enterBusinessPage({ db }, wish))).toBe('NOT_FOUND');
    expect(await publicBusinessPhoto({ db }, wish, photo)).toBeUndefined();
    expect(await publicBusinessBrand({ db }, wish)).toBeUndefined();
  });
});

describe('Reserve at a business with several places (AC-6593)', () => {
  it('asks for the place first at the business’s own address, and goes straight to a place from its own', async () => {
    const w = await twoBusinesses();
    const wish = `pp-${run}-${String(made)}-reserve`;
    const another = newId();
    await createPlace(w.owner, { id: another, place: { ...PLACE, name: 'Pier' }, propertyId: w.second });
    await claimBusinessHandle(w.owner, { handle: wish, propertyId: w.second });
    await publishBusinessPage(w.owner, { propertyId: w.second });
    // Not yet taking reservations: a bar's page says nothing about Reserve but Call or Directions.
    expect((await enterBusinessPage({ db }, wish)).page.reservePlaces).toBeUndefined();
    const harbour = await openOnline(w.owner, w.secondPlace);
    // One place open: Reserve goes straight to it, even at the business's address.
    expect((await enterBusinessPage({ db }, wish)).page).toMatchObject({ reserve: 'open', reservePath: harbour });
    const pier = await openOnline(w.owner, another);
    const page = (await enterBusinessPage({ db }, wish)).page;
    expect(page.reserve).toBe('open');
    expect(page.reservePath).toBeUndefined();
    expect(page.reservePlaces).toEqual([
      { id: w.secondPlace, name: 'Harbour', path: harbour },
      { id: another, name: 'Pier', path: pier },
    ]);
    // A place's own address reserves at that place.
    const slug = page.places.find((place) => place.id === another)?.slug ?? '';
    const placePage = (await enterBusinessPage({ db }, wish, slug)).page;
    expect(placePage).toMatchObject({ placeId: another, reserve: 'open', reservePath: pier });
    expect(placePage.reservePlaces).toBeUndefined();
  });
});
