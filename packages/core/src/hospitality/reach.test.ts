// Who can work where (spec 0065 H7, slice 4, AC-6594 to AC-6597): a member's reach narrows every hospitality read and
// write. A business or place outside reach answers exactly as one that doesn't exist; someone who reaches only some
// places of a business sees it but can't change the whole of it; owners and admins are always every business; a
// change is History's and applies on the next call; and a business a reach names can't be removed.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { visitWorkspace } from '../../test/visits-kit.ts';
import { isRefusal } from '../engine/refusals.ts';
import { testScope } from '../testing.ts';
import { getBusinessPage, setPlaceSlug } from './business-page.ts';
import { listResources } from './floor.ts';
import { getMemberReach, setMemberReach } from './member-reach.ts';
import { duplicateMenu, readMenuDraft, saveMenu } from './menu.ts';
import { createPlace, getBusiness, saveBusiness, updatePlace } from './places.ts';
import { createProperty, listProperties, removeProperty } from './property.ts';
import { listQrCodes } from './qr.ts';
import { getCatalogue } from '../visits/catalogue.ts';
import { getTableSetup, listServiceDay, listServicePlaces, readServiceFloor } from '../visits/table-service.ts';
import { freeTables } from '../visits/walk-in.ts';

let db: Database;

beforeAll(() => {
  db = createDatabase({ url: inject('testDatabase').appUrl, applicationName: 'crm-reach-tests' });
});
afterAll(async () => {
  await db.close();
});

/** The refusal a promise rejects with, as `CODE: message`. */
async function refusalOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isRefusal(error)) return `${error.refusal.code}: ${error.refusal.message}`;
    throw error;
  }
}

const NO_PLACE = 'NOT_FOUND: That place doesn’t exist.';
const NO_BUSINESS = 'NOT_FOUND: That business doesn’t exist.';
const PLACE = { country: 'GB', timeZone: 'Europe/London' } as const;
const MANAGER = ['hospitality.manage', 'hospitality.service', 'services.manage', 'services.calendar'];

/**
 * Two businesses: the first (A, with its place) and Bar (B, with two places). Bea is a plain member holding a custom
 * role with every business permission, so only her reach narrows her.
 */
async function twoBusinesses() {
  const w = await visitWorkspace(db);
  const a = (await listProperties(w.owner)).properties[0]?.id;
  if (a === undefined) throw new Error('No first business.');
  const b = randomUUID();
  await createProperty(w.owner, { id: b, name: 'Bar', kind: 'bar', currency: 'EUR' });
  const b1 = randomUUID();
  const b2 = randomUUID();
  await createPlace(w.owner, { id: b1, place: { name: 'Quay', ...PLACE }, propertyId: b });
  await createPlace(w.owner, { id: b2, place: { name: 'Pier', ...PLACE }, propertyId: b });
  const beaId = randomUUID();
  await w.sql(
    sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${w.workspaceId}, ${beaId}, 'Bea', 'bea@example.com', 'member', 'system', 'system')`,
  );
  const bea = testScope({
    db,
    workspaceId: w.workspaceId,
    actor: { type: 'member', id: beaId },
    role: 'member',
    customRole: { id: randomUUID(), permissions: MANAGER },
  });
  return { ...w, a, b, b1, b2, beaId, bea };
}

describe('a member reached to one business (AC-6594, AC-6595, AC-6596)', () => {
  it('sees every business until limited, then only theirs, and the other answers as one that isn’t there', async () => {
    const w = await twoBusinesses();
    expect((await listProperties(w.bea)).properties.map((p) => p.name)).toEqual(['Somewhere Nowhere', 'Bar']);
    await setMemberReach(w.owner, { memberId: w.beaId, reach: { all: false, properties: [w.a], places: [] } });
    // The switcher and ⌘K list from the same read.
    expect((await listProperties(w.bea)).properties.map((p) => p.id)).toEqual([w.a]);
    // A business outside reach: every read and write by its id, the same answer as a business that doesn't exist.
    expect(await refusalOf(getBusiness(w.bea, { propertyId: w.b }))).toBe(NO_BUSINESS);
    expect(await refusalOf(getBusiness(w.bea, { propertyId: randomUUID() }))).toBe(NO_BUSINESS);
    expect(await refusalOf(readMenuDraft(w.bea, { propertyId: w.b }))).toBe(NO_BUSINESS);
    expect(await refusalOf(saveMenu(w.bea, { id: randomUUID(), name: 'Late', placeIds: [], propertyId: w.b }))).toBe(
      NO_BUSINESS,
    );
    expect(await refusalOf(getCatalogue(w.bea, { propertyId: w.b }))).toBe(NO_BUSINESS);
    expect(await refusalOf(getBusinessPage(w.bea, { propertyId: w.b }))).toBe(NO_BUSINESS);
    expect(await refusalOf(listServicePlaces(w.bea, { propertyId: w.b }))).toBe(NO_BUSINESS);
    // A place outside reach, by its id: the same answer as a place that doesn't exist.
    for (const call of [
      () => updatePlace(w.bea, { placeId: w.b1, place: { name: 'Mine now', ...PLACE } }),
      () => listResources(w.bea, { placeId: w.b1 }),
      () => listQrCodes(w.bea, { placeId: w.b1 }),
      () => getTableSetup(w.bea, { placeId: w.b1 }),
      () => readServiceFloor(w.bea, { placeId: w.b1 }),
      () => listServiceDay(w.bea, { placeId: w.b1, date: '2026-11-10' }),
      () => freeTables(w.bea, { placeId: w.b1, party: 2 }),
    ]) {
      expect(await refusalOf(call())).toBe(NO_PLACE);
    }
    expect(await refusalOf(setPlaceSlug(w.bea, { placeId: w.b1, slug: 'quay', propertyId: w.b }))).toBe(NO_BUSINESS);
    // Their own business reads as before, and its place list names no other business's place, not even by id.
    expect((await getBusiness(w.bea)).places.map((p) => p.id)).toEqual([w.placeId]);
    const service = await listServicePlaces(w.bea);
    expect(service.places.map((p) => p.id)).toEqual([w.placeId]);
    expect(service.elsewhere).toBeUndefined();
    // Copying a menu into a business outside reach is refused like a business that isn't there.
    const menuId = randomUUID();
    await saveMenu(w.bea, { id: menuId, name: 'Dinner', placeIds: [w.placeId] });
    expect(
      await refusalOf(duplicateMenu(w.bea, { menuId, toPropertyId: w.b, id: randomUUID(), propertyId: w.a })),
    ).toBe(NO_BUSINESS);
  });

  it('reaches every place of their business, including one added after the reach was set', async () => {
    const w = await twoBusinesses();
    await setMemberReach(w.owner, { memberId: w.beaId, reach: { all: false, properties: [w.b], places: [] } });
    const later = randomUUID();
    await createPlace(w.owner, { id: later, place: { name: 'Dock', ...PLACE }, propertyId: w.b });
    expect((await getBusiness(w.bea)).places.map((p) => p.name)).toEqual(['Quay', 'Pier', 'Dock']);
    expect((await listResources(w.bea, { placeId: later })).placeId).toBe(later);
    expect(await refusalOf(listResources(w.bea, { placeId: w.placeId }))).toBe(NO_PLACE);
  });
});

describe('a member reached to some places of a business (AC-6594)', () => {
  it('sees the business and works in those places only; the whole business is not theirs to change', async () => {
    const w = await twoBusinesses();
    await setMemberReach(w.owner, { memberId: w.beaId, reach: { all: false, properties: [], places: [w.b1] } });
    expect((await listProperties(w.bea)).properties.map((p) => p.id)).toEqual([w.b]);
    // Left out, the business is the first they see.
    const view = await getBusiness(w.bea);
    expect(view.places.map((p) => p.id)).toEqual([w.b1]);
    expect(view.canEdit).toBe(false);
    expect((await readMenuDraft(w.bea)).places.map((p) => p.id)).toEqual([w.b1]);
    expect((await updatePlace(w.bea, { placeId: w.b1, place: { name: 'Quayside', ...PLACE } })).name).toBe('Quayside');
    expect(await refusalOf(updatePlace(w.bea, { placeId: w.b2, place: { name: 'No', ...PLACE } }))).toBe(NO_PLACE);
    for (const call of [
      () => saveBusiness(w.bea, { name: 'Renamed', kind: 'bar' }, { propertyId: w.b }),
      () => saveMenu(w.bea, { id: randomUUID(), name: 'Late', placeIds: [w.b1] }),
      () => createPlace(w.bea, { id: randomUUID(), place: { name: 'Mine', ...PLACE }, propertyId: w.b }),
    ]) {
      expect((await refusalOf(call()))?.startsWith('FORBIDDEN: You work in some of this business’s places only')).toBe(
        true,
      );
    }
  });
});

describe('setting reach (AC-6594, AC-6597)', () => {
  it('is History’s, applies on the next call, never narrows an owner, and a repeat writes nothing', async () => {
    const w = await twoBusinesses();
    const audits = async () =>
      (
        await w.sql<{ after: { all: boolean } }>(
          sql`select after from audit_events where action = 'member.reach_changed' order by at`,
        )
      ).rows;
    const view = await setMemberReach(w.owner, {
      memberId: w.beaId,
      reach: { all: false, properties: [w.b], places: [w.b1] },
    });
    // A place whose business is chosen whole is dropped: the business takes it in.
    expect(view.reach).toEqual({ all: false, properties: [w.b], places: [] });
    expect(view.fixed).toBe(false);
    expect(view.businesses.map((business) => [business.name, business.places.length])).toEqual([
      ['Somewhere Nowhere', 1],
      ['Bar', 2],
    ]);
    await setMemberReach(w.owner, { memberId: w.beaId, reach: { all: false, properties: [w.b], places: [] } });
    expect(await audits()).toHaveLength(1);
    await setMemberReach(w.owner, { memberId: w.beaId, reach: { all: true, properties: [], places: [] } });
    expect((await audits()).map((row) => row.after.all)).toEqual([false, true]);
    expect((await listProperties(w.bea)).properties).toHaveLength(2);
    expect((await getMemberReach(w.owner, { memberId: w.beaId })).reach.all).toBe(true);
    // The owner is always every business.
    expect(
      await refusalOf(
        setMemberReach(w.owner, { memberId: w.memberId, reach: { all: false, properties: [w.a], places: [] } }),
      ),
    ).toBe('CONFLICT: Owners and admins work in every business.');
    expect((await getMemberReach(w.owner, { memberId: w.memberId })).fixed).toBe(true);
    // Nothing that isn't there, and never an empty choice.
    expect(
      await refusalOf(
        setMemberReach(w.owner, { memberId: w.beaId, reach: { all: false, properties: [randomUUID()], places: [] } }),
      ),
    ).toBe(NO_BUSINESS);
    await expect(
      setMemberReach(w.owner, { memberId: w.beaId, reach: { all: false, properties: [], places: [] } }),
    ).rejects.toThrow('Pick at least one business or place.');
  });

  it('is an admin’s, and never by someone who doesn’t reach every business', async () => {
    const w = await twoBusinesses();
    expect(
      (
        await refusalOf(
          setMemberReach(w.bea, { memberId: w.beaId, reach: { all: false, properties: [w.a], places: [] } }),
        )
      )?.startsWith('FORBIDDEN'),
    ).toBe(true);
    // A custom role never carries `workspace.manage`, so nobody who can be limited reaches this at all; the service
    // still refuses anyone limited (defence in depth), which no scope the door mints can show.
    const asCustom = testScope({
      db,
      workspaceId: w.workspaceId,
      actor: { type: 'member', id: w.beaId },
      role: 'member',
      customRole: { id: randomUUID(), permissions: [...MANAGER, 'workspace.manage'] },
    });
    expect(
      (
        await refusalOf(
          setMemberReach(asCustom, { memberId: w.beaId, reach: { all: true, properties: [], places: [] } }),
        )
      )?.startsWith('FORBIDDEN'),
    ).toBe(true);
  });

  it('keeps a business a reach names from being removed, so the reach never widens to everything', async () => {
    const w = await twoBusinesses();
    const empty = randomUUID();
    await createProperty(w.owner, { id: empty, name: 'Cafe', kind: 'bar', currency: 'GBP' });
    await setMemberReach(w.owner, { memberId: w.beaId, reach: { all: false, properties: [empty], places: [] } });
    expect(await refusalOf(removeProperty(w.owner, { propertyId: empty }))).toBe(
      'IN_USE: Someone works in this business. Change where they work in Members first.',
    );
    await setMemberReach(w.owner, { memberId: w.beaId, reach: { all: true, properties: [], places: [] } });
    expect((await removeProperty(w.owner, { propertyId: empty })).properties).toHaveLength(2);
  });
});
