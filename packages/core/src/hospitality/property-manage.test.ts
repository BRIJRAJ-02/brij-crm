// Many properties (spec 0065 H7, slice 2): an admin adds and removes them (AC-6516, AC-6590), up to 20 (AC-6518); each
// reads its own places, a place is made in the property named, a property's currency holds while it has prices
// (AC-6519), and another workspace's property is not found.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { visitWorkspace } from '../../test/visits-kit.ts';
import { isRefusal } from '../engine/refusals.ts';
import { testScope } from '../testing.ts';
import { installApp } from './apps.ts';
import { publishMenus, saveItem, saveMenu, saveSection } from './menu.ts';
import { createPlace, getBusiness, saveBusiness } from './places.ts';
import { createProperty, listProperties, removeProperty } from './property.ts';

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
