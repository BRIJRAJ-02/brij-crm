// The property in the services (spec 0065 H7, slice 1): a workspace's one property holds what the old profile held, a
// property nobody set up still reads as "no business", and prices and guest pages read their own property.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { addService, visitWorkspace } from '../../test/visits-kit.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { getCatalogue, saveServiceCategory } from '../visits/catalogue.ts';
import { readTablePage } from '../visits/public.ts';
import { getTableSetup } from '../visits/table-service.ts';
import { enterTablePage } from '../access/table-door.ts';
import { updateWorkspace } from '../workspace/settings.ts';
import { installApp, listApps } from './apps.ts';
import { getBusinessPage } from './business-page.ts';
import { publishMenus, readMenuDraft, saveItem, saveMenu, saveSection } from './menu.ts';
import { getBusiness, saveBusiness } from './places.ts';
import { currentProperty } from './property.ts';
import { enterMenuPage, readPublicMenu } from './public-menu.ts';

let db: Database;

beforeAll(() => {
  db = createDatabase({ url: inject('testDatabase').appUrl, applicationName: 'crm-property-tests' });
});
afterAll(async () => {
  await db.close();
});

const CARD = {
  name: 'Somewhere Nowhere',
  kind: 'restaurant',
  place: { country: 'GB', timeZone: 'Europe/London', city: 'London', addressLine: '1 Example Street' },
  currency: 'GBP',
} as const;

/** A workspace with nothing set up (every app on by default). */
async function empty() {
  const created = await createWorkspace(db, {
    name: 'Somewhere',
    slug: `property-${randomUUID().slice(0, 12)}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  return { ...created, owner };
}

describe('a workspace’s one property (AC-6512, AC-6513)', () => {
  it('reads as no business until the first install’s card sets it up, on the row every workspace already has', async () => {
    const w = await empty();
    const before = await db.withWorkspace(w.workspaceId, (tx) => currentProperty(tx, w.workspaceId));
    expect(before).toMatchObject({ name: null, kind: null, currency: null });
    expect((await listApps(w.owner)).hasBusiness).toBe(false);

    await installApp(w.owner, { app: 'menu', business: CARD });

    const after = await db.withWorkspace(w.workspaceId, (tx) => currentProperty(tx, w.workspaceId));
    expect(after).toMatchObject({ id: before.id, name: CARD.name, kind: CARD.kind, currency: 'GBP' });
    expect((await listApps(w.owner)).hasBusiness).toBe(true);
    expect((await getBusiness(w.owner)).profile).toMatchObject({ name: CARD.name, currency: 'GBP' });
    const rows = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ n: number; own: number }>(sql`
        select count(*)::int as n, count(*) filter (where property_id = ${before.id}::uuid)::int as own from places`),
    );
    expect(rows.rows).toEqual([{ n: 1, own: 1 }]);
  });

  it('keeps an existing workspace currency, as it did before there were properties', async () => {
    const w = await empty();
    await updateWorkspace(w.owner, { currency: 'EUR' });
    await installApp(w.owner, { app: 'menu', business: CARD });
    expect((await getBusiness(w.owner)).profile?.currency).toBe('EUR');
  });

  it('stamps what it makes with the property, and saves onto the same row', async () => {
    const w = await visitWorkspace(db, 'appointments');
    const { id } = await db.withWorkspace(w.workspaceId, (tx) => currentProperty(tx, w.workspaceId));
    await saveServiceCategory(w.owner, { id: randomUUID(), name: 'Hair' });
    await installApp(w.owner, { app: 'menu' });
    await saveMenu(w.owner, { id: randomUUID(), name: 'Dinner', placeIds: [w.placeId] });
    await addService(w);
    await saveBusiness(w.owner, { name: 'Renamed', kind: 'bar', links: [] });
    const found = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{
        properties: number;
        name: string;
        categories: number;
        menus: number;
        links: number;
        services: number;
        placeLinks: number;
      }>(sql`
        select (select count(*)::int from properties) as properties,
          (select name from properties) as name,
          (select count(*)::int from service_categories where property_id = ${id}::uuid) as categories,
          (select count(*)::int from menus where property_id = ${id}::uuid) as menus,
          (select count(*)::int from menu_places where property_id = ${id}::uuid) as links,
          (select count(*)::int from services where property_id = ${id}::uuid) as services,
          (select count(*)::int from service_places where property_id = ${id}::uuid) as "placeLinks"`),
    );
    expect(found.rows[0]).toMatchObject({ properties: 1, name: 'Renamed', categories: 1, menus: 1, links: 1 });
    expect(found.rows[0]?.services).toBeGreaterThan(0);
    expect(found.rows[0]?.placeLinks).toBeGreaterThan(0);
  });

  it('opens the business page on the property, with one page row per property', async () => {
    const w = await visitWorkspace(db);
    const view = await getBusinessPage(w.owner);
    expect(view.suggestedHandle).toBeDefined();
    const empties = await empty();
    // Nobody has set the property up: the page opens with no name, so it suggests no handle.
    expect((await getBusinessPage(empties.owner)).suggestedHandle).toBeUndefined();
  });
});

describe('prices read the property’s currency (AC-6522, AC-6532, AC-6610)', () => {
  it('follows Settings > Workspace, the only place that sets it in this slice', async () => {
    const w = await visitWorkspace(db, 'appointments');
    await installApp(w.owner, { app: 'menu' });
    expect((await readMenuDraft(w.owner)).currency).toBe('GBP');
    await updateWorkspace(w.owner, { currency: 'EUR' });
    expect((await readMenuDraft(w.owner)).currency).toBe('EUR');
    expect((await getCatalogue(w.owner)).currency).toBe('EUR');
  });

  it('reads the property, not the workspace, and US dollars with neither', async () => {
    const w = await visitWorkspace(db, 'appointments');
    await installApp(w.owner, { app: 'menu' });
    await w.sql(sql`update properties set currency = 'JPY'`);
    expect((await readMenuDraft(w.owner)).currency).toBe('JPY');
    expect((await getBusiness(w.owner)).profile?.currency).toBe('JPY');
    expect((await getCatalogue(w.owner)).currency).toBe('JPY');
    await w.sql(sql`update properties set currency = null`);
    expect((await readMenuDraft(w.owner)).currency).toBe('USD');
  });
});

describe('guest pages read the place’s own property (AC-6514, AC-6515)', () => {
  it('names the property a place belongs to, on the menu and on the reservation page', async () => {
    const w = await visitWorkspace(db);
    await installApp(w.owner, { app: 'menu' });
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
    const second = randomUUID();
    await w.sql(sql`insert into properties (workspace_id, id, name, kind, position)
      values (${w.workspaceId}::uuid, ${second}::uuid, 'The other brand', 'bar', 1)`);
    const other = randomUUID();
    const { publicKey } = await getTableSetup(w.owner, { placeId: w.placeId });
    await w.sql(sql`
      insert into places (workspace_id, id, property_id, name, country, time_zone, locale, public_key, menu_key, position)
      values (${w.workspaceId}::uuid, ${other}::uuid, ${second}::uuid, 'Elsewhere', 'GB', 'Europe/London', 'en-GB',
        ${randomUUID().replaceAll('-', '').slice(0, 16)}, ${randomUUID().replaceAll('-', '').slice(0, 16)}, 1)`);
    const keys = await w.sql<{ id: string; menu_key: string; public_key: string }>(
      sql`select id::text, menu_key, public_key from places`,
    );
    const key = (id: string) => keys.rows.find((row) => row.id === id);
    await w.sql(sql`
      insert into menu_versions (workspace_id, place_id, version, snapshot)
      values (${w.workspaceId}::uuid, ${other}::uuid, 1, '{"currency":"GBP","menus":[],"items":{},"groups":{}}'::jsonb)`);
    const guest = async (menuKey: string) => {
      const entry = await enterMenuPage({ db }, menuKey);
      return entry === undefined ? undefined : readPublicMenu({ db }, entry);
    };
    expect((await guest(key(w.placeId)?.menu_key ?? ''))?.menu.business.name).toBe('Somewhere Nowhere');
    expect((await guest(key(other)?.menu_key ?? ''))?.menu.business.name).toBe('The other brand');
    const page = await readTablePage(await enterTablePage({ db }, key(other)?.public_key ?? publicKey));
    expect(page.business.name).toBe('The other brand');
  });
});
