// The business page (spec 0066, B4 lite) against the real Postgres as the app role: the address claimed at once and
// kept apart from people's handles (Rules settled: Handles), a draft guests never see until Publish, which refuses a
// broken page in one line (spec 0068, Foolproof), place slugs with history and the reserved words, the public read by
// a current or old handle and slug, the published gallery's pictures only, and the sitemap's listing.
import { randomUUID } from 'node:crypto';
import type { FirstBusiness } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { newId } from '../engine/ids.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { setEarlyAccess } from '../operator/early-access.ts';
import { testScope } from '../testing.ts';
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
import { getBusiness, updatePlace } from './places.ts';
import { enterBusinessPage, listSitemapBusinesses, publicBusinessPhoto } from './public-page.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-business-page-tests' });
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

/** A workspace with Table seating installed, its owner's scope and a plain member's, and its first place's id. */
async function business() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Somewhere',
    slug: `biz-${run}-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const memberId = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${memberId}, 'Bea', 'bea@example.com', 'member', 'system', 'system')`,
    ),
  );
  await setEarlyAccess({ db }, { workspaceId: created.workspaceId, flag: 'business_apps', on: true });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const member = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: memberId },
    role: 'member',
  });
  await installApp(owner, { app: 'table_seating', business: CARD });
  const placeId = (await getBusiness(owner)).places[0]?.id ?? '';
  return { ...created, owner, member, placeId };
}

/** The refusal code a promise rejects with, `INPUT_INVALID` for an input problem. */
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

const OPEN_WEEK = {
  weekly: { mon: [{ from: '12:00', to: '23:00' }], fri: [{ from: '18:00', to: '02:00' }] },
  exceptions: [],
};

describe('the page editor (B4 lite)', () => {
  it('refuses a member without hospitality.manage before reading anything', async () => {
    const w = await business();
    expect(await refusalOf(getBusinessPage(w.member))).toBe('FORBIDDEN');
    expect(await refusalOf(claimBusinessHandle(w.member, { handle: `sn-${run}` }))).toBe('FORBIDDEN');
  });

  it('claims an address at once, keeps the old one finding the page, and refuses one anybody else holds', async () => {
    const w = await business();
    const other = await business();
    const first = await claimBusinessHandle(w.owner, { handle: `sn-${run}-a` });
    expect(first.view.handle).toBe(`sn-${run}-a`);
    // A first address gives the place its first slug, from its name.
    expect(first.view.places[0]?.slug).toBe('somewhere-nowhere');
    expect(await refusalOf(claimBusinessHandle(other.owner, { handle: `sn-${run}-a` }))).toBe('SLUG_TAKEN');
    await claimBusinessHandle(w.owner, { handle: `sn-${run}-b` });
    // Its own old address is its own again; another business still can't take it.
    expect(await refusalOf(claimBusinessHandle(other.owner, { handle: `sn-${run}-a` }))).toBe('SLUG_TAKEN');
    expect((await claimBusinessHandle(w.owner, { handle: `sn-${run}-a` })).view.handle).toBe(`sn-${run}-a`);
  });

  it('refuses Publish with one line until the page has an address, a name, a street and hours, then goes live', async () => {
    const w = await business();
    let view = await getBusinessPage(w.owner);
    expect(view.problem).toMatchObject({ fix: 'handle' });
    expect(await refusalOf(publishBusinessPage(w.owner))).toBe('VALIDATION_FAILED');
    view = (await claimBusinessHandle(w.owner, { handle: `sn-${run}-pub` })).view;
    expect(view.problem).toEqual({
      message: 'Set Somewhere Nowhere’s opening hours first.',
      fix: 'hours',
      placeId: w.placeId,
    });
    await updatePlace(w.owner, { placeId: w.placeId, hours: OPEN_WEEK });
    view = await getBusinessPage(w.owner);
    expect(view.problem).toBeUndefined();
    expect(view.showsReserve).toBe(true);
    // Nothing is live before Publish: the public read answers no page.
    expect(await refusalOf(enterBusinessPage({ db }, `sn-${run}-pub`))).toBe('NOT_FOUND');
    const published = await publishBusinessPage(w.owner);
    expect(published.view.published?.version).toBe(1);
    expect(published.view.hasChanges).toBe(false);
    const entry = await enterBusinessPage({ db }, `sn-${run}-pub`);
    expect(entry.page).toMatchObject({
      handle: `sn-${run}-pub`,
      name: 'Somewhere Nowhere',
      kind: 'restaurant',
      placeId: w.placeId,
      reserve: 'soon',
      indexable: true,
      tags: [`business:${w.workspaceId}`, `place:${w.placeId}`],
    });
    expect(entry.page.menu).toBeUndefined();
    expect(entry.page.places[0]).toMatchObject({
      slug: 'somewhere-nowhere',
      city: 'Bengaluru',
      addressLine: '12 MG Road',
    });
  });

  it('keeps the draft from guests until Publish, lists what changed, and discards back to what is live', async () => {
    const w = await business();
    await claimBusinessHandle(w.owner, { handle: `sn-${run}-draft` });
    await updatePlace(w.owner, { placeId: w.placeId, hours: OPEN_WEEK });
    await publishBusinessPage(w.owner);
    const photo = randomUUID();
    await addBusinessPhoto(w.owner, { id: photo, type: 'image/jpeg', bytes: 100, width: 1600, height: 1200 });
    const saved = await saveBusinessPage(w.owner, {
      draft: {
        gallery: [{ id: photo, width: 1600, height: 1200, alt: 'The terrace' }],
        amenities: ['wifi', 'cards'],
        about: 'A small bar.',
        hiddenPlaces: [],
      },
    });
    expect(saved.hasChanges).toBe(true);
    expect(saved.changes).toEqual([
      'Gallery: 1 photo added',
      'Amenities: Wi‑Fi added',
      'Amenities: Card payments added',
      'About text changed',
    ]);
    // Guests still see the published page, and the draft's picture isn't served.
    expect((await enterBusinessPage({ db }, `sn-${run}-draft`)).page.gallery).toEqual([]);
    expect(await publicBusinessPhoto({ db }, `sn-${run}-draft`, photo)).toBeUndefined();
    const discarded = await discardBusinessPage(w.owner);
    expect(discarded.hasChanges).toBe(false);
    expect(discarded.draft.gallery).toEqual([]);
    // A picture that isn't the business's own is refused in a draft.
    expect(
      await refusalOf(
        saveBusinessPage(w.owner, {
          draft: { gallery: [{ id: randomUUID(), width: 10, height: 10 }], amenities: [], hiddenPlaces: [] },
        }),
      ),
    ).toBe('INPUT_INVALID');
    await saveBusinessPage(w.owner, {
      draft: { gallery: [{ id: photo, width: 1600, height: 1200 }], amenities: ['wifi'], hiddenPlaces: [] },
    });
    await publishBusinessPage(w.owner);
    const page = (await enterBusinessPage({ db }, `sn-${run}-draft`)).page;
    expect(page.gallery).toEqual([
      { id: photo, width: 1600, height: 1200, src: `/api/public/business/sn-${run}-draft/photos/${photo}` },
    ]);
    expect(page.amenities).toEqual(['wifi']);
    expect(await publicBusinessPhoto({ db }, `sn-${run}-draft`, photo)).toMatchObject({
      path: `business-page/${w.workspaceId}/${photo}.jpg`,
    });
  });

  it('drops the pictures nothing uses on Publish, answering their paths to remove', async () => {
    const w = await business();
    await claimBusinessHandle(w.owner, { handle: `sn-${run}-drop` });
    await updatePlace(w.owner, { placeId: w.placeId, hours: OPEN_WEEK });
    const kept = randomUUID();
    const dropped = randomUUID();
    await addBusinessPhoto(w.owner, { id: kept, type: 'image/png', bytes: 10, width: 10, height: 10 });
    await addBusinessPhoto(w.owner, { id: dropped, type: 'image/webp', bytes: 10, width: 10, height: 10 });
    await saveBusinessPage(w.owner, {
      draft: { gallery: [{ id: kept, width: 10, height: 10 }], amenities: [], hiddenPlaces: [] },
    });
    const published = await publishBusinessPage(w.owner);
    expect(published.unusedPaths).toEqual([`business-page/${w.workspaceId}/${dropped}.webp`]);
  });

  it('gives a place a new slug with its old one still finding it, refusing reserved words and another place’s', async () => {
    const w = await business();
    await claimBusinessHandle(w.owner, { handle: `sn-${run}-slug` });
    await updatePlace(w.owner, { placeId: w.placeId, hours: OPEN_WEEK });
    await setPlaceSlug(w.owner, { placeId: w.placeId, slug: 'indiranagar' });
    await publishBusinessPage(w.owner);
    expect((await enterBusinessPage({ db }, `sn-${run}-slug`, 'indiranagar')).page.placeId).toBe(w.placeId);
    expect((await enterBusinessPage({ db }, `sn-${run}-slug`, 'somewhere-nowhere')).page.places[0]?.slug).toBe(
      'indiranagar',
    );
    expect(await refusalOf(enterBusinessPage({ db }, `sn-${run}-slug`, 'reserve'))).toBe('NOT_FOUND');
    expect(await refusalOf(enterBusinessPage({ db }, `sn-${run}-slug`, 'nowhere'))).toBe('NOT_FOUND');
  });

  it('lists a published business for the sitemap, and a hidden place answers noindex', async () => {
    const w = await business();
    await claimBusinessHandle(w.owner, { handle: `sn-${run}-map` });
    await updatePlace(w.owner, { placeId: w.placeId, hours: OPEN_WEEK });
    await publishBusinessPage(w.owner);
    expect(await listSitemapBusinesses({ db }, { max: 50_000 })).toContainEqual(
      expect.objectContaining({ handle: `sn-${run}-map`, places: [] }),
    );
    await saveBusinessPage(w.owner, { draft: { gallery: [], amenities: [], hiddenPlaces: [w.placeId] } });
    await publishBusinessPage(w.owner);
    expect((await listSitemapBusinesses({ db }, { max: 50_000 })).map((row) => row.handle)).not.toContain(
      `sn-${run}-map`,
    );
    expect((await enterBusinessPage({ db }, `sn-${run}-map`)).page.indexable).toBe(false);
  });
});
