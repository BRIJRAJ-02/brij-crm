// The table path of the visit engine (spec 0066 B0, the preset B7 builds on) against the real Postgres as the app
// role: a party seated best fit with no staff, joined tables, holds by party size, the last start at close less the
// hold, pacing, the lookup code beside the manage token, a retry answering the first visit, two guests racing for
// the last table (one wins, the other is told SLOT_TAKEN with the next free times), and the resource guard
// refusing an overlap that skipped the locks (23P01).
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { LOOKUP_PATTERN } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { NO_CALENDAR } from '../booking/calendar.ts';
import { isRefusal } from '../engine/refusals.ts';
import { rollingWeek } from '../../test/dates-kit.ts';
import { addResource, addService, visitWorkspace, type VisitWorkspace } from '../../test/visits-kit.ts';
import { bookVisit, createSlotCache, isVisitTaken, visitTimes, type VisitBookInput } from './book.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-visits-tables-tests' });
});
afterAll(async () => {
  await db.close();
});

const week = rollingWeek();
const DAY = week.monday;
const deps = { busy: NO_CALENDAR.busy, now: () => new Date(`${week.sunday}T09:00:00Z`) };
/** Wall times in London: a year out from November is GMT, so 18:00 is 18:00Z. */
const zoneOffsetIso = (time: string) => new Date(`${DAY}T${time}:00Z`).toISOString();
const PARTY_HOLDS = [
  { size: 5, minutes: 120 },
  { size: 8, minutes: 150 },
];

async function tablePlace(w: VisitWorkspace) {
  const t1 = await addResource(w, 'T1', { min: 1, max: 2, position: 0 });
  const t2 = await addResource(w, 'T2', { min: 2, max: 4, position: 1 });
  const t3 = await addResource(w, 'T3', { min: 4, max: 6, position: 2, joins: [t2] });
  const table = await addService(w, { name: 'Table', minutes: 90, holdBySize: PARTY_HOLDS, step: 30 });
  return { t1, t2, t3, table };
}

const request = (
  table: { serviceId: string; variantId: string },
  w: VisitWorkspace,
  extra: Partial<VisitBookInput> = {},
): VisitBookInput => ({
  placeId: w.placeId,
  items: [table],
  party: 2,
  start: zoneOffsetIso('19:00'),
  client: { name: 'Grace Hopper', email: `grace-${randomUUID().slice(0, 8)}@example.com` },
  source: 'online',
  idempotencyKey: randomUUID(),
  ...extra,
});

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isRefusal(error)) return { code: error.refusal.code, next: isVisitTaken(error) ? error.next : undefined };
    throw error;
  }
}

describe('tables (no staff, a party fitted best fit)', () => {
  it('offers starts from opening to close less the party’s hold, by its size', async () => {
    const w = await visitWorkspace(db);
    const { table } = await tablePlace(w);
    const two = await visitTimes(w.owner, deps, { placeId: w.placeId, items: [table], party: 2, date: DAY });
    expect(two[0]?.start).toBe(zoneOffsetIso('18:00'));
    expect(two.at(-1)?.start).toBe(zoneOffsetIso('21:30'));
    const six = await visitTimes(w.owner, deps, { placeId: w.placeId, items: [table], party: 6, date: DAY });
    // 120 minutes for five or more: the last start is 21:00.
    expect(six.at(-1)?.start).toBe(zoneOffsetIso('21:00'));
  });

  it('books the smallest table that seats the party, with a lookup code and a manage token, and a retry answers it', async () => {
    const w = await visitWorkspace(db);
    const { t1, t2, t3, table } = await tablePlace(w);
    const input = request(table, w);
    const booked = await bookVisit(w.owner, deps, input);
    expect(booked.replayed).toBe(false);
    expect(booked.lookupCode).toMatch(LOOKUP_PATTERN);
    expect(booked.manageToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(booked.items[0]?.resourceIds).toEqual([t1]);
    expect(booked.end).toBe(zoneOffsetIso('20:30'));
    expect(booked.personRecordId).toBeDefined();
    const again = await bookVisit(w.owner, deps, input);
    expect(again).toMatchObject({ appointmentId: booked.appointmentId, replayed: true, lookupCode: booked.lookupCode });
    expect(again.manageToken).toBeUndefined();
    // A party of eight takes T2 and T3 joined, for 150 minutes.
    const eight = await bookVisit(w.owner, deps, request(table, w, { party: 8 }));
    expect([...(eight.items[0]?.resourceIds ?? [])].sort()).toEqual([t2, t3].sort());
    expect(eight.end).toBe(zoneOffsetIso('21:30'));
    const holds = await w.sql<{ resource_id: string; live: boolean }>(
      sql`select resource_id::text, live from appointment_holds where appointment_id = ${eight.appointmentId}::uuid order by resource_id`,
    );
    expect(holds.rows).toHaveLength(2);
    // The token is kept only as its hash.
    const stored = await w.sql<{ manage_token_hash: string }>(
      sql`select manage_token_hash from appointments where id = ${booked.appointmentId}::uuid`,
    );
    expect(stored.rows[0]?.manage_token_hash).not.toBe(booked.manageToken);
  });

  it('gives the last table to one of two guests at once; the other is told SLOT_TAKEN with the next free times', async () => {
    const w = await visitWorkspace(db);
    await addResource(w, 'T1', { min: 1, max: 4 });
    const table = await addService(w, { name: 'Table', minutes: 90, step: 30 });
    const cache = createSlotCache();
    const racing = { ...deps, slotCache: cache };
    const results = await Promise.allSettled([
      bookVisit(w.owner, racing, request(table, w)),
      bookVisit(w.owner, racing, request(table, w)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((result) => result.status === 'rejected');
    const reason: unknown = lost?.status === 'rejected' ? lost.reason : undefined;
    expect(isVisitTaken(reason)).toBe(true);
    // 19:00 to 20:30 is held: the next free starts are from 20:30.
    expect(isVisitTaken(reason) ? reason.next : []).toEqual([
      zoneOffsetIso('20:30'),
      zoneOffsetIso('21:00'),
      zoneOffsetIso('21:30'),
    ]);
    const offered = await visitTimes(w.owner, racing, { placeId: w.placeId, items: [table], party: 2, date: DAY });
    expect(offered.map((each) => each.start)).not.toContain(zoneOffsetIso('19:00'));
  });

  it('caps covers by pacing across tables', async () => {
    const w = await visitWorkspace(db);
    await addResource(w, 'T1', { min: 1, max: 4 });
    await addResource(w, 'T2', { min: 1, max: 4, position: 1 });
    const table = await addService(w, { name: 'Table', minutes: 90, step: 30, coversCap: 5 });
    await bookVisit(w.owner, deps, request(table, w, { party: 4 }));
    expect(await refusal(bookVisit(w.owner, deps, request(table, w, { party: 2 })))).toMatchObject({
      code: 'SLOT_TAKEN',
    });
    const booked = await bookVisit(w.owner, deps, request(table, w, { party: 1 }));
    expect(booked.replayed).toBe(false);
  });

  it('refuses a resource hold that overlaps another live one in the database itself (AC-6602)', async () => {
    const w = await visitWorkspace(db);
    const { t1, table } = await tablePlace(w);
    const booked = await bookVisit(w.owner, deps, request(table, w));
    const [item] = (
      await w.sql<{ id: string }>(
        sql`select id::text from appointment_items where appointment_id = ${booked.appointmentId}::uuid`,
      )
    ).rows;
    const overlap = w.sql(sql`
      insert into appointment_holds (workspace_id, appointment_id, item_id, place_id, resource_id, during)
      values (${w.workspaceId}::uuid, ${booked.appointmentId}::uuid, ${item?.id ?? ''}::uuid, ${w.placeId}::uuid, ${t1}::uuid,
        tstzrange(${zoneOffsetIso('20:00')}::timestamptz, ${zoneOffsetIso('21:00')}::timestamptz, '[)'))
    `);
    await expect(overlap).rejects.toMatchObject({ cause: { code: '23P01' } });
    // A cancelled visit's holds are not live, and free the table.
    await w.sql(sql`update appointment_holds set live = false where appointment_id = ${booked.appointmentId}::uuid`);
    await w.sql(sql`update appointments set status = 'cancelled' where id = ${booked.appointmentId}::uuid`);
    const again = await bookVisit(w.owner, deps, request(table, w));
    expect(again.items[0]?.resourceIds).toEqual([t1]);
  });

  it('refuses a member without services.calendar, and a workspace without the app', async () => {
    const w = await visitWorkspace(db);
    const { table } = await tablePlace(w);
    const { rescope } = await import('../testing.ts');
    const member = rescope(w.owner, { role: 'member' });
    expect(await refusal(bookVisit(member, deps, request(table, w)))).toMatchObject({ code: 'FORBIDDEN' });
    await w.sql(sql`update workspace_apps set removed_at = now()`);
    expect(await refusal(bookVisit(w.owner, deps, request(table, w)))).toMatchObject({ code: 'APP_NOT_INSTALLED' });
  });
});
