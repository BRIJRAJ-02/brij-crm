// Menu QR per table through the real app (spec 0065, H2): the staff procedures list a place's table codes and replace
// one; a guest's `GET /api/public/menu/:key/tables/:code` names the table, never cached, counting a person's scan once
// a day (a machine's never), answers the same 404 for an old, malformed or foreign code, and is rate limited per
// address. Real sessions, real Postgres.
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { newIp, signInApp, testConnections } from '../test/sign-in.ts';
import { memberWithWorkspace } from '../test/workspace.ts';
import { EDGE_HEADER } from './edge.ts';
import { TEST_EDGE_SECRET } from './testing.ts';

const { ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

function scan(key: string, code: string, init: { ip?: string; userAgent?: string } = {}) {
  return app.request(`/api/public/menu/${key}/tables/${code}`, {
    headers: {
      [EDGE_HEADER]: TEST_EDGE_SECRET,
      'x-forwarded-for': init.ip ?? newIp(),
      'user-agent': init.userAgent ?? PHONE,
    },
  });
}

/** "Somewhere" with Menu and Menu QR installed in one step and three tables, answering its codes. */
async function somewhere() {
  const m = await memberWithWorkspace(app);
  await m.client.hospitality.install({
    workspace: m.slug,
    app: 'menu_qr',
    withNeeded: true,
    business: { name: 'Somewhere', kind: 'restaurant', place: { country: 'GB', timeZone: 'UTC' }, currency: 'GBP' },
    mutationId: newId(),
  });
  const place = (await m.client.hospitality.business({ workspace: m.slug })).places[0];
  if (place === undefined) throw new Error('No place.');
  await m.client.hospitality.addResources({
    workspace: m.slug,
    placeId: place.id,
    kind: 'table',
    labels: ['T1', 'T2', 'Bar 2'],
    minCapacity: 2,
    maxCapacity: 4,
    mutationId: newId(),
  });
  const codes = await m.client.hospitality.qrCodes({ workspace: m.slug, placeId: place.id });
  return { m, placeId: place.id, codes };
}

describe('a table’s QR (spec 0065, H2)', () => {
  it('names the table for the guest’s bar, never cached, and counts a person’s scan once a day', async () => {
    const { m, placeId, codes } = await somewhere();
    const [t1, , bar] = codes.tables;
    if (t1 === undefined || bar === undefined) throw new Error('No tables.');
    const ip = newIp();
    const read = await scan(codes.menuKey, t1.code, { ip });
    expect(read.status).toBe(200);
    expect(read.headers.get('cache-control')).toBe('no-store');
    expect(await read.json()).toEqual({ label: 'T1', name: 'Table 1' });
    expect(await (await scan(codes.menuKey, bar.code)).json()).toEqual({ label: 'Bar 2', name: 'Bar 2' });
    // The same phone again is the same visitor today; a crawler is never counted.
    await scan(codes.menuKey, t1.code, { ip });
    await scan(codes.menuKey, t1.code, { userAgent: 'curl/8.0' });
    const after = await m.client.hospitality.qrCodes({ workspace: m.slug, placeId });
    expect(after.tables.map((table) => table.scans)).toEqual([1, 0, 1]);
  });

  it('stops naming the table once its code is replaced, and answers one 404 for any code that isn’t live', async () => {
    const { m, placeId, codes } = await somewhere();
    const other = await somewhere();
    const [t1] = codes.tables;
    if (t1 === undefined) throw new Error('No tables.');
    const renewed = await m.client.hospitality.regenerateTableCode({
      workspace: m.slug,
      placeId,
      resourceId: t1.id,
      mutationId: newId(),
    });
    const fresh = renewed.tables[0]?.code ?? '';
    expect(fresh).not.toBe(t1.code);
    expect((await scan(codes.menuKey, t1.code)).status).toBe(404);
    expect((await scan(codes.menuKey, fresh)).status).toBe(200);
    // Another workspace's code under this key, a malformed code and a key that names nothing.
    expect((await scan(codes.menuKey, other.codes.tables[0]?.code ?? '')).status).toBe(404);
    expect((await scan(codes.menuKey, 'T1')).status).toBe(404);
    expect((await scan('A'.repeat(16), fresh)).status).toBe(404);
  });

  it('limits one address to 20 reads a minute', async () => {
    const { codes } = await somewhere();
    const code = codes.tables[0]?.code ?? '';
    const ip = newIp();
    for (let read = 0; read < 20; read += 1) expect((await scan(codes.menuKey, code, { ip })).status).toBe(200);
    expect((await scan(codes.menuKey, code, { ip })).status).toBe(429);
    expect((await scan(codes.menuKey, code)).status).toBe(200);
  });
});
