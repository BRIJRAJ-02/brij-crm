// Settings › Services, Staff and Shifts (spec 0066 B1) against the real Postgres as the app role: a salon set up
// from empty through the services alone (a category, a service with two options, a staff member who starts on the
// place's opening week, their shifts copied to all weeks in one write), and the planner then offering a haircut with
// that stylist; the catalogue's limits and orders; who may do what (the desk sets shifts but never the catalogue; a
// waiter neither); linked staff keep their member's own time off; archive refuses while visits are to come.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PlaceHours, ServiceFields } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { mintScope, type EngineScope } from '../access/mint.ts';
import { NO_RULES, roleAccess } from '../access/policy.ts';
import { NO_CALENDAR } from '../booking/calendar.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { rollingWeek } from '../../test/dates-kit.ts';
import {
  addMember,
  allWeek as weekOf,
  visitWorkspace,
  waiterScope,
  type VisitWorkspace,
} from '../../test/visits-kit.ts';
import { bookVisit, createSlotCache } from './book.ts';
import {
  archiveServices,
  deleteServiceCategory,
  getCatalogue,
  moveService,
  restoreServices,
  saveService,
  saveServiceCategory,
  setServicesCategory,
  setServicesOnline,
} from './catalogue.ts';
import {
  addStaffBlock,
  addStaffTimeOff,
  archiveStaff,
  copyShifts,
  getShifts,
  getTeam,
  linkStaff,
  removeStaffTimeOff,
  restoreStaff,
  saveStaff,
  setShifts,
} from './team.ts';
import { serviceTimes } from './times.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-visits-catalogue-tests' });
});
afterAll(async () => {
  await db.close();
});

const week = rollingWeek();
const deps = { busy: NO_CALENDAR.busy, now: () => new Date(`${week.sunday}T08:00:00Z`) };

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    if (error instanceof Error && 'inputProblem' in error) return (error as { inputProblem: unknown }).inputProblem;
    throw error;
  }
  throw new Error('It was let through.');
}

/** Every day `from` to `to`, as the services take it. */
const allWeek = (from: string, to: string) => weekOf(from, to) as PlaceHours;

/** A salon in London open 09:00 to 18:00 every day, with Appointments installed. */
async function salon(): Promise<VisitWorkspace> {
  const w = await visitWorkspace(db, 'appointments');
  await w.sql(sql`update places set hours = ${JSON.stringify(allWeek('09:00', '18:00'))}::jsonb`);
  return w;
}

/** A haircut, 30 or 45 minutes, offered at the salon by every stylist. */
const haircut = (w: VisitWorkspace, extra: Partial<ServiceFields> = {}): ServiceFields => ({
  name: 'Haircut',
  categoryId: null,
  bufferAfterMin: 10,
  online: true,
  staffRule: 'all',
  staffIds: [],
  placeIds: [w.placeId],
  needs: [],
  variants: [
    { name: 'Short hair', minutes: 30, priceMinor: 2500, priceType: 'fixed', bufferBeforeMin: 0 },
    { name: 'Long hair', minutes: 45, priceMinor: 3500, priceType: 'from', bufferBeforeMin: 0 },
  ],
  ...extra,
});

/** A member holding one permission only (a custom role), answering their scope. */
async function holderOf(w: VisitWorkspace, permission: 'services.calendar' | 'services.manage'): Promise<EngineScope> {
  const memberId = await addMember(w, permission === 'services.calendar' ? 'Desk' : 'Manager');
  return mintScope({
    db,
    workspaceId: w.workspaceId,
    actor: { type: 'member', id: memberId },
    access: roleAccess({ kind: 'member', memberId, role: 'member', customRoleId: newId(), teamIds: [] }, NO_RULES, {
      permissions: [permission],
      defaultObjectLevel: 'read',
    }),
  });
}

describe('a salon set up from empty', () => {
  it('lists nothing, with the checklist open from services on', async () => {
    const w = await salon();
    const view = await getCatalogue(w.owner);
    expect(view.services).toEqual([]);
    expect(view.businessKind).toBe('salon');
    expect(view.currency).toBe('GBP');
    expect(view.setup.steps.map((step) => [step.id, step.done])).toEqual([
      ['business', true],
      ['hours', true],
      ['service', false],
      ['staff', false],
      ['shifts', false],
      ['publish', false],
    ]);
  });

  it('plans a haircut with a stylist made through these services alone (B2 books from this)', async () => {
    const w = await salon();
    const hair = newId();
    await saveServiceCategory(w.owner, { id: hair, name: 'Hair' });
    const serviceId = newId();
    const catalogue = await saveService(w.owner, { id: serviceId, service: haircut(w, { categoryId: hair }) });
    const service = catalogue.services.find((each) => each.id === serviceId);
    expect(service?.categoryId).toBe(hair);
    expect(service?.variants.map((each) => [each.name, each.minutes, each.priceMinor, each.priceType])).toEqual([
      ['Short hair', 30, 2500, 'fixed'],
      ['Long hair', 45, 3500, 'from'],
    ]);
    const asha = newId();
    const team = await saveStaff(w.owner, {
      id: asha,
      staff: {
        name: 'Asha',
        title: 'Senior stylist',
        color: 'purple',
        placeIds: [w.placeId],
        serviceIds: [serviceId],
      },
    });
    const profile = team.staff.find((each) => each.id === asha);
    // A new staff member works the place's opening week until someone changes it (Foolproof).
    expect(profile?.places[0]?.shifts.weekly.mon).toEqual([{ from: '09:00', to: '18:00' }]);
    expect(profile?.serviceIds).toEqual([serviceId]);
    expect(profile?.color).toBe('purple');
    // Her real week: Tuesday to Saturday, 10 to 4, the whole week in one write.
    const tueToSat: PlaceHours = {
      weekly: Object.fromEntries(
        (['tue', 'wed', 'thu', 'fri', 'sat'] as const).map((day) => [day, [{ from: '10:00', to: '16:00' }]]),
      ),
      exceptions: [],
    };
    const shifted = await setShifts(w.owner, {
      staffId: asha,
      placeId: w.placeId,
      shifts: tueToSat,
      outsideHours: false,
    });
    const saved = shifted.staff.find((each) => each.id === asha)?.places[0]?.shifts;
    expect(Object.keys(saved?.weekly ?? {}).sort()).toEqual(['fri', 'sat', 'thu', 'tue', 'wed']);
    const setup = (await getCatalogue(w.owner)).setup.steps;
    expect(setup.filter((step) => !step.done).map((step) => step.id)).toEqual(['publish']);

    const variantId = service?.variants[0]?.id ?? '';
    const tuesday = week.tuesday;
    const times = await serviceTimes(w.owner, deps, { placeId: w.placeId, serviceId, variantId, date: tuesday });
    expect(times.times.length).toBeGreaterThan(0);
    expect(times.times[0]?.staffId).toBe(asha);
    // London in a year's November is GMT: her day starts at 10:00, and the last 30 minute cut (10 after, every 15) ends at 15:45.
    expect(times.times[0]?.start).toBe(`${tuesday}T10:00:00.000Z`);
    expect(times.times.at(-1)?.end).toBe(`${tuesday}T15:45:00.000Z`);
    // Monday is her day off.
    expect(
      (await serviceTimes(w.owner, deps, { placeId: w.placeId, serviceId, variantId, date: week.monday })).times,
    ).toEqual([]);
    // And the engine books her for it.
    const booked = await bookVisit(
      w.owner,
      { ...deps, slotCache: createSlotCache() },
      {
        placeId: w.placeId,
        items: [{ serviceId, variantId }],
        party: 1,
        start: `${tuesday}T10:00:00.000Z`,
        client: { name: 'Grace Hopper', email: `grace-${randomUUID().slice(0, 8)}@example.com` },
        source: 'desk',
        idempotencyKey: randomUUID(),
      },
    );
    expect(booked.items[0]?.staffId).toBe(asha);
    // With a visit to come, archiving her is refused with the count.
    expect(await refusal(archiveStaff(w.owner, { staffId: asha }))).toEqual({
      code: 'CONFLICT',
      message: 'Asha has 1 visit to come. Move it to someone else first.',
    });
  });
});

describe('the catalogue', () => {
  it('orders services in their category, moves them, and deletes a category keeping its services', async () => {
    const w = await salon();
    const hair = newId();
    const nails = newId();
    await saveServiceCategory(w.owner, { id: hair, name: 'Hair' });
    await saveServiceCategory(w.owner, { id: nails, name: 'Nails' });
    const [a, b, c] = [newId(), newId(), newId()];
    await saveService(w.owner, { id: a, service: haircut(w, { name: 'Cut', categoryId: hair }) });
    await saveService(w.owner, { id: b, service: haircut(w, { name: 'Colour', categoryId: hair }) });
    await saveService(w.owner, { id: c, service: haircut(w, { name: 'Manicure', categoryId: nails }) });
    const moved = await moveService(w.owner, { serviceId: b, categoryId: hair, toIndex: 0 });
    expect(moved.services.filter((each) => each.categoryId === hair).map((each) => each.name)).toEqual([
      'Colour',
      'Cut',
    ]);
    const across = await moveService(w.owner, { serviceId: c, categoryId: hair, toIndex: 1 });
    expect(across.services.filter((each) => each.categoryId === hair).map((each) => each.name)).toEqual([
      'Colour',
      'Manicure',
      'Cut',
    ]);
    const gone = await deleteServiceCategory(w.owner, { categoryId: hair });
    expect(gone.categories.map((each) => each.name)).toEqual(['Nails']);
    expect(gone.services.filter((each) => each.categoryId === undefined).map((each) => each.name)).toEqual([
      'Colour',
      'Manicure',
      'Cut',
    ]);
    const filed = await setServicesCategory(w.owner, { serviceIds: [a, b], categoryId: nails });
    expect(filed.services.filter((each) => each.categoryId === nails).map((each) => each.name)).toEqual([
      'Colour',
      'Cut',
    ]);
  });

  it('archives a variant left out, keeps the others’ ids, and turns services online and off in bulk', async () => {
    const w = await salon();
    const id = newId();
    const first = await saveService(w.owner, { id, service: haircut(w) });
    const [short] = first.services[0]?.variants ?? [];
    if (short === undefined) throw new Error('No variant.');
    const again = await saveService(w.owner, {
      id,
      service: haircut(w, {
        name: 'Haircut and style',
        variants: [{ ...short, minutes: 40 }],
      }),
    });
    expect(again.services[0]?.variants).toEqual([{ ...short, minutes: 40 }]);
    const [archived] = (
      await w.sql<{ n: number }>(sql`select count(*)::int as n from service_variants where archived_at is not null`)
    ).rows;
    expect(archived?.n).toBe(1);
    // The slug stays the first name's, so a shared link still finds it.
    const [slug] = (await w.sql<{ slug: string }>(sql`select slug from services where id = ${id}::uuid`)).rows;
    expect(slug?.slug).toBe('haircut');
    expect((await setServicesOnline(w.owner, { serviceIds: [id], online: false })).services[0]?.online).toBe(false);
  });

  it('archives and restores, a restored slug taken meanwhile getting a new one', async () => {
    const w = await salon();
    const first = newId();
    await saveService(w.owner, { id: first, service: haircut(w) });
    expect((await archiveServices(w.owner, { serviceIds: [first] })).services[0]?.archived).toBe(true);
    const second = newId();
    await saveService(w.owner, { id: second, service: haircut(w) });
    const back = await restoreServices(w.owner, { serviceIds: [first] });
    expect(back.services.every((each) => !each.archived)).toBe(true);
    const slugs = (await w.sql<{ slug: string }>(sql`select slug from services order by slug`)).rows.map(
      (row) => row.slug,
    );
    expect(slugs).toEqual(['haircut', 'haircut-2']);
  });

  it('refuses a place, a staff member or a variant that isn’t this service’s', async () => {
    const w = await salon();
    expect(await refusal(saveService(w.owner, { id: newId(), service: haircut(w, { placeIds: [newId()] }) }))).toEqual({
      field: 'placeIds',
      message: 'One of those places doesn’t exist.',
    });
    expect(
      await refusal(
        saveService(w.owner, { id: newId(), service: haircut(w, { staffRule: 'chosen', staffIds: [newId()] }) }),
      ),
    ).toEqual({ field: 'staffIds', message: 'One of those staff members doesn’t exist.' });
    const id = newId();
    await saveService(w.owner, { id, service: haircut(w) });
    const stranger = haircut(w).variants.map((variant) => ({ ...variant, id: newId() }));
    expect(await refusal(saveService(w.owner, { id, service: haircut(w, { variants: stranger }) }))).toEqual({
      field: 'variants',
      message: 'That option doesn’t exist.',
    });
  });
});

describe('the team', () => {
  it('turns an all-staff service to the chosen staff when one person leaves it out', async () => {
    const w = await salon();
    const service = newId();
    await saveService(w.owner, { id: service, service: haircut(w) });
    const [asha, ben] = [newId(), newId()];
    const fields = { color: null, placeIds: [w.placeId] };
    await saveStaff(w.owner, { id: asha, staff: { ...fields, name: 'Asha', serviceIds: [service] } });
    const team = await saveStaff(w.owner, { id: ben, staff: { ...fields, name: 'Ben', serviceIds: [] } });
    expect(team.staff.find((each) => each.id === asha)?.serviceIds).toEqual([service]);
    expect(team.staff.find((each) => each.id === ben)?.serviceIds).toEqual([]);
    expect(team.services.find((each) => each.id === service)?.staffRule).toBe('chosen');
    // Ben takes it up again: chosen, both.
    const both = await saveStaff(w.owner, { id: ben, staff: { ...fields, name: 'Ben', serviceIds: [service] } });
    expect(both.staff.map((each) => each.serviceIds)).toEqual([[service], [service]]);
  });

  it('copies one stylist’s week to another, who keeps their own date changes', async () => {
    const w = await salon();
    const [asha, ben] = [newId(), newId()];
    const fields = { color: null, placeIds: [w.placeId], serviceIds: [] };
    await saveStaff(w.owner, { id: asha, staff: { ...fields, name: 'Asha' } });
    await saveStaff(w.owner, { id: ben, staff: { ...fields, name: 'Ben' } });
    const benDay = { date: week.day(4), closed: true };
    await setShifts(w.owner, {
      staffId: ben,
      placeId: w.placeId,
      shifts: { weekly: {}, exceptions: [benDay] },
      outsideHours: false,
    });
    await setShifts(w.owner, {
      staffId: asha,
      placeId: w.placeId,
      shifts: allWeek('07:00', '12:00'),
      outsideHours: true,
    });
    const team = await copyShifts(w.owner, { staffId: asha, placeId: w.placeId, toStaffIds: [ben] });
    const benAt = team.staff.find((each) => each.id === ben)?.places[0];
    expect(benAt?.shifts).toEqual({ weekly: allWeek('07:00', '12:00').weekly, exceptions: [benDay] });
    expect(benAt?.outsideHours).toBe(true);
  });

  it('refuses hours that break the rules, and a place they don’t work at', async () => {
    const w = await salon();
    const asha = newId();
    await saveStaff(w.owner, { id: asha, staff: { name: 'Asha', color: null, placeIds: [], serviceIds: [] } });
    const overlapping: PlaceHours = {
      weekly: {
        mon: [
          { from: '09:00', to: '12:00' },
          { from: '11:00', to: '13:00' },
        ],
      },
      exceptions: [],
    };
    expect(
      await refusal(
        setShifts(w.owner, { staffId: asha, placeId: w.placeId, shifts: overlapping, outsideHours: false }),
      ),
    ).toMatchObject({ field: 'shifts' });
    expect(
      await refusal(
        setShifts(w.owner, {
          staffId: asha,
          placeId: w.placeId,
          shifts: allWeek('09:00', '17:00'),
          outsideHours: false,
        }),
      ),
    ).toEqual({ code: 'NOT_FOUND', message: 'Asha doesn’t work there. Add the place on their profile first.' });
  });

  it('keeps time off and blocks for unlinked staff, refusing them for a linked one', async () => {
    const w = await salon();
    const [asha, ben] = [newId(), newId()];
    const fields = { color: null, placeIds: [w.placeId], serviceIds: [] };
    await saveStaff(w.owner, { id: asha, staff: { ...fields, name: 'Asha' } });
    await saveStaff(w.owner, { id: ben, staff: { ...fields, name: 'Ben' } });
    const off = newId();
    const span = { start: `${week.monday}T00:00:00.000Z`, end: `${week.day(2)}T00:00:00.000Z` };
    const team = await addStaffTimeOff(w.owner, { id: off, staffId: asha, reason: 'holiday', ...span });
    expect(team.staff.find((each) => each.id === asha)?.timeOff).toEqual([{ id: off, ...span, reason: 'holiday' }]);
    expect((await removeStaffTimeOff(w.owner, { id: off })).staff.find((each) => each.id === asha)?.timeOff).toEqual(
      [],
    );
    const lunch = { start: `${week.tuesday}T12:00:00.000Z`, end: `${week.tuesday}T13:00:00.000Z` };
    const blocked = await addStaffBlock(w.owner, {
      id: newId(),
      staffId: asha,
      placeId: w.placeId,
      reason: 'Lunch',
      ...lunch,
    });
    expect(blocked.staff.find((each) => each.id === asha)?.blocks[0]).toMatchObject({ ...lunch, reason: 'Lunch' });
    // Ben is Ada (the owner) now: his time off is hers, in Availability.
    await linkStaff(w.owner, { staffId: ben, memberId: w.memberId });
    expect(await refusal(addStaffTimeOff(w.owner, { id: newId(), staffId: ben, reason: 'sick', ...span }))).toEqual({
      code: 'CONFLICT',
      message: 'Their time off comes from their own Availability, as a member of the workspace.',
    });
    const linked = (await getTeam(w.owner)).staff.find((each) => each.id === ben);
    expect(linked).toMatchObject({ memberId: w.memberId, memberName: 'Ada' });
    // Archived, the link goes (so Ada can be another profile), and restore brings the profile back.
    await archiveStaff(w.owner, { staffId: ben });
    const back = await restoreStaff(w.owner, { staffId: ben });
    expect(back.staff.find((each) => each.id === ben)).toMatchObject({ archived: false });
    expect(back.staff.find((each) => each.id === ben)?.memberId).toBeUndefined();
  });
});

describe('who may do what', () => {
  it('lets the desk (Run everyone’s calendar) set shifts but never the catalogue or a profile', async () => {
    const w = await salon();
    const asha = newId();
    await saveStaff(w.owner, { id: asha, staff: { name: 'Asha', color: null, placeIds: [w.placeId], serviceIds: [] } });
    const desk = await holderOf(w, 'services.calendar');
    const shifts = await getShifts(desk);
    expect(shifts.canManage).toBe(false);
    expect(shifts.members).toBeUndefined();
    await setShifts(desk, {
      staffId: asha,
      placeId: w.placeId,
      shifts: allWeek('10:00', '14:00'),
      outsideHours: false,
    });
    expect(await refusal(getCatalogue(desk))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await refusal(saveService(desk, { id: newId(), service: haircut(w) }))).toMatchObject({ code: 'FORBIDDEN' });
    expect(
      await refusal(saveStaff(desk, { id: asha, staff: { name: 'A', color: null, placeIds: [], serviceIds: [] } })),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(await refusal(getTeam(desk))).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lets a manager change the catalogue but not the shifts, and a waiter neither', async () => {
    const w = await salon();
    const asha = newId();
    await saveStaff(w.owner, { id: asha, staff: { name: 'Asha', color: null, placeIds: [w.placeId], serviceIds: [] } });
    const manager = await holderOf(w, 'services.manage');
    await saveService(manager, { id: newId(), service: haircut(w) });
    expect(
      await refusal(
        setShifts(manager, {
          staffId: asha,
          placeId: w.placeId,
          shifts: allWeek('10:00', '14:00'),
          outsideHours: false,
        }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
    const waiter = await waiterScope(db, w);
    expect(await refusal(getCatalogue(waiter))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await refusal(getShifts(waiter))).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses everything while Appointments isn’t installed', async () => {
    const w = await visitWorkspace(db, 'table_seating');
    expect(await refusal(getCatalogue(w.owner))).toMatchObject({ code: 'APP_NOT_INSTALLED' });
    expect(
      await refusal(
        saveStaff(w.owner, { id: newId(), staff: { name: 'A', color: null, placeIds: [], serviceIds: [] } }),
      ),
    ).toMatchObject({ code: 'APP_NOT_INSTALLED' });
  });

  it('never shows another workspace’s services', async () => {
    const a = await salon();
    const b = await salon();
    await saveService(a.owner, { id: newId(), service: haircut(a) });
    expect((await getCatalogue(b.owner)).services).toEqual([]);
    // Naming another workspace's place is refused as unknown.
    expect(await refusal(saveService(b.owner, { id: newId(), service: haircut(a) }))).toEqual({
      field: 'placeIds',
      message: 'One of those places doesn’t exist.',
    });
  });
});
