// Many properties (spec 0065 H7, slice 2): an admin adds and removes them (AC-6516, AC-6590), up to 20 (AC-6518); each
// reads its own places, a place is made in the property named, a property's currency holds while it has prices
// (AC-6519), and another workspace's property is not found.
import { randomUUID } from 'node:crypto';
import type { ItemFields, ServiceFields } from '@crm/contracts';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { visitWorkspace } from '../../test/visits-kit.ts';
import { isRefusal } from '../engine/refusals.ts';
import { testScope } from '../testing.ts';
import { installApp } from './apps.ts';
import {
  deleteItem,
  discardMenuDraft,
  duplicateMenu,
  placeItem,
  publishMenus,
  readMenuDraft,
  saveItem,
  saveMenu,
  saveSection,
  setMenuHidden,
} from './menu.ts';
import { createPlace, getBusiness, saveBusiness } from './places.ts';
import { createProperty, listProperties, removeProperty } from './property.ts';
import {
  archiveServices,
  duplicateService,
  getCatalogue,
  saveService,
  saveServiceCategory,
} from '../visits/catalogue.ts';
import { listServicePlaces } from '../visits/table-service.ts';

let db: Database;

beforeAll(() => {
  db = createDatabase({ url: inject('testDatabase').appUrl, applicationName: 'crm-property-manage-tests' });
});
afterAll(async () => {
  await db.close();
});

/** The refusal code a promise rejects with. */
async function refusalOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isRefusal(error)) return error.refusal.code;
    throw error;
  }
}

/** A set up business, with a plain member beside its owner. */
async function business() {
  const w = await visitWorkspace(db);
  const memberId = randomUUID();
  await w.sql(
    sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${w.workspaceId}, ${memberId}, 'Bea', 'bea@example.com', 'member', 'system', 'system')`,
  );
  const member = testScope({ db, workspaceId: w.workspaceId, actor: { type: 'member', id: memberId }, role: 'member' });
  return { ...w, member };
}

const PLACE = { name: 'Harbour', country: 'GB', timeZone: 'Europe/London' } as const;

describe('adding and removing a property (AC-6516, AC-6518, AC-6590)', () => {
  it('lets an admin add one, which lists second with nothing in it; a plain member reads the list only', async () => {
    const w = await business();
    const id = randomUUID();
    expect(await refusalOf(createProperty(w.member, { id, name: 'Bar', kind: 'bar', currency: 'EUR' }))).toBe(
      'FORBIDDEN',
    );
    const view = await createProperty(w.owner, { id, name: 'Bar', kind: 'bar', currency: 'EUR' });
    expect(view.properties.map((p) => [p.name, p.position, p.currency, p.holds])).toEqual([
      ['Somewhere Nowhere', 0, 'GBP', 1],
      ['Bar', 1, 'EUR', 0],
    ]);
    // A retry with the same id makes nothing more.
    expect((await createProperty(w.owner, { id, name: 'Bar', kind: 'bar', currency: 'EUR' })).properties).toHaveLength(
      2,
    );
    const read = await listProperties(w.member);
    expect(read.properties).toHaveLength(2);
    expect(read.canManage).toBe(false);
  });

  it('refuses a second before the first is set up, and a twenty first', async () => {
    const w = await business();
    await w.sql(sql`update properties set name = null, kind = null`);
    expect(
      await refusalOf(createProperty(w.owner, { id: randomUUID(), name: 'B', kind: 'bar', currency: 'EUR' })),
    ).toBe('CONFLICT');
    await w.sql(sql`update properties set name = 'First', kind = 'bar'`);
    for (let n = 1; n < 20; n += 1) {
      await createProperty(w.owner, { id: randomUUID(), name: `Brand ${String(n)}`, kind: 'bar', currency: 'EUR' });
    }
    expect(
      await refusalOf(createProperty(w.owner, { id: randomUUID(), name: 'One more', kind: 'bar', currency: 'EUR' })),
    ).toBe('LIMIT_REACHED');
  });

  it('removes an empty one only, never the first, and reuses its slot', async () => {
    const w = await business();
    const first = (await listProperties(w.owner)).properties[0]?.id ?? '';
    expect(await refusalOf(removeProperty(w.owner, { propertyId: first }))).toBe('IN_USE');
    const second = randomUUID();
    await createProperty(w.owner, { id: second, name: 'Bar', kind: 'bar', currency: 'EUR' });
    const placeId = randomUUID();
    await createPlace(w.owner, { id: placeId, place: PLACE, propertyId: second });
    expect(await refusalOf(removeProperty(w.owner, { propertyId: second }))).toBe('IN_USE');
    expect(await refusalOf(removeProperty(w.member, { propertyId: second }))).toBe('FORBIDDEN');
    await w.sql(sql`delete from places where id = ${placeId}::uuid`);
    expect((await removeProperty(w.owner, { propertyId: second })).properties).toHaveLength(1);
    const third = randomUUID();
    const view = await createProperty(w.owner, { id: third, name: 'Cafe', kind: 'cafe', currency: 'EUR' });
    expect(view.properties.find((p) => p.id === third)?.position).toBe(1);
  });
});

describe('each property reads its own (AC-6514, AC-6516)', () => {
  it('lists a property’s own places, makes a place in the one named, and keeps the first exactly as it was', async () => {
    const w = await business();
    const second = randomUUID();
    await createProperty(w.owner, { id: second, name: 'Bar', kind: 'bar', currency: 'EUR' });
    const placeId = randomUUID();
    await createPlace(w.owner, { id: placeId, place: PLACE, propertyId: second });
    const first = await getBusiness(w.owner);
    expect(first.profile?.name).toBe('Somewhere Nowhere');
    expect(first.places.map((place) => place.id)).toEqual([w.placeId]);
    const other = await getBusiness(w.owner, { propertyId: second });
    expect(other.profile).toMatchObject({ id: second, name: 'Bar', currency: 'EUR' });
    expect(other.places.map((place) => place.id)).toEqual([placeId]);
    await saveBusiness(w.owner, { name: 'Bar Two', kind: 'bar', links: [] }, { propertyId: second });
    expect((await getBusiness(w.owner)).profile?.name).toBe('Somewhere Nowhere');
    expect((await getBusiness(w.owner, { propertyId: second })).profile?.name).toBe('Bar Two');
  });

  it('answers another workspace’s property, or none, as not found', async () => {
    const w = await business();
    const elsewhere = await business();
    const theirs = (await listProperties(elsewhere.owner)).properties[0]?.id ?? '';
    expect(await refusalOf(getBusiness(w.owner, { propertyId: theirs }))).toBe('NOT_FOUND');
    expect(await refusalOf(getBusiness(w.owner, { propertyId: randomUUID() }))).toBe('NOT_FOUND');
    expect(await refusalOf(createPlace(w.owner, { id: randomUUID(), place: PLACE, propertyId: theirs }))).toBe(
      'NOT_FOUND',
    );
    expect(await refusalOf(removeProperty(w.owner, { propertyId: theirs }))).toBe('NOT_FOUND');
  });
});

describe('a property’s currency (AC-6519)', () => {
  it('changes while nothing is priced, and is refused once a dish has a price', async () => {
    const w = await business();
    await installApp(w.owner, { app: 'menu' });
    await saveBusiness(w.owner, { name: 'Somewhere Nowhere', kind: 'restaurant', links: [], currency: 'EUR' });
    expect((await getBusiness(w.owner)).profile?.currency).toBe('EUR');
    const menuId = randomUUID();
    await saveMenu(w.owner, { id: menuId, name: 'Dinner', placeIds: [w.placeId] });
    const sectionId = randomUUID();
    await saveSection(w.owner, { id: sectionId, menuId, name: 'Mains', layout: 'list' });
    await saveItem(w.owner, {
      id: randomUUID(),
      sectionId,
      item: {
        name: 'Soup',
        priceMinor: 650,
        diet: [],
        allergens: [],
        kcal: null,
        featured: false,
        sizes: [],
        groupIds: [],
      },
    });
    await publishMenus(w.owner);
    expect(
      await refusalOf(saveBusiness(w.owner, { name: 'Somewhere Nowhere', kind: 'restaurant', currency: 'JPY' })),
    ).toBe('IN_USE');
    // The same currency again, or none named, saves.
    await saveBusiness(w.owner, { name: 'Renamed', kind: 'restaurant', currency: 'EUR' });
    await saveBusiness(w.owner, { name: 'Renamed again', kind: 'restaurant' });
    expect((await getBusiness(w.owner)).profile).toMatchObject({ name: 'Renamed again', currency: 'EUR' });
  });
});

describe('a menu serves its own business’s places (AC-6514)', () => {
  it('puts a new menu in the business named, and refuses a place of another as not found', async () => {
    const w = await business();
    await installApp(w.owner, { app: 'menu' });
    const second = randomUUID();
    await createProperty(w.owner, { id: second, name: 'Bar', kind: 'bar', currency: 'EUR' });
    const placeId = randomUUID();
    await createPlace(w.owner, { id: placeId, place: PLACE, propertyId: second });
    const menuId = randomUUID();
    // Named nothing, a call works in the first business, where the second's place doesn't exist.
    expect(await refusalOf(saveMenu(w.owner, { id: menuId, name: 'Drinks', placeIds: [placeId] }))).toBe('NOT_FOUND');
    await saveMenu(w.owner, { id: menuId, name: 'Drinks', placeIds: [placeId], propertyId: second });
    const rows = await w.sql<{ property_id: string }>(
      sql`select property_id::text from menus where id = ${menuId}::uuid`,
    );
    expect(rows.rows[0]?.property_id).toBe(second);
    expect(
      await refusalOf(
        saveMenu(w.owner, { id: menuId, name: 'Drinks', placeIds: [placeId, w.placeId], propertyId: second }),
      ),
    ).toBe('NOT_FOUND');
    expect(await refusalOf(saveMenu(w.owner, { id: randomUUID(), name: 'Both', placeIds: [w.placeId, placeId] }))).toBe(
      'NOT_FOUND',
    );
    // The first business can't take the second's menu over by its id.
    expect(await refusalOf(saveMenu(w.owner, { id: menuId, name: 'Mine', placeIds: [w.placeId] }))).toBe('NOT_FOUND');
    // A business with a menu holds something, so it stays.
    expect(await refusalOf(removeProperty(w.owner, { propertyId: second }))).toBe('IN_USE');
  });
});

/** A dish with a price, as the editor saves one. */
const DISH: ItemFields = {
  name: 'Soup',
  priceMinor: 650,
  diet: [],
  allergens: [],
  kcal: null,
  featured: false,
  sizes: [],
  groupIds: [],
};

/** A workspace with Menu on and a second business with a place of its own. */
async function twoBusinesses() {
  const w = await business();
  await installApp(w.owner, { app: 'menu' });
  const second = randomUUID();
  await createProperty(w.owner, { id: second, name: 'Bar', kind: 'bar', currency: 'EUR' });
  const secondPlace = randomUUID();
  await createPlace(w.owner, { id: secondPlace, place: PLACE, propertyId: second });
  return { ...w, second, secondPlace };
}

describe('each business has its own menus (spec 0065 H7, slice 2b)', () => {
  it('keeps its own draft, library and Publish, and answers another business’s parts as not found', async () => {
    const w = await twoBusinesses();
    const at = { propertyId: w.second };
    const menuId = randomUUID();
    await saveMenu(w.owner, { id: menuId, name: 'Drinks', placeIds: [w.secondPlace], ...at });
    const sectionId = randomUUID();
    await saveSection(w.owner, { id: sectionId, menuId, name: 'Wine', layout: 'list', ...at });
    const itemId = randomUUID();
    const draft = await saveItem(w.owner, { id: itemId, sectionId, item: DISH, ...at });
    expect(draft).toMatchObject({ currency: 'EUR', changes: 3 });
    expect(draft.places.map((place) => place.id)).toEqual([w.secondPlace]);
    expect(draft.items.map((item) => item.id)).toEqual([itemId]);
    // The first business sees none of it, and its draft counts nothing.
    const first = await readMenuDraft(w.owner);
    expect(first).toMatchObject({ currency: 'GBP', changes: 0, menus: [], items: [] });
    expect(first.places.map((place) => place.id)).toEqual([w.placeId]);
    // Named from the first, the second's parts don't exist; its id is never taken over.
    expect(await refusalOf(deleteItem(w.owner, { itemId }))).toBe('NOT_FOUND');
    expect(await refusalOf(saveItem(w.owner, { id: itemId, item: { ...DISH, name: 'Mine' } }))).toBe('NOT_FOUND');
    expect(await refusalOf(saveSection(w.owner, { id: randomUUID(), menuId, name: 'X', layout: 'list' }))).toBe(
      'NOT_FOUND',
    );
    const own = randomUUID();
    await saveItem(w.owner, { id: own, item: DISH });
    expect(await refusalOf(placeItem(w.owner, { itemId: own, sectionId, placed: true }))).toBe('NOT_FOUND');
    expect(await refusalOf(placeItem(w.owner, { itemId: own, sectionId, placed: true, ...at }))).toBe('NOT_FOUND');
    // Publish is the business's own: only its place gets a version, and only its count goes back to 0.
    const published = await publishMenus(w.owner, at);
    expect(published.placeIds).toEqual([w.secondPlace]);
    expect(published.draft.changes).toBe(0);
    expect((await readMenuDraft(w.owner)).changes).toBe(1);
    const versions = await w.sql<{ place_id: string }>(sql`select place_id::text from menu_versions`);
    expect(versions.rows.map((row) => row.place_id)).toEqual([w.secondPlace]);
    // Hidden is the business's own too; the first has published nothing to hide.
    expect((await setMenuHidden(w.owner, { hidden: true, ...at })).draft.hidden).toBe(true);
    expect(await refusalOf(setMenuHidden(w.owner, { hidden: true }))).toBe('CONFLICT');
    expect(await refusalOf(discardMenuDraft(w.owner))).toBe('CONFLICT');
    // Discard puts back the second's rows only: the first's unpublished dish stays.
    await deleteItem(w.owner, { itemId, ...at });
    await discardMenuDraft(w.owner, at);
    expect((await readMenuDraft(w.owner, at)).items.map((item) => item.id)).toEqual([itemId]);
    expect((await readMenuDraft(w.owner)).items.map((item) => item.id)).toEqual([own]);
  });

  it('counts dishes per business, and asks only that business’s prices about its currency (AC-6518, AC-6519)', async () => {
    const w = await twoBusinesses();
    const firstId = (await listProperties(w.owner)).properties[0]?.id ?? '';
    await w.sql(sql`insert into menu_items (workspace_id, property_id, name)
      select ${w.workspaceId}::uuid, ${firstId}::uuid, 'Dish ' || n from generate_series(1, 2000) n`);
    expect(await refusalOf(saveItem(w.owner, { id: randomUUID(), item: DISH }))).toBe('LIMIT_REACHED');
    await saveItem(w.owner, { id: randomUUID(), item: DISH, propertyId: w.second });
    // The second has a price, the first none (its 2,000 dishes are unpriced): only the second's currency holds.
    expect(
      await refusalOf(saveBusiness(w.owner, { name: 'Bar', kind: 'bar', currency: 'USD' }, { propertyId: w.second })),
    ).toBe('IN_USE');
    await saveBusiness(w.owner, { name: 'Somewhere Nowhere', kind: 'restaurant', currency: 'USD' });
    expect((await getBusiness(w.owner)).profile?.currency).toBe('USD');
  });

  it('refuses a business that isn’t this workspace’s', async () => {
    const w = await twoBusinesses();
    const elsewhere = await business();
    const theirs = (await listProperties(elsewhere.owner)).properties[0]?.id ?? '';
    expect(await refusalOf(readMenuDraft(w.owner, { propertyId: theirs }))).toBe('NOT_FOUND');
    expect(await refusalOf(publishMenus(w.owner, { propertyId: theirs }))).toBe('NOT_FOUND');
  });
});

describe('each business has its own services and places to serve (spec 0065 H7, slice 2c)', () => {
  it('lists, adds and changes a business’s own services only, and the first reads as it did', async () => {
    const w = await visitWorkspace(db, 'appointments');
    const second = randomUUID();
    await createProperty(w.owner, { id: second, name: 'Spa', kind: 'spa', currency: 'EUR' });
    const secondPlace = randomUUID();
    await createPlace(w.owner, { id: secondPlace, place: PLACE, propertyId: second });
    const at = { propertyId: second };
    const service = (placeId: string): ServiceFields => ({
      name: 'Massage',
      categoryId: null,
      bufferAfterMin: 0,
      online: true,
      staffRule: 'all',
      staffIds: [],
      placeIds: [placeId],
      needs: [],
      variants: [{ name: 'Hour', minutes: 60, priceMinor: 6000, priceType: 'fixed', bufferBeforeMin: 0 }],
    });
    const serviceId = randomUUID();
    // Named nothing, the call works in the first business, where the second's place doesn't exist.
    await expect(saveService(w.owner, { id: serviceId, service: service(secondPlace) })).rejects.toThrow(
      'One of those places doesn’t exist.',
    );
    const made = await saveService(w.owner, { id: serviceId, service: service(secondPlace), ...at });
    expect(made).toMatchObject({ currency: 'EUR', businessKind: 'spa' });
    expect(made.places.map((place) => place.id)).toEqual([secondPlace]);
    expect(made.services.map((each) => each.id)).toEqual([serviceId]);
    const first = await getCatalogue(w.owner);
    expect(first.currency).toBe('GBP');
    expect(first.places.map((place) => place.id)).toEqual([w.placeId]);
    expect(first.services.map((each) => each.id)).not.toContain(serviceId);
    // The first business can't reach the second's service by its id.
    expect(await refusalOf(archiveServices(w.owner, { serviceIds: [serviceId] }))).toBe('NOT_FOUND');
    expect(await refusalOf(saveService(w.owner, { id: serviceId, service: service(w.placeId) }))).toBe('NOT_FOUND');
    const category = randomUUID();
    await saveServiceCategory(w.owner, { id: category, name: 'Body', ...at });
    expect((await getCatalogue(w.owner)).categories).toEqual([]);
    expect(await refusalOf(saveServiceCategory(w.owner, { id: category, name: 'Mine' }))).toBe('NOT_FOUND');
    expect((await archiveServices(w.owner, { serviceIds: [serviceId], ...at })).services[0]?.archived).toBe(true);
  });

  it('lists the chosen business’s places on Reservations', async () => {
    const w = await business();
    const second = randomUUID();
    await createProperty(w.owner, { id: second, name: 'Bar', kind: 'bar', currency: 'EUR' });
    const placeId = randomUUID();
    await createPlace(w.owner, { id: placeId, place: PLACE, propertyId: second });
    expect((await listServicePlaces(w.owner)).places.map((place) => place.id)).toEqual([w.placeId]);
    expect((await listServicePlaces(w.owner, { propertyId: second })).places.map((place) => place.id)).toEqual([
      placeId,
    ]);
  });
});

describe('review fixes (spec 0065 H7)', () => {
  it('discards around an id another business took since, rather than failing', async () => {
    const w = await twoBusinesses();
    const menuId = randomUUID();
    await saveMenu(w.owner, { id: menuId, name: 'Dinner', placeIds: [w.placeId] });
    const sectionId = randomUUID();
    await saveSection(w.owner, { id: sectionId, menuId, name: 'Mains', layout: 'list' });
    const itemId = randomUUID();
    await saveItem(w.owner, { id: itemId, sectionId, item: DISH });
    await publishMenus(w.owner);
    // The first deletes the dish in its draft, and the second takes the id for a dish of its own.
    await deleteItem(w.owner, { itemId });
    await saveItem(w.owner, { id: itemId, item: { ...DISH, name: 'Theirs' }, propertyId: w.second });
    const back = await discardMenuDraft(w.owner);
    expect(back.draft.items).toEqual([]);
    expect(back.draft.menus.map((menu) => menu.id)).toEqual([menuId]);
    expect((await readMenuDraft(w.owner, { propertyId: w.second })).items.map((item) => item.name)).toEqual(['Theirs']);
  });

  it('refuses a service needing another business’s room or chair', async () => {
    const w = await visitWorkspace(db, 'appointments');
    const second = randomUUID();
    await createProperty(w.owner, { id: second, name: 'Spa', kind: 'spa', currency: 'EUR' });
    const secondPlace = randomUUID();
    await createPlace(w.owner, { id: secondPlace, place: PLACE, propertyId: second });
    const chair = randomUUID();
    await w.sql(sql`
      insert into resources (workspace_id, id, place_id, kind, label, min_capacity, max_capacity, position, joins)
      values (${w.workspaceId}::uuid, ${chair}::uuid, ${secondPlace}::uuid, 'chair', 'Chair 1', 1, 1, 0, '{}'::uuid[])
    `);
    const service: ServiceFields = {
      name: 'Cut',
      categoryId: null,
      bufferAfterMin: 0,
      online: true,
      staffRule: 'all',
      staffIds: [],
      placeIds: [w.placeId],
      needs: [{ resourceId: chair }],
      variants: [{ name: 'Short', minutes: 30, priceMinor: 2000, priceType: 'fixed', bufferBeforeMin: 0 }],
    };
    await expect(saveService(w.owner, { id: randomUUID(), service })).rejects.toThrow(
      'One of those rooms or chairs doesn’t exist.',
    );
  });
});

describe('Duplicate to another business (spec 0065 H7, AC-6591)', () => {
  it('copies a menu with its sections and dishes, keeping the numbers, once however often it is sent', async () => {
    const w = await twoBusinesses();
    const menuId = randomUUID();
    await saveMenu(w.owner, { id: menuId, name: 'Dinner', placeIds: [w.placeId] });
    const sectionId = randomUUID();
    await saveSection(w.owner, { id: sectionId, menuId, name: 'Mains', layout: 'list' });
    await saveItem(w.owner, { id: randomUUID(), sectionId, item: DISH });
    const copy = randomUUID();
    const sent = { menuId, toPropertyId: w.second, id: copy };
    const draft = await duplicateMenu(w.owner, sent);
    expect(draft.currency).toBe('EUR');
    expect(draft.menus).toMatchObject([{ id: copy, name: 'Dinner', placeIds: [] }]);
    expect(draft.sections.map((section) => section.name)).toEqual(['Mains']);
    expect(draft.items.map((item) => [item.name, item.priceMinor])).toEqual([['Soup', 650]]);
    expect(draft.sections[0]?.itemIds).toEqual(draft.items.map((item) => item.id));
    // New rows, never the first's: the first's own draft is as it was.
    const first = await readMenuDraft(w.owner);
    expect(first.items.map((item) => item.id)).not.toContain(draft.items[0]?.id);
    expect((await duplicateMenu(w.owner, sent)).menus).toHaveLength(1);
    await expect(
      duplicateMenu(w.owner, {
        menuId,
        toPropertyId: (await listProperties(w.owner)).properties[0]?.id ?? '',
        id: randomUUID(),
      }),
    ).rejects.toThrow('Pick another business.');
  });

  it('copies a service with its options to another business, offered nowhere yet', async () => {
    const w = await visitWorkspace(db, 'appointments');
    const second = randomUUID();
    await createProperty(w.owner, { id: second, name: 'Spa', kind: 'spa', currency: 'EUR' });
    const serviceId = randomUUID();
    await saveService(w.owner, {
      id: serviceId,
      service: {
        name: 'Cut',
        categoryId: null,
        bufferAfterMin: 5,
        online: true,
        staffRule: 'all',
        staffIds: [],
        placeIds: [w.placeId],
        needs: [],
        variants: [{ name: 'Short', minutes: 30, priceMinor: 2000, priceType: 'fixed', bufferBeforeMin: 0 }],
      },
    });
    const copy = randomUUID();
    const there = await duplicateService(w.owner, { serviceId, toPropertyId: second, id: copy });
    expect(there.currency).toBe('EUR');
    expect(there.services).toMatchObject([
      { id: copy, name: 'Cut', online: false, placeIds: [], variants: [{ name: 'Short', priceMinor: 2000 }] },
    ]);
    expect((await getCatalogue(w.owner)).services.map((each) => each.id)).toEqual([serviceId]);
  });
});

describe('Duplicate refuses what it can’t copy (AC-6591)', () => {
  it('answers a copy id held elsewhere, and another workspace’s business, as not found', async () => {
    const w = await twoBusinesses();
    const menuId = randomUUID();
    await saveMenu(w.owner, { id: menuId, name: 'Dinner', placeIds: [w.placeId] });
    expect(await refusalOf(duplicateMenu(w.owner, { menuId, toPropertyId: w.second, id: menuId }))).toBe('NOT_FOUND');
    const elsewhere = await business();
    const theirs = (await listProperties(elsewhere.owner)).properties[0]?.id ?? '';
    expect(await refusalOf(duplicateMenu(w.owner, { menuId, toPropertyId: theirs, id: randomUUID() }))).toBe(
      'NOT_FOUND',
    );
    const counted = await w.sql<{ n: number }>(sql`select count(*)::int as n from menus`);
    expect(counted.rows[0]?.n).toBe(1);
  });

  it('copies no service onto an id another service holds', async () => {
    const w = await visitWorkspace(db, 'appointments');
    const second = randomUUID();
    await createProperty(w.owner, { id: second, name: 'Spa', kind: 'spa', currency: 'EUR' });
    const serviceId = randomUUID();
    await saveService(w.owner, {
      id: serviceId,
      service: {
        name: 'Cut',
        categoryId: null,
        bufferAfterMin: 0,
        online: true,
        staffRule: 'all',
        staffIds: [],
        placeIds: [w.placeId],
        needs: [],
        variants: [{ name: 'Short', minutes: 30, priceMinor: 2000, priceType: 'fixed', bufferBeforeMin: 0 }],
      },
    });
    expect(await refusalOf(duplicateService(w.owner, { serviceId, toPropertyId: second, id: serviceId }))).toBe(
      'NOT_FOUND',
    );
  });
});
