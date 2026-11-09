// Menu QR per table (spec 0065, H2) against the real Postgres as the app role: every table gets its own random code,
// only `hospitality.manage` with Menu QR installed lists or replaces them, a replaced code stops naming its table at
// once, a guest's scan names only a live table of the key's own place (never another place's or workspace's), and a
// scan counts once per visitor and day.
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { TABLE_CODE_PATTERN, type FirstBusiness } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { newId } from '../engine/ids.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { installApp, removeApp } from './apps.ts';
import { addResources, archiveResource } from './floor.ts';
import { createPlace, getBusiness } from './places.ts';
import { enterMenuPage } from './public-menu.ts';
import { listQrCodes, regenerateTableCode, scanTable } from './qr.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-qr-tests' });
});
afterAll(async () => {
  await db.close();
});

const CARD: FirstBusiness = {
  name: 'Somewhere',
  kind: 'restaurant',
  place: { country: 'GB', timeZone: 'Europe/London', city: 'London', addressLine: '1 Example Street' },
  currency: 'GBP',
};

let made = 0;

/** A workspace with Menu and Menu QR installed, four tables and a room at its place, its owner's and a member's scope. */
async function venue() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Somewhere',
    slug: `qr-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const memberId = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${memberId}, 'Bea', 'bea@example.com', 'member', 'system', 'system')`,
    ),
  );
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const member = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: memberId },
    role: 'member',
  });
  await installApp(owner, { app: 'menu_qr', withNeeded: true, business: CARD });
  const placeId = (await getBusiness(owner)).places[0]?.id ?? '';
  await addResources(owner, {
    placeId,
    kind: 'table',
    labels: ['T1', 'T2', 'T3', 'T4'],
    minCapacity: 2,
    maxCapacity: 4,
  });
  await addResources(owner, { placeId, kind: 'room', labels: ['Snug'], minCapacity: 2, maxCapacity: 8 });
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

const visitor = (seed: string) => createHash('sha256').update(seed).digest('hex').slice(0, 32);

describe('table codes (spec 0065, H2)', () => {
  it('gives every live table its own random code, and lists tables only, in order', async () => {
    const v = await venue();
    const codes = await listQrCodes(v.owner, { placeId: v.placeId });
    expect(codes.tables.map((table) => table.label)).toEqual(['T1', 'T2', 'T3', 'T4']);
    expect(codes.menuState).toBe('unpublished');
    expect(codes.placeName).not.toBe('');
    for (const table of codes.tables) {
      expect(table.code).toMatch(TABLE_CODE_PATTERN);
      // Random, so the label can turn up inside by chance; it just never opens with it.
      expect(table.code.toLowerCase().startsWith(table.label.toLowerCase())).toBe(false);
      expect(table.scans).toBe(0);
    }
    expect(new Set(codes.tables.map((table) => table.code)).size).toBe(4);
  });

  it('refuses a member without hospitality.manage, and every caller once Menu QR is removed', async () => {
    const v = await venue();
    expect(await refusalOf(listQrCodes(v.member, { placeId: v.placeId }))).toBe('FORBIDDEN');
    const [first] = (await listQrCodes(v.owner, { placeId: v.placeId })).tables;
    expect(await refusalOf(regenerateTableCode(v.member, { placeId: v.placeId, resourceId: first?.id ?? '' }))).toBe(
      'FORBIDDEN',
    );
    await removeApp(v.owner, { app: 'menu_qr' });
    expect(await refusalOf(listQrCodes(v.owner, { placeId: v.placeId }))).toBe('APP_NOT_INSTALLED');
  });

  it('never lists or replaces another workspace’s place or table', async () => {
    const a = await venue();
    const b = await venue();
    expect(await refusalOf(listQrCodes(b.owner, { placeId: a.placeId }))).toBe('NOT_FOUND');
    const [first] = (await listQrCodes(a.owner, { placeId: a.placeId })).tables;
    expect(await refusalOf(regenerateTableCode(b.owner, { placeId: b.placeId, resourceId: first?.id ?? '' }))).toBe(
      'NOT_FOUND',
    );
    expect((await listQrCodes(a.owner, { placeId: a.placeId })).tables[0]?.code).toBe(first?.code);
  });

  it('replaces one code, and the old print stops naming the table at once', async () => {
    const v = await venue();
    const before = await listQrCodes(v.owner, { placeId: v.placeId });
    const [first, second] = before.tables;
    const entry = await enterMenuPage({ db }, before.menuKey);
    if (entry === undefined || first === undefined || second === undefined) throw new Error('No entry.');
    expect(await scanTable({ db }, entry, first.code)).toEqual({ label: 'T1', name: 'Table 1' });
    const after = await regenerateTableCode(v.owner, { placeId: v.placeId, resourceId: first.id });
    const renewed = after.tables[0];
    expect(renewed?.code).toMatch(TABLE_CODE_PATTERN);
    expect(renewed?.code).not.toBe(first.code);
    expect(after.tables[1]?.code).toBe(second.code);
    expect(await scanTable({ db }, entry, first.code)).toBeUndefined();
    expect(await scanTable({ db }, entry, renewed?.code ?? '')).toEqual({ label: 'T1', name: 'Table 1' });
  });
});

describe('a guest’s scan (spec 0065, H2)', () => {
  it('names only a live table of the key’s own place, and nothing once Menu QR is removed', async () => {
    const v = await venue();
    const other = await createPlace(v.owner, {
      id: newId(),
      place: { name: 'Second', country: 'GB', timeZone: 'Europe/London' },
    });
    await addResources(v.owner, { placeId: other.id, kind: 'table', labels: ['T9'], minCapacity: 2, maxCapacity: 4 });
    const here = await listQrCodes(v.owner, { placeId: v.placeId });
    const there = await listQrCodes(v.owner, { placeId: other.id });
    const entry = await enterMenuPage({ db }, here.menuKey);
    if (entry === undefined) throw new Error('No entry.');
    // Another place's table, a malformed code and a made up one: the same nothing.
    expect(await scanTable({ db }, entry, there.tables[0]?.code ?? '')).toBeUndefined();
    expect(await scanTable({ db }, entry, 'short')).toBeUndefined();
    expect(await scanTable({ db }, entry, 'A'.repeat(22))).toBeUndefined();
    // An archived table's code stops answering.
    const t4 = here.tables[3];
    await archiveResource(v.owner, { placeId: v.placeId, resourceId: t4?.id ?? '' });
    expect(await scanTable({ db }, entry, t4?.code ?? '')).toBeUndefined();
    // Another workspace's key never reaches this workspace's codes.
    const b = await venue();
    const bEntry = await enterMenuPage({ db }, (await listQrCodes(b.owner, { placeId: b.placeId })).menuKey);
    if (bEntry === undefined) throw new Error('No entry.');
    expect(await scanTable({ db }, bEntry, here.tables[0]?.code ?? '')).toBeUndefined();
    await removeApp(v.owner, { app: 'menu_qr' });
    expect(await scanTable({ db }, entry, here.tables[0]?.code ?? '')).toBeUndefined();
  });

  it('counts a scan once per visitor and day, per table', async () => {
    const v = await venue();
    const codes = await listQrCodes(v.owner, { placeId: v.placeId });
    const entry = await enterMenuPage({ db }, codes.menuKey);
    const [t1, t2] = codes.tables;
    if (entry === undefined || t1 === undefined || t2 === undefined) throw new Error('No entry.');
    await scanTable({ db }, entry, t1.code, visitor('a'));
    await scanTable({ db }, entry, t1.code, visitor('a'));
    await scanTable({ db }, entry, t1.code, visitor('b'));
    await scanTable({ db }, entry, t2.code, visitor('a'));
    // Without a visitor (a machine), nothing is counted.
    await scanTable({ db }, entry, t2.code);
    const after = await listQrCodes(v.owner, { placeId: v.placeId });
    expect(after.tables.slice(0, 3).map((table) => table.scans)).toEqual([2, 1, 0]);
  });
});
