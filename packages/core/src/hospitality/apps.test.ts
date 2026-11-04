// The Hospitality setup (spec 0065, H0) against the real Postgres as the app role: early access gates the Apps page
// (AC-6501, AC-6502), only admins install and remove (AC-6503), Menu QR needs Menu (AC-6505), the first install takes
// the business card and seeds Floor staff (AC-6506, AC-6511), every setup service refuses APP_NOT_INSTALLED once the
// apps are removed (AC-6504), and a place's floor keeps its limits, labels and joins (AC-6509), never another
// workspace's.
import { sql } from 'drizzle-orm';
import { PERMISSIONS, type FirstBusiness } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { newId } from '../engine/ids.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { readNav } from '../navigation/navigation.ts';
import { setEarlyAccess } from '../operator/early-access.ts';
import { testScope } from '../testing.ts';
import { installApp, listApps, removeApp } from './apps.ts';
import {
  addResources,
  archiveResource,
  deleteArea,
  deleteResource,
  moveResource,
  listResources,
  restoreResource,
  saveArea,
  updateResource,
} from './floor.ts';
import { createPlace, getBusiness, saveBusiness, updatePlace } from './places.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-hospitality-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;

/** A workspace, its owner's scope, and a plain member's, with early access opened unless `closed`. */
async function workspace(closed = false) {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Somewhere',
    slug: `hosp-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const memberId = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${memberId}, 'Bea', 'bea@example.com', 'member', 'system', 'system')`,
    ),
  );
  if (!closed) await setEarlyAccess({ db }, { workspaceId: created.workspaceId, flag: 'business_apps', on: true });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const member = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: memberId },
    role: 'member',
  });
  return { ...created, owner, member };
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

const CARD: FirstBusiness = {
  name: 'Somewhere Nowhere',
  kind: 'restaurant',
  place: { country: 'GB', timeZone: 'Europe/London', city: 'London', addressLine: '1 Example Street' },
  currency: 'GBP',
};

describe('apps behind early access (AC-6501, AC-6502)', () => {
  it('shows nothing about the apps until Timefix opens early access, and refuses an install', async () => {
    const w = await workspace(true);
    expect(await listApps(w.owner)).toEqual({ available: false, canManage: true, hasBusiness: false, apps: [] });
    expect(await refusalOf(installApp(w.owner, { app: 'menu', business: CARD }))).toBe('NOT_FOUND');
    const opened = await setEarlyAccess({ db }, { workspaceId: w.workspaceId, flag: 'business_apps', on: true });
    expect(opened).toEqual({ workspaceId: w.workspaceId, before: [], after: ['business_apps'] });
    const view = await listApps(w.member);
    expect(view.available).toBe(true);
    expect(view.canManage).toBe(false);
    expect(view.apps.map((app) => [app.app, app.installed])).toEqual([
      ['menu', false],
      ['menu_qr', false],
      ['table_seating', false],
    ]);
  });

  it('answers NOT_FOUND for a workspace that isn’t there', async () => {
    expect(await refusalOf(setEarlyAccess({ db }, { workspaceId: newId(), flag: 'business_apps', on: true }))).toBe(
      'NOT_FOUND',
    );
  });
});

describe('install and remove (AC-6503 to AC-6506, AC-6511)', () => {
  it('lets only an admin install, asks for Menu with Menu QR and the business card first, and seeds Floor staff', async () => {
    const w = await workspace();
    expect(await refusalOf(installApp(w.member, { app: 'menu', business: CARD }))).toBe('FORBIDDEN');
    expect(await refusalOf(installApp(w.owner, { app: 'menu_qr', business: CARD }))).toBe('APP_NEEDED');
    expect(await refusalOf(installApp(w.owner, { app: 'menu_qr', withNeeded: true }))).toBe('BUSINESS_NEEDED');
    const view = await installApp(w.owner, { app: 'menu_qr', withNeeded: true, business: CARD });
    expect(view.hasBusiness).toBe(true);
    expect(view.apps.filter((app) => app.installed).map((app) => app.app)).toEqual(['menu', 'menu_qr']);

    const business = await getBusiness(w.owner);
    expect(business.profile).toMatchObject({ name: 'Somewhere Nowhere', kind: 'restaurant', currency: 'GBP' });
    expect(business.places).toHaveLength(1);
    expect(business.places[0]).toMatchObject({
      name: 'Somewhere Nowhere',
      country: 'GB',
      locale: 'en-GB',
      resourceCount: 0,
    });

    const roles = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ name: string; permissions: string[]; level: string }>(
        sql`select name, permissions, default_object_level as level from workspace_roles`,
      ),
    );
    expect(roles.rows).toEqual([{ name: 'Floor staff', permissions: ['hospitality.service'], level: 'read' }]);

    // A second install needs no card and seeds nothing more.
    await installApp(w.owner, { app: 'table_seating' });
    const again = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from workspace_roles`),
    );
    expect(again.rows).toEqual([{ n: 1 }]);
  });

  it('asks before removing Menu under Menu QR, keeps every row, and gates the setup until an app is back', async () => {
    const w = await workspace();
    await installApp(w.owner, { app: 'menu_qr', withNeeded: true, business: CARD });
    expect(await refusalOf(removeApp(w.owner, { app: 'menu' }))).toBe('APP_NEEDED');
    expect(await refusalOf(removeApp(w.member, { app: 'menu', withDependents: true }))).toBe('FORBIDDEN');
    const view = await removeApp(w.owner, { app: 'menu', withDependents: true });
    expect(view.apps.every((app) => !app.installed)).toBe(true);
    expect(await refusalOf(getBusiness(w.owner))).toBe('APP_NOT_INSTALLED');
    const kept = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from workspace_apps where removed_at is not null`),
    );
    expect(kept.rows).toEqual([{ n: 2 }]);
    await installApp(w.owner, { app: 'menu' });
    expect((await getBusiness(w.owner)).places).toHaveLength(1);
    // Closing early access closes the apps too.
    await setEarlyAccess({ db }, { workspaceId: w.workspaceId, flag: 'business_apps', on: false });
    expect(await refusalOf(getBusiness(w.owner))).toBe('APP_NOT_INSTALLED');
  });
});

describe('the sidebar’s Hospitality section (AC-6510)', () => {
  it('holds the installed apps’ pages, for those who may set up or run service only', async () => {
    const w = await workspace();
    expect((await readNav(w.owner)).hospitality).toEqual([]);
    await installApp(w.owner, { app: 'menu', business: CARD });
    expect((await readNav(w.owner)).hospitality).toEqual(['menus']);
    await installApp(w.owner, { app: 'table_seating' });
    expect((await readNav(w.owner)).hospitality).toEqual(['menus', 'reservations', 'service']);
    // A plain member holds neither permission, so sees no section at all.
    expect((await readNav(w.member)).hospitality).toEqual([]);
  });
});

describe('the business and its places (AC-6507, AC-6508)', () => {
  it('refuses a member without Manage hospitality with the catalog sentence', async () => {
    const w = await workspace();
    await installApp(w.owner, { app: 'menu', business: CARD });
    await expect(getBusiness(w.member)).rejects.toMatchObject({
      refusal: { code: 'FORBIDDEN', message: PERMISSIONS['hospitality.manage'].message },
    });
  });

  it('saves the profile, adds places up to 20 and stores checked hours', async () => {
    const w = await workspace();
    await installApp(w.owner, { app: 'table_seating', business: CARD });
    const saved = await saveBusiness(w.owner, {
      name: 'Somewhere Nowhere',
      kind: 'bar',
      description: 'Small plates and natural wine.',
      email: '',
      links: [{ network: 'instagram', href: 'https://www.instagram.com/somewhere' }],
    });
    expect(saved).toMatchObject({ kind: 'bar', description: 'Small plates and natural wine.' });
    expect(saved.email).toBeUndefined();

    const id = newId();
    const place = await createPlace(w.owner, { id, place: { name: 'Soho', country: 'FR', timeZone: 'Europe/Paris' } });
    expect(place.locale).toBe('fr-FR');
    // A retry with the same id makes one place.
    await createPlace(w.owner, { id, place: { name: 'Soho', country: 'FR', timeZone: 'Europe/Paris' } });
    expect((await getBusiness(w.owner)).places).toHaveLength(2);

    const hours = {
      weekly: { fri: [{ from: '18:00', to: '02:00', name: 'Dinner' }] },
      exceptions: [{ date: '2026-12-25', closed: true, note: 'Christmas' }],
    };
    expect((await updatePlace(w.owner, { placeId: id, hours })).hours).toEqual(hours);
    expect(
      await refusalOf(
        updatePlace(w.owner, {
          placeId: id,
          hours: {
            weekly: {
              mon: [
                { from: '12:00', to: '15:00' },
                { from: '14:00', to: '16:00' },
              ],
            },
            exceptions: [],
          },
        }),
      ),
    ).toBe('INPUT_INVALID');

    for (let index = 2; index < 20; index += 1) {
      await createPlace(w.owner, {
        id: newId(),
        place: { name: `Place ${String(index)}`, country: 'GB', timeZone: 'UTC' },
      });
    }
    expect(
      await refusalOf(
        createPlace(w.owner, { id: newId(), place: { name: 'One more', country: 'GB', timeZone: 'UTC' } }),
      ),
    ).toBe('LIMIT_REACHED');
  });
});

describe('a place’s floor (AC-6509)', () => {
  async function floorOf() {
    const w = await workspace();
    await installApp(w.owner, { app: 'table_seating', business: CARD });
    const [place] = (await getBusiness(w.owner)).places;
    if (place === undefined) throw new Error('No place.');
    return { ...w, placeId: place.id };
  }

  it('adds T1 to T10 at once, refuses a label it has, reorders, joins both ways, archives and deletes', async () => {
    const w = await floorOf();
    let floor = await saveArea(w.owner, { placeId: w.placeId, name: 'Terrace' });
    const terrace = floor.areas[0]?.id;
    expect(terrace).toBeDefined();
    expect(await refusalOf(saveArea(w.owner, { placeId: w.placeId, name: 'terrace' }))).toBe('NAME_TAKEN');

    const labels = Array.from({ length: 10 }, (_, index) => `T${String(index + 1)}`);
    floor = await addResources(w.owner, {
      placeId: w.placeId,
      kind: 'table',
      labels,
      minCapacity: 2,
      maxCapacity: 4,
      areaId: terrace,
    });
    expect(floor.resources.map((table) => table.label)).toEqual(labels);
    expect(floor.resources.every((table) => table.areaId === terrace && table.online)).toBe(true);
    expect(
      await refusalOf(
        addResources(w.owner, { placeId: w.placeId, kind: 'table', labels: ['t4'], minCapacity: 2, maxCapacity: 2 }),
      ),
    ).toBe('NAME_TAKEN');

    const [t1, t2, t3] = floor.resources;
    if (t1 === undefined || t2 === undefined || t3 === undefined) throw new Error('No tables.');
    floor = await moveResource(w.owner, { placeId: w.placeId, resourceId: t3.id, toIndex: 0 });
    expect(floor.resources.slice(0, 3).map((table) => table.label)).toEqual(['T3', 'T1', 'T2']);

    floor = await updateResource(w.owner, { placeId: w.placeId, resourceId: t1.id, joins: [t2.id, t3.id] });
    expect(floor.resources.find((table) => table.id === t2.id)?.joins).toEqual([t1.id]);
    floor = await updateResource(w.owner, { placeId: w.placeId, resourceId: t1.id, joins: [t3.id] });
    expect(floor.resources.find((table) => table.id === t2.id)?.joins).toEqual([]);
    expect(
      await refusalOf(
        updateResource(w.owner, { placeId: w.placeId, resourceId: t1.id, minCapacity: 6, maxCapacity: 4 }),
      ),
    ).toBe('CONFIG_INVALID');

    // Archived, its label is free; brought back while a live table holds it, it is refused.
    floor = await archiveResource(w.owner, { placeId: w.placeId, resourceId: t2.id });
    expect(floor.resources.at(-1)).toMatchObject({ id: t2.id, archived: true });
    await addResources(w.owner, { placeId: w.placeId, kind: 'table', labels: ['T2'], minCapacity: 2, maxCapacity: 2 });
    expect(await refusalOf(restoreResource(w.owner, { placeId: w.placeId, resourceId: t2.id }))).toBe('NAME_TAKEN');

    // Deleting a table takes it out of every join, and leaves its line in History; deleting an area keeps its tables.
    floor = await deleteResource(w.owner, { placeId: w.placeId, resourceId: t3.id });
    const audited = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ what: string }>(
        sql`select after ->> 'hospitality' as what from audit_events where after ? 'hospitality' order by at desc limit 1`,
      ),
    );
    expect(audited.rows).toEqual([{ what: 'resource.deleted' }]);
    expect(floor.resources.find((table) => table.id === t1.id)?.joins).toEqual([]);
    floor = await deleteArea(w.owner, { placeId: w.placeId, areaId: terrace ?? '' });
    expect(floor.areas).toEqual([]);
    expect(floor.resources.some((table) => table.areaId !== undefined)).toBe(false);
  });

  it('never reaches another workspace’s place', async () => {
    const a = await floorOf();
    const b = await floorOf();
    expect(await refusalOf(listResources(b.owner, { placeId: a.placeId }))).toBe('NOT_FOUND');
    expect(
      await refusalOf(
        addResources(b.owner, { placeId: a.placeId, kind: 'table', labels: ['X1'], minCapacity: 1, maxCapacity: 2 }),
      ),
    ).toBe('NOT_FOUND');
  });

  it('keeps a place to 300 live tables', async () => {
    const w = await floorOf();
    for (let start = 1; start <= 300; start += 100) {
      const labels = Array.from({ length: 100 }, (_, index) => `T${String(start + index)}`);
      await addResources(w.owner, { placeId: w.placeId, kind: 'table', labels, minCapacity: 2, maxCapacity: 4 });
    }
    expect(
      await refusalOf(
        addResources(w.owner, { placeId: w.placeId, kind: 'table', labels: ['Bar 1'], minCapacity: 1, maxCapacity: 2 }),
      ),
    ).toBe('LIMIT_REACHED');
  });
});
