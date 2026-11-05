// Walk ins (spec 0066 B7 lite) against the real Postgres: the free tables for a party come best fit first (the smallest
// single table, then joins), a table held by a coming reservation inside the party's hold isn't offered, a walk in
// seats now and takes its table off the list, the same table twice is SLOT_TAKEN and tables that never seat the party
// are INPUT_INVALID, a retry answers the first visit, and a member without Run service gets nothing.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { NO_CALENDAR } from '../booking/calendar.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { rescope } from '../testing.ts';
import { addResource, visitWorkspace, waiterScope } from '../../test/visits-kit.ts';
import { getTableSetup, listServiceDay, saveTableSetup } from './table-service.ts';
import { bookVisit } from './book.ts';
import { freeTables, reserveForGuest, seatWalkIn } from './walk-in.ts';
import { readTableService } from './table-service.ts';
import { inWorkspace } from '../access/run.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-visits-walk-in-tests' });
});
afterAll(async () => {
  await db.close();
});

/** A Tuesday evening, 19:00 in London (GMT in winter): every test seats "now". */
const NOW = new Date('2030-01-15T19:00:00.000Z');
const clock = { now: () => NOW };

async function refusal(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isInputError(error)) return `INPUT:${error.inputProblem.field}`;
    if (isRefusal(error)) return error.refusal.code;
    throw error;
  }
}

async function floor() {
  const w = await visitWorkspace(db);
  const small = await addResource(w, 'T1', { min: 1, max: 2, position: 0 });
  const big = await addResource(w, 'T2', { min: 2, max: 6, position: 1 });
  const left = await addResource(w, 'T3', { min: 1, max: 4, position: 2 });
  const right = await addResource(w, 'T4', { min: 1, max: 4, position: 3, joins: [left] });
  const setup = await getTableSetup(w.owner, { placeId: w.placeId });
  await saveTableSetup(w.owner, { placeId: w.placeId, rules: setup.rules });
  return { w, small, big, left, right };
}

describe('walk ins (AC-6671)', () => {
  it('offers the free tables best fit first, joins after singles, and seats a walk in now', async () => {
    const { w, small, big, left, right } = await floor();
    const two = await freeTables(w.owner, { placeId: w.placeId, party: 2 }, clock);
    expect(two.holdMinutes).toBe(90);
    expect(two.tables.map((table) => table.label)).toEqual(['T1', 'T3', 'T4', 'T2', 'T3 + T4']);
    const seven = await freeTables(w.owner, { placeId: w.placeId, party: 7 }, clock);
    expect(seven.tables).toEqual([{ resourceIds: [left, right], label: 'T3 + T4', seats: 8 }]);

    const key = randomUUID();
    const seated = await seatWalkIn(
      w.owner,
      { placeId: w.placeId, party: 2, resourceIds: [small], name: 'Grace', idempotencyKey: key },
      clock,
    );
    expect(seated.status).toBe('started');
    // A retry of the same press answers the same visit.
    expect(
      (await seatWalkIn(w.owner, { placeId: w.placeId, party: 2, resourceIds: [small], idempotencyKey: key }, clock))
        .id,
    ).toBe(seated.id);
    const day = await listServiceDay(w.owner, { placeId: w.placeId, date: '2030-01-15' });
    expect(day.visits).toEqual([
      expect.objectContaining({
        id: seated.id,
        name: 'Grace',
        status: 'started',
        source: 'walk_in',
        seatedAt: NOW.toISOString(),
        resourceIds: [small],
      }),
    ]);
    expect(day.covers.seated).toBe(2);
    expect(
      (await freeTables(w.owner, { placeId: w.placeId, party: 2 }, clock)).tables.map((table) => table.label),
    ).toEqual(['T3', 'T4', 'T2', 'T3 + T4']);
    expect(
      await refusal(
        seatWalkIn(
          w.owner,
          { placeId: w.placeId, party: 2, resourceIds: [small], idempotencyKey: randomUUID() },
          clock,
        ),
      ),
    ).toBe('SLOT_TAKEN');
    // Tables that never seat the party together.
    expect(
      await refusal(
        seatWalkIn(
          w.owner,
          { placeId: w.placeId, party: 5, resourceIds: [small, big], idempotencyKey: randomUUID() },
          clock,
        ),
      ),
    ).toBe('INPUT:resourceIds');
  });

  it('leaves out a table a reservation holds within the party’s hold', async () => {
    const { w, big } = await floor();
    const service = await inWorkspace(w.owner, (tx) => readTableService(tx, w.placeId));
    if (service === undefined) throw new Error('No table service.');
    // A party of 5 booked at 20:00 goes to T2, the smallest single table that seats it.
    await bookVisit(
      w.owner,
      { busy: NO_CALENDAR.busy, now: () => new Date('2030-01-15T10:00:00.000Z') },
      {
        placeId: w.placeId,
        items: [{ serviceId: service.serviceId, variantId: service.variantId }],
        party: 5,
        start: '2030-01-15T20:00:00.000Z',
        client: { name: 'Booked' },
        source: 'desk',
        idempotencyKey: randomUUID(),
      },
    );
    const held = (
      await w.sql<{ resource_id: string }>(sql`select resource_id::text from appointment_holds where live`)
    ).rows.map((row) => row.resource_id);
    expect(held).toEqual([big]);
    // At 19:00 a party of 5 would hold until 21:00, past the 20:00 reservation at T2: only the joined pair is free.
    const free = await freeTables(w.owner, { placeId: w.placeId, party: 5 }, clock);
    expect(free.tables.map((table) => table.label)).toEqual(['T3 + T4']);
  });

  it('answers Run service only: a waiter seats, a plain member gets FORBIDDEN', async () => {
    const { w, small } = await floor();
    const waiter = await waiterScope(db, w);
    expect((await freeTables(waiter, { placeId: w.placeId, party: 2 }, clock)).tables.length).toBeGreaterThan(0);
    const plain = rescope(w.owner, { role: 'member' });
    expect(await refusal(freeTables(plain, { placeId: w.placeId, party: 2 }, clock))).toBe('FORBIDDEN');
    expect(
      await refusal(
        seatWalkIn(plain, { placeId: w.placeId, party: 2, resourceIds: [small], idempotencyKey: randomUUID() }, clock),
      ),
    ).toBe('FORBIDDEN');
    expect(
      (
        await seatWalkIn(
          waiter,
          { placeId: w.placeId, party: 2, resourceIds: [small], idempotencyKey: randomUUID() },
          clock,
        )
      ).status,
    ).toBe('started');
  });

  it('takes a reservation for a guest at the table the host picked, or the best fit, and refuses a taken one', async () => {
    const { w, small, big } = await floor();
    const at = '2030-01-16T19:30:00.000Z';
    const picked = await reserveForGuest(
      w.owner,
      {
        placeId: w.placeId,
        start: at,
        party: 2,
        name: 'Ada',
        phone: '07700 900123',
        resourceIds: [big],
        idempotencyKey: randomUUID(),
      },
      clock,
    );
    expect(picked.status).toBe('booked');
    const fit = await reserveForGuest(
      w.owner,
      { placeId: w.placeId, start: at, party: 2, name: 'Lin', note: 'Window', idempotencyKey: randomUUID() },
      clock,
    );
    const day = await listServiceDay(w.owner, { placeId: w.placeId, date: '2030-01-16' });
    expect(day.visits).toEqual([
      expect.objectContaining({
        id: picked.id,
        name: 'Ada',
        phone: '07700 900123',
        source: 'desk',
        resourceIds: [big],
      }),
      expect.objectContaining({ id: fit.id, name: 'Lin', note: 'Window', status: 'booked', resourceIds: [small] }),
    ]);
    expect(
      await refusal(
        reserveForGuest(
          w.owner,
          { placeId: w.placeId, start: at, party: 2, name: 'Max', resourceIds: [big], idempotencyKey: randomUUID() },
          clock,
        ),
      ),
    ).toBe('SLOT_TAKEN');
    const plain = rescope(w.owner, { role: 'member' });
    expect(
      await refusal(
        reserveForGuest(
          plain,
          { placeId: w.placeId, start: at, party: 2, name: 'Max', idempotencyKey: randomUUID() },
          clock,
        ),
      ),
    ).toBe('FORBIDDEN');
  });
});
