// Table seating's setup and Service list on the visit engine (spec 0066 B7 lite) against the real Postgres: a first
// setup from an empty place takes the defaults and says what is missing in one line each, saving makes the Table
// service, the rules' ranges refuse on their field, a guest's party outside the range is told to call, the Service
// list counts covers, and status moves seat, finish (freeing the table at once), refuse a jump, and undo.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { NO_CALENDAR } from '../booking/calendar.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { rescope } from '../testing.ts';
import { rollingWeek } from '../../test/dates-kit.ts';
import { addResource, addService, addStaff, visitWorkspace, waiterScope } from '../../test/visits-kit.ts';
import { bookVisit, visitTimes } from './book.ts';
import {
  getTableSetup,
  guestPartyRange,
  listServiceDay,
  saveTableSetup,
  setupSteps,
  setVisitStatus,
  TABLE_DEFAULTS,
  type TableRules,
} from './table-service.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-visits-table-service-tests' });
});
afterAll(async () => {
  await db.close();
});

const week = rollingWeek();
const DAY = week.monday;
const at = (time: string) => `${DAY}T${time}:00.000Z`;

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

describe('setup (B7 lite)', () => {
  it('starts from the defaults on an empty place, says what is missing in one line each, and saves the Table service', async () => {
    const w = await visitWorkspace(db);
    await w.sql(sql`update places set hours = '{"weekly":{},"exceptions":[]}'::jsonb`);
    const first = await getTableSetup(w.owner, { placeId: w.placeId });
    expect(first.saved).toBe(false);
    expect(first.rules).toMatchObject({ partyMin: 1, partyMax: 8, minutes: 90, stepMinutes: 15, noticeMinutes: 120 });
    expect(first.steps).toEqual([
      { step: 'hours', done: false, fix: 'Set your opening hours, so guests see times.' },
      { step: 'tables', done: false, fix: 'Add a table guests can book online.' },
      { step: 'rules', done: true },
    ]);
    expect(first.ready).toBe(false);
    await w.sql(
      sql`update places set hours = ${JSON.stringify({ weekly: { mon: [{ from: '18:00', to: '23:00' }] }, exceptions: [] })}::jsonb`,
    );
    const t2 = await addResource(w, 'T2', { min: 2, max: 4 });
    await addResource(w, 'T6', { min: 4, max: 6, joins: [t2] });
    const saved = await saveTableSetup(w.owner, { placeId: w.placeId, rules: first.rules });
    expect(saved.saved).toBe(true);
    expect(saved.ready).toBe(true);
    // Saved off line: guests see nothing until Publish.
    expect(saved.rules.online).toBe(false);
    expect(saved.publicKey).toMatch(/^[A-Za-z0-9_-]{16}$/);
    // Saving again updates the one service, never a second.
    await saveTableSetup(w.owner, { placeId: w.placeId, rules: { ...first.rules, partyMax: 12 } });
    const again = await getTableSetup(w.owner, { placeId: w.placeId });
    expect(again.serviceId).toBe(saved.serviceId);
    // Publish refuses a broken page, with the one line fix.
    await expect(
      saveTableSetup(w.owner, { placeId: w.placeId, rules: { ...first.rules, partyMax: 12, online: true } }),
    ).rejects.toMatchObject({
      refusal: {
        code: 'CONFLICT',
        message: 'No table seats 12. Add a larger table, join tables, or lower the largest party.',
      },
    });
    expect(again.steps[1]).toEqual({
      step: 'tables',
      done: false,
      fix: 'No table seats 12. Add a larger table, join tables, or lower the largest party.',
    });
  });

  it('refuses rules outside checklabs’ ranges on their field, and a member without Manage hospitality', async () => {
    const w = await visitWorkspace(db);
    const base = (await getTableSetup(w.owner, { placeId: w.placeId })).rules;
    const bad = (rules: Partial<TableRules>) =>
      refusal(saveTableSetup(w.owner, { placeId: w.placeId, rules: { ...base, ...rules } }));
    expect(await bad({ stepMinutes: 3 })).toBe('INPUT:stepMinutes');
    expect(await bad({ windowDays: 800 })).toBe('INPUT:windowDays');
    expect(await bad({ partyMin: 5, partyMax: 4 })).toBe('INPUT:partyMax');
    expect(await bad({ holds: [{ size: 3, minutes: 5 }] })).toBe('INPUT:holds');
    expect(await refusal(getTableSetup(rescope(w.owner, { role: 'member' }), { placeId: w.placeId }))).toBe(
      'FORBIDDEN',
    );
  });

  it('checks the hours are long enough for the longest hold', () => {
    const steps = setupSteps(
      { weekly: { fri: [{ from: '18:00', to: '19:00' }] }, exceptions: [] },
      [{ id: 't', kind: 'table', minCapacity: 1, maxCapacity: 8, joins: [], order: 0, busy: [] }],
      { ...TABLE_DEFAULTS, holds: TABLE_DEFAULTS.holds, online: true },
    );
    expect(steps[0]).toEqual({
      step: 'hours',
      done: false,
      fix: 'Open at least as long as a table is held, or shorten the hold.',
    });
  });

  it('offers guests only the party sizes a table seats', () => {
    const table = (id: string, min: number, max: number, extra: { joins?: string[]; online?: boolean } = {}) => ({
      id,
      kind: 'table' as const,
      minCapacity: min,
      maxCapacity: max,
      joins: extra.joins ?? [],
      order: 0,
      busy: [],
      ...(extra.online === undefined ? {} : { online: extra.online }),
    });
    // The smallest table seats two: no party of one.
    expect(guestPartyRange([table('a', 2, 4)], { partyMin: 1, partyMax: 8 })).toEqual({ min: 2, max: 4 });
    // Two joined tables seat six; a table kept off line doesn't count.
    expect(
      guestPartyRange([table('a', 2, 4, { joins: ['b'] }), table('b', 2, 2), table('c', 1, 1, { online: false })], {
        partyMin: 1,
        partyMax: 8,
      }),
    ).toEqual({ min: 2, max: 6 });
    expect(guestPartyRange([table('a', 6, 8)], { partyMin: 1, partyMax: 4 })).toBeUndefined();
  });
});

describe('the Service list and status moves (AC-6560, AC-6561)', () => {
  async function evening() {
    const w = await visitWorkspace(db);
    const t1 = await addResource(w, 'T1', { min: 1, max: 4 });
    const setup = await getTableSetup(w.owner, { placeId: w.placeId });
    const saved = await saveTableSetup(w.owner, {
      placeId: w.placeId,
      rules: { ...setup.rules, noticeMinutes: 0, partyMax: 4, online: true },
    });
    const variantId = (
      await w.sql<{ id: string }>(
        sql`select id::text from service_variants where service_id = ${saved.serviceId ?? ''}::uuid`,
      )
    ).rows[0]?.id;
    const table = { serviceId: saved.serviceId ?? '', variantId: variantId ?? '' };
    const deps = { busy: NO_CALENDAR.busy, now: () => new Date(`${week.sunday}T09:00:00Z`) };
    const book = (start: string, party = 2, source: 'online' | 'desk' = 'online') =>
      bookVisit(w.owner, deps, {
        placeId: w.placeId,
        items: [table],
        party,
        start,
        client: { name: 'Grace Hopper', email: `g-${randomUUID().slice(0, 8)}@example.com`, occasion: 'birthday' },
        source,
        idempotencyKey: randomUUID(),
      });
    return { w, t1, table, deps, book };
  }

  it('tells a guest whose party is above the online range to call, while the desk may seat it', async () => {
    const { book } = await evening();
    expect(await refusal(book(at('18:00'), 9))).toBe('INPUT:party');
    expect(await refusal(book(at('18:00'), 9, 'desk'))).toBe('SLOT_TAKEN');
  });

  it('lists the day by time with covers, seats, finishes (freeing the table at once), refuses a jump and undoes', async () => {
    const { w, t1, table, deps, book } = await evening();
    const first = await book(at('18:00'), 2);
    await book(at('21:00'), 3);
    const day = await listServiceDay(w.owner, { placeId: w.placeId, date: DAY });
    expect(day.visits.map((visit) => [visit.start, visit.party, visit.status, visit.occasion])).toEqual([
      [at('18:00'), 2, 'booked', 'birthday'],
      [at('21:00'), 3, 'booked', 'birthday'],
    ]);
    expect(day.visits[0]?.resourceIds).toEqual([t1]);
    expect(day.covers).toEqual({ booked: 5, seated: 0, toCome: 5 });
    expect(day.truncated).toBe(false);
    const now = () => new Date(at('18:40'));
    expect(
      await refusal(setVisitStatus(w.owner, { appointmentId: first.appointmentId, status: 'completed' }, { now })),
    ).toBe('CONFLICT');
    await setVisitStatus(w.owner, { appointmentId: first.appointmentId, status: 'started' }, { now });
    const seated = await listServiceDay(w.owner, { placeId: w.placeId, date: DAY });
    expect(seated.visits[0]?.seatedAt).toBe(at('18:40'));
    expect(seated.covers.seated).toBe(2);
    // Before finishing, 18:45 is held; after, the table is free at once.
    const before = await visitTimes(w.owner, deps, { placeId: w.placeId, items: [table], party: 2, date: DAY });
    expect(before.map((each) => each.start)).not.toContain(at('18:45'));
    await setVisitStatus(w.owner, { appointmentId: first.appointmentId, status: 'completed' }, { now });
    const after = await visitTimes(w.owner, deps, { placeId: w.placeId, items: [table], party: 2, date: DAY });
    expect(after.map((each) => each.start)).toContain(at('18:45'));
  });

  it('frees the table on a no show, and an undo that finds it given away is SLOT_TAKEN', async () => {
    const { w, book } = await evening();
    const first = await book(at('18:00'));
    await setVisitStatus(w.owner, { appointmentId: first.appointmentId, status: 'no_show' });
    await book(at('18:00'));
    expect(await refusal(setVisitStatus(w.owner, { appointmentId: first.appointmentId, status: 'booked' }))).toBe(
      'SLOT_TAKEN',
    );
    expect(await refusal(listServiceDay(rescope(w.owner, { role: 'member' }), { placeId: w.placeId, date: DAY }))).toBe(
      'FORBIDDEN',
    );
  });

  it('lets a waiter (Run service only) see and move table reservations, never a salon visit at the same place', async () => {
    const { w, book } = await evening();
    const table = await book(at('18:00'));
    // A salon visit at the same place: a stylist, a service with staff and no table.
    await w.sql(
      sql`update places set hours = ${JSON.stringify({ weekly: { mon: [{ from: '09:00', to: '23:00' }] }, exceptions: [] })}::jsonb`,
    );
    const asha = await addStaff(w, 'Asha');
    const cut = await addService(w, { name: 'Cut', minutes: 60, capacityMode: 'one', staffRule: 'all', needs: [] });
    const salon = await bookVisit(
      w.owner,
      { busy: NO_CALENDAR.busy, now: () => new Date(`${week.sunday}T09:00:00Z`) },
      {
        placeId: w.placeId,
        items: [{ ...cut, staffId: asha }],
        party: 1,
        start: at('10:00'),
        client: { name: 'Private Client', email: `p-${randomUUID().slice(0, 8)}@example.com` },
        source: 'desk',
        idempotencyKey: randomUUID(),
      },
    );
    const waiter = await waiterScope(db, w);
    const day = await listServiceDay(waiter, { placeId: w.placeId, date: DAY });
    expect(day.visits.map((visit) => visit.id)).toEqual([table.appointmentId]);
    expect(await refusal(setVisitStatus(waiter, { appointmentId: salon.appointmentId, status: 'cancelled' }))).toBe(
      'NOT_FOUND',
    );
    const [still] = (
      await w.sql<{ status: string }>(sql`select status from appointments where id = ${salon.appointmentId}::uuid`)
    ).rows;
    expect(still?.status).toBe('booked');
    await setVisitStatus(waiter, { appointmentId: table.appointmentId, status: 'started' });
    // The owner (who holds the calendar) may move the salon visit.
    await setVisitStatus(w.owner, { appointmentId: salon.appointmentId, status: 'arrived' });
  });

  it('audits a visit made and every status move, the undo too', async () => {
    const { w, book } = await evening();
    const first = await book(at('18:00'));
    await setVisitStatus(w.owner, { appointmentId: first.appointmentId, status: 'cancelled' });
    await setVisitStatus(w.owner, { appointmentId: first.appointmentId, status: 'booked' });
    const rows = (
      await w.sql<{ what: string; to: string | null }>(sql`
        select after->>'hospitality' as what, after->>'to' as to from audit_events
        where after->>'appointmentId' = ${first.appointmentId} order by at, id
      `)
    ).rows;
    expect(rows).toEqual([
      { what: 'visit.created', to: null },
      { what: 'visit.status', to: 'cancelled' },
      { what: 'visit.status', to: 'booked' },
    ]);
  });

  it('refuses a guest party outside the engine range on visitTimes, and a member without the calendar', async () => {
    const { w, table, deps } = await evening();
    expect(await refusal(visitTimes(w.owner, deps, { placeId: w.placeId, items: [table], party: 0, date: DAY }))).toBe(
      'INPUT:party',
    );
    expect(
      await refusal(
        visitTimes(rescope(w.owner, { role: 'member' }), deps, {
          placeId: w.placeId,
          items: [table],
          party: 2,
          date: DAY,
        }),
      ),
    ).toBe('FORBIDDEN');
  });
});
