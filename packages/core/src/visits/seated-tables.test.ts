// Two things the Reservations page rests on, against the real Postgres. A seated party holds its table until Finish:
// past its planned hold (spec 0065 "Late, overstay, early"), no walk in is offered that table or seated there, and no
// reservation is seated there. And those who only run the floor read the page's places and tables through reads of
// their own, with only the fields the day view draws, while Settings' reads stay `hospitality.manage`'s.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { inWorkspace } from '../access/run.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { listResources } from '../hospitality/floor.ts';
import { getBusiness } from '../hospitality/places.ts';
import { rescope } from '../testing.ts';
import { addResource, visitWorkspace, waiterScope } from '../../test/visits-kit.ts';
import {
  getTableSetup,
  listServiceDay,
  listServicePlaces,
  readServiceFloor,
  saveTableSetup,
  seatedTables,
  setVisitStatus,
} from './table-service.ts';
import { freeTables, reserveForGuest, seatWalkIn } from './walk-in.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-visits-seated-tables-tests' });
});
afterAll(async () => {
  await db.close();
});

/** A Tuesday evening, 19:00 in London (GMT in winter). */
const NOW = new Date('2030-01-15T19:00:00.000Z');
const clock = { now: () => NOW };
const hoursOn = (hours: number) => ({ now: () => new Date(NOW.getTime() + hours * 3_600_000) });

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
  const setup = await getTableSetup(w.owner, { placeId: w.placeId });
  await saveTableSetup(w.owner, { placeId: w.placeId, rules: setup.rules });
  return { w, small, big, left };
}

/** Sam at T1 from 19:00: a party of 2 holds 90 minutes, so to 20:30. */
async function samSeated() {
  const made = await floor();
  const { id } = await seatWalkIn(
    made.w.owner,
    { placeId: made.w.placeId, party: 2, resourceIds: [made.small], name: 'Sam', idempotencyKey: randomUUID() },
    clock,
  );
  return { ...made, sam: id };
}

describe('a seated party holds its table until Finish', () => {
  it('offers no walk in at the table and refuses seating one there, until Finish frees it', async () => {
    const { w, small, sam } = await samSeated();
    const offered = async () =>
      (await freeTables(w.owner, { placeId: w.placeId, party: 2 }, hoursOn(2))).tables.map((table) => table.label);
    const seat = () =>
      seatWalkIn(
        w.owner,
        { placeId: w.placeId, party: 2, resourceIds: [small], idempotencyKey: randomUUID() },
        hoursOn(2),
      );
    // 21:00, half an hour past Sam's hold.
    expect(await offered()).not.toContain('T1');
    expect(await refusal(seat())).toBe('SLOT_TAKEN');

    await setVisitStatus(w.owner, { appointmentId: sam, status: 'completed' }, hoursOn(2));
    expect(await offered()).toContain('T1');
    expect((await seat()).status).toBe('started');
  });

  it('refuses seating a reservation at the table, early or on time, until Finish frees it', async () => {
    const { w, small, sam } = await samSeated();
    const next = await reserveForGuest(
      w.owner,
      {
        placeId: w.placeId,
        start: '2030-01-15T21:00:00.000Z',
        party: 2,
        name: 'Lin',
        resourceIds: [small],
        idempotencyKey: randomUUID(),
      },
      clock,
    );
    const seatLin = (hours: number) =>
      setVisitStatus(w.owner, { appointmentId: next.id, status: 'started' }, hoursOn(hours));
    // 20:00: inside Sam's hold, an hour before Lin's. The two holds never meet, and the table is still taken.
    expect(await refusal(seatLin(1))).toBe('SLOT_TAKEN');
    // 21:06: Lin on time, Sam past his hold.
    expect(await refusal(seatLin(2.1))).toBe('SLOT_TAKEN');
    await setVisitStatus(w.owner, { appointmentId: sam, status: 'completed' }, hoursOn(2.1));
    expect((await seatLin(2.1)).status).toBe('started');
  });

  it('seats one of two reservations pressed at once for one table: only the place lock can tell them apart', async () => {
    const { w, small } = await floor();
    const reserve = (start: string, name: string) =>
      reserveForGuest(
        w.owner,
        { placeId: w.placeId, start, party: 2, name, resourceIds: [small], idempotencyKey: randomUUID() },
        clock,
      );
    // Back to back, so their holds never overlap and the exclusion constraint has nothing to refuse.
    const lin = await reserve('2030-01-15T20:00:00.000Z', 'Lin');
    const max = await reserve('2030-01-15T21:30:00.000Z', 'Max');
    const seat = (id: string) => refusal(setVisitStatus(w.owner, { appointmentId: id, status: 'started' }, hoursOn(1)));
    const answers = await Promise.all([seat(lin.id), seat(max.id)]);
    expect([...answers].sort()).toEqual(['SLOT_TAKEN', undefined]);
  });

  it('counts only the parties the host can see and Finish: a staffed visit keeps to its plan', async () => {
    const { w, sam } = await samSeated();
    const at = hoursOn(2).now();
    const seated = () =>
      inWorkspace(w.owner, async (tx) => [...(await seatedTables(tx, w.workspaceId, w.placeId, at))]);
    expect(await seated()).toHaveLength(1);
    // The same visit under a service that needs staff, which Run service's day list leaves out.
    await w.sql(sql`
      update services set staff_rule = 'all' where id = (
        select service_id from appointment_items where appointment_id = ${sam}::uuid limit 1
      )
    `);
    const day = await listServiceDay(w.owner, { placeId: w.placeId, date: '2030-01-15' }, hoursOn(2));
    expect(day.visits.map((visit) => visit.id)).not.toContain(sam);
    expect(await seated()).toEqual([]);
  });

  it('refuses the Undo of a Finish once someone else sits there', async () => {
    const { w, small, sam } = await samSeated();
    await setVisitStatus(w.owner, { appointmentId: sam, status: 'completed' }, hoursOn(2));
    await seatWalkIn(
      w.owner,
      { placeId: w.placeId, party: 2, resourceIds: [small], idempotencyKey: randomUUID() },
      hoursOn(2),
    );
    expect(await refusal(setVisitStatus(w.owner, { appointmentId: sam, status: 'started' }, hoursOn(2)))).toBe(
      'SLOT_TAKEN',
    );
  });

  it('lets a table go six hours past the hold, when a forgotten Finish is no longer a party', async () => {
    const { w } = await samSeated();
    const offered = async (hours: number) =>
      (await freeTables(w.owner, { placeId: w.placeId, party: 2 }, hoursOn(hours))).tables.map((table) => table.label);
    // The hold ends at 20:30, so it lets go at 02:30.
    expect(await offered(7)).not.toContain('T1');
    expect(await offered(8)).toContain('T1');
  });

  it('shows today a party still seated from before midnight, so the host can Finish it; no other day', async () => {
    const { w, small } = await floor();
    const { id } = await seatWalkIn(
      w.owner,
      { placeId: w.placeId, party: 2, resourceIds: [small], name: 'Sam', idempotencyKey: randomUUID() },
      { now: () => new Date('2030-01-15T23:30:00.000Z') },
    );
    const afterMidnight = { now: () => new Date('2030-01-16T01:30:00.000Z') };
    const today = await listServiceDay(w.owner, { placeId: w.placeId, date: '2030-01-16' }, afterMidnight);
    expect(today.visits.map((visit) => visit.id)).toEqual([id]);
    expect(today.covers.seated).toBe(2);
    const tomorrow = await listServiceDay(w.owner, { placeId: w.placeId, date: '2030-01-17' }, afterMidnight);
    expect(tomorrow.visits).toEqual([]);
    // Past the six hours it is nobody's table any more, and today's list lets it go too.
    const noon = { now: () => new Date('2030-01-16T12:00:00.000Z') };
    expect((await listServiceDay(w.owner, { placeId: w.placeId, date: '2030-01-16' }, noon)).visits).toEqual([]);
  });
});

describe('what the Reservations page reads for those who run the floor', () => {
  it('refuses Run service the setup reads and answers the day view’s own, with its fields alone', async () => {
    const { w, small, big, left } = await floor();
    const area = await w.sql<{ id: string }>(sql`
      insert into areas (workspace_id, place_id, name, position)
      values (${w.workspaceId}::uuid, ${w.placeId}::uuid, 'Patio', 0) returning id::text as id
    `);
    const areaId = area.rows[0]?.id;
    if (areaId === undefined) throw new Error('No area.');
    await w.sql(sql`update resources set area_id = ${areaId}::uuid where id = ${big}::uuid`);
    await w.sql(sql`update resources set archived_at = now() where id = ${left}::uuid`);
    const waiter = await waiterScope(db, w);

    // The finding: these are what the page read, and Run service alone can't. They stay Settings' own.
    expect(await refusal(getBusiness(waiter))).toBe('FORBIDDEN');
    expect(await refusal(listResources(waiter, { placeId: w.placeId }))).toBe('FORBIDDEN');
    expect(await refusal(getTableSetup(waiter, { placeId: w.placeId }))).toBe('FORBIDDEN');

    const { places } = await listServicePlaces(waiter);
    expect(places).toHaveLength(1);
    // Nothing of the address, the phone or the rest.
    expect(Object.keys(places[0] ?? {}).sort()).toEqual(['hours', 'id', 'name', 'timeZone']);

    const plan = await readServiceFloor(waiter, { placeId: w.placeId });
    expect(plan.placeId).toBe(w.placeId);
    expect(plan.areas).toEqual([{ id: areaId, name: 'Patio', position: 0 }]);
    // Live tables only, and no settings on them.
    expect(plan.resources.map((table) => table.id)).toEqual([small, big]);
    expect(plan.resources[1]).toEqual({ id: big, label: 'T2', areaId, minCapacity: 2, maxCapacity: 6 });
  });

  it('answers `hospitality.manage` alone the places and tables for Online booking, never the day’s guests', async () => {
    const { w } = await floor();
    const manager = await waiterScope(db, w, ['hospitality.manage']);
    expect((await listServicePlaces(manager)).places).toHaveLength(1);
    expect((await readServiceFloor(manager, { placeId: w.placeId })).resources).toHaveLength(3);
    expect(await refusal(listServiceDay(manager, { placeId: w.placeId, date: '2030-01-15' }))).toBe('FORBIDDEN');
  });

  it('refuses a member without Run service, another workspace’s place, and a workspace without the app', async () => {
    const { w } = await floor();
    const plain = rescope(w.owner, { role: 'member' });
    expect(await refusal(listServicePlaces(plain))).toBe('FORBIDDEN');
    expect(await refusal(readServiceFloor(plain, { placeId: w.placeId }))).toBe('FORBIDDEN');

    const other = await floor();
    expect(await refusal(readServiceFloor(other.w.owner, { placeId: w.placeId }))).toBe('NOT_FOUND');

    const salon = await visitWorkspace(db, 'appointments');
    expect(await refusal(listServicePlaces(salon.owner))).toBe('APP_NOT_INSTALLED');
    expect(await refusal(readServiceFloor(salon.owner, { placeId: salon.placeId }))).toBe('APP_NOT_INSTALLED');
  });
});
