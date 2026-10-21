// Availability schedules in core (spec 0035), against the real Postgres: the
// migration's data move keeps every page's slots for 60 days (AC-973,
// AC-974), the default moves pages that follow it (AC-962, AC-965), deleting
// a schedule in use points its pages at the default (AC-967), who may touch
// whose (AC-966, AC-971), bookings stay put (AC-968), and the outbox row.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { defaultAvailability, type BookingAvailability } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingPage } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { outboxHook } from '../engine/outbox.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';
import { NO_CALENDAR } from '../booking/calendar.ts';
import { createBookingPage, getBookingPage, updateBookingPage } from '../booking/pages.ts';
import { bookPublicSlot, readPublicSlots } from '../booking/public.ts';
import { loadPage, pageSlots } from '../booking/slots.ts';
import { defaultSchedule, scheduleFor } from './resolve.ts';
import {
  createSchedule,
  deleteSchedule,
  duplicateSchedule,
  getSchedule,
  listScheduleMembers,
  listSchedules,
  readDefaultHours,
  saveDefaultHours,
  setDefaultSchedule,
  updateSchedule,
} from './schedules.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-schedules-tests' });
});
afterAll(async () => {
  await db.close();
});

/** Sunday 1 November 2026, midnight UTC. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
/** The key a booking's manage link derives from (spec 0025, milestone 2). */
const LINK_KEY = Buffer.alloc(32, 7);
/** What the public page's reads and bookings take: no calendar, the fixed clock and the link key. */
const PUBLIC = { calendar: NO_CALENDAR, now: () => NOW, linkKey: LINK_KEY };

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Schedules',
    slug: `schedules-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Host', email: 'ada@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const addMember = async (name: string, role: 'admin' | 'member') => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${name}-${id}@example.com`}, ${role}, 'system', 'system')`,
      ),
    );
    return { id, scope: rescope(owner, { actor: { type: 'member', id }, role }) };
  };
  return { ...created, owner, addMember };
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

/** Monday's 30 minute slots on a page, as the public page offers them, by start in UTC. */
async function mondayStarts(publicKey: string): Promise<readonly string[]> {
  const entry = await enterBookingPage({ db }, publicKey);
  const answer = await readPublicSlots(entry, PUBLIC, {
    from: '2026-11-02T00:00:00.000Z',
    to: '2026-11-03T00:00:00.000Z',
    duration: 30,
    tz: 'UTC',
  });
  return answer.slots.map((slot) => slot.start);
}

/** A page's 30 minute slots between two instants, as the public page offers them, with the clock at `now`. */
async function startsBetween(publicKey: string, from: string, to: string, now: Date): Promise<readonly string[]> {
  const entry = await enterBookingPage({ db }, publicKey);
  const answer = await readPublicSlots(entry, { ...PUBLIC, now: () => now }, { from, to, duration: 30, tz: 'UTC' });
  return answer.slots.map((slot) => slot.start);
}

const week = (ranges: [string, string][]): BookingAvailability['weekly'] => ({
  mon: ranges,
  tue: ranges,
  wed: ranges,
  thu: ranges,
  fri: ranges,
  sat: [],
  sun: [],
});

describe('the migration (AC-973, AC-974)', () => {
  /** The data move of migration 0052, as written: the statements that copy members' and pages' hours. */
  const dataMove = () => {
    const file = readFileSync(
      fileURLToPath(new URL('../../../db/migrations/0052_availability_schedules.sql', import.meta.url)),
      'utf8',
    );
    return file
      .split('--> statement-breakpoint')
      .filter((statement) => statement.includes('from booking_member_hours h') || statement.includes('do $$'));
  };

  it('gives every page the same slots for 60 days, before and after, and names schedules after pages', async () => {
    const w = await workspace();
    const bea = await w.addMember('bea', 'member');
    const london: BookingAvailability = {
      timeZone: 'Europe/London',
      weekly: week([
        ['10:00', '12:00'],
        ['14:00', '16:30'],
      ]),
      overrides: [
        { date: '2026-11-11', ranges: [] },
        { date: '2026-11-14', ranges: [['09:00', '10:00']] },
      ],
    };
    const tokyo: BookingAvailability = { ...defaultAvailability('Asia/Tokyo'), weekly: week([['08:00', '11:00']]) };
    const paris: BookingAvailability = { ...defaultAvailability('Europe/Paris'), weekly: week([['13:00', '18:00']]) };
    // Today's shapes, as the old code wrote them: the owner's own hours, and pages that keep or follow hours.
    await testQuery(
      ownerUrl,
      `insert into booking_member_hours (workspace_id, member_id, availability, created_by_type, updated_by_type)
       values ($1, $2, $3, 'system', 'system')`,
      [w.workspaceId, w.memberId, JSON.stringify(london)],
    );
    const seeded = [
      { owner: w.memberId, title: 'Intro call', mode: 'own', hours: tokyo },
      { owner: w.memberId, title: 'Intro call', mode: 'own', hours: paris },
      { owner: w.memberId, title: 'Working', mode: 'own', hours: paris },
      { owner: w.memberId, title: 'Follows', mode: 'mine', hours: tokyo },
      { owner: bea.id, title: 'Bea follows', mode: 'mine', hours: defaultAvailability('America/New_York') },
      { owner: bea.id, title: 'Bea own', mode: 'own', hours: tokyo },
    ] as const;
    const pages = [];
    for (const [index, page] of seeded.entries()) {
      const id = newId();
      const publicKey = `sched${String(index)}${id.replaceAll('-', '').slice(0, 11)}`.slice(0, 16);
      await testQuery(
        ownerUrl,
        `insert into booking_pages (workspace_id, id, public_key, slug, owner_member_id, title, durations, location,
           availability, hours_mode, window_days, created_by_type, updated_by_type)
         values ($1, $2, $3, $4, $5, $6, '{30}', '{"type":"video"}', $7, $8, 60, 'system', 'system')`,
        [
          w.workspaceId,
          id,
          publicKey,
          `page-${String(index)}`,
          page.owner,
          page.title,
          JSON.stringify(page.hours),
          page.mode,
        ],
      );
      await testQuery(
        ownerUrl,
        `insert into booking_page_members (workspace_id, page_id, member_id, position) values ($1, $2, $3, 0)`,
        [w.workspaceId, id, page.owner],
      );
      pages.push({ ...page, id });
    }
    const from = NOW;
    const to = new Date(NOW.getTime() + 60 * 86_400_000);
    const slotsOf = async (pageId: string, hours?: BookingAvailability) => {
      const page = await db.withWorkspace(w.workspaceId, (tx) => loadPage(tx, pageId));
      if (page === undefined) throw new Error('No page.');
      const read = hours === undefined ? page : { ...page, availability: hours };
      return pageSlots(read, {
        duration: 30,
        from,
        to,
        now: NOW,
        busy: { busy: [], blocked: false, noCalendar: true },
        bookings: [],
      }).map((slot) => slot.start.toISOString());
    };
    // Before: the hours the old `loadPage` read (own: the page's; mine: the owner's, else 9 to 5 in the page's zone).
    const before = new Map<string, readonly string[]>();
    for (const page of pages) {
      const legacy =
        page.mode === 'own'
          ? page.hours
          : page.owner === w.memberId
            ? london
            : defaultAvailability(page.hours.timeZone);
      before.set(page.id, await slotsOf(page.id, legacy));
    }
    for (const statement of dataMove()) await testQuery(ownerUrl, statement);
    for (const page of pages) {
      const after = await slotsOf(page.id);
      expect(after.length, page.title).toBeGreaterThan(0);
      expect(after, page.title).toEqual(before.get(page.id));
    }
    const names = await testQuery<{ member_id: string; name: string; is_default: boolean }>(
      ownerUrl,
      `select member_id::text, name, is_default from availability_schedules where workspace_id = $1 order by created_at, name`,
      [w.workspaceId],
    );
    expect(names.filter((row) => row.member_id === w.memberId).map((row) => [row.name, row.is_default])).toEqual(
      expect.arrayContaining([
        ['Working hours', true],
        ['Intro call hours', false],
        ['Intro call hours 2', false],
        ['Working hours 2', false],
      ]),
    );
    // Bea never saved hours: her own page's schedule isn't her default, so her other page still follows the virtual one.
    expect(names.filter((row) => row.member_id === bea.id).map((row) => [row.name, row.is_default])).toEqual([
      ['Bea own hours', false],
    ]);
    // Run again, it changes nothing.
    for (const statement of dataMove()) await testQuery(ownerUrl, statement);
    const again = await testQuery(ownerUrl, `select 1 from availability_schedules where workspace_id = $1`, [
      w.workspaceId,
    ]);
    expect(again).toHaveLength(names.length);
  });
});

describe('schedules (AC-961 to AC-972)', () => {
  it('lists the virtual default until anything is stored, then keeps it; new ones copy the default, at most 20', async () => {
    const w = await workspace();
    const listed = await listSchedules(w.owner, { timeZone: 'Europe/Berlin' });
    expect(listed.schedules).toMatchObject([
      { id: null, name: 'Working hours', isDefault: true, availability: { timeZone: 'Europe/Berlin' } },
    ]);
    const evenings = await createSchedule(w.owner, { id: newId(), name: 'Evenings', timeZone: 'Europe/Berlin' });
    expect(evenings).toMatchObject({ isDefault: false, availability: { timeZone: 'Europe/Berlin' } });
    expect(evenings.availability.weekly.mon).toEqual([['09:00', '17:00']]);
    // The virtual default is stored beside the first schedule added, in the same zone, and stays the default.
    const after = await listSchedules(w.owner, { timeZone: 'UTC' });
    expect(
      after.schedules.map((each) => [each.name, each.isDefault, each.id === null, each.availability.timeZone]),
    ).toEqual([
      ['Working hours', true, false, 'Europe/Berlin'],
      ['Evenings', false, false, 'Europe/Berlin'],
    ]);
    expect(await refusalOf(createSchedule(w.owner, { id: newId(), name: 'EVENINGS', timeZone: 'UTC' }))).toMatchObject({
      code: 'NAME_TAKEN',
      field: 'name',
      message: 'Another schedule is called EVENINGS.',
    });
    // A retry of the same create answers the same schedule, storing nothing more.
    const retried = await createSchedule(w.owner, { id: evenings.id ?? '', name: 'Evenings', timeZone: 'UTC' });
    expect(retried.id).toBe(evenings.id);
    for (let n = 3; n <= 20; n += 1) {
      await createSchedule(w.owner, { id: newId(), name: `Schedule ${String(n)}`, timeZone: 'UTC' });
    }
    expect((await listSchedules(w.owner, { timeZone: 'UTC' })).schedules).toHaveLength(20);
    expect(await refusalOf(createSchedule(w.owner, { id: newId(), name: 'One more', timeZone: 'UTC' }))).toMatchObject({
      code: 'SCHEDULE_LIMIT',
    });
  });

  it('stores the virtual default with the hours its first save sends (AC-963)', async () => {
    const w = await workspace();
    const hours = { ...defaultAvailability('Asia/Kolkata'), weekly: week([['10:00', '13:30']]) };
    const saved = await createSchedule(w.owner, {
      id: newId(),
      name: 'Working hours',
      timeZone: 'Asia/Kolkata',
      availability: hours,
      isDefault: true,
    });
    expect(saved).toMatchObject({ name: 'Working hours', isDefault: true, availability: hours });
    const listed = await listSchedules(w.owner, { timeZone: 'UTC' });
    expect(listed.schedules.map((each) => [each.id, each.isDefault])).toEqual([[saved.id, true]]);
  });

  it('moves the pages that follow the default when the default moves, and a page may name one (AC-962, AC-965)', async () => {
    const w = await workspace();
    const working = await createSchedule(w.owner, {
      id: newId(),
      name: 'Working hours',
      timeZone: 'UTC',
      availability: { ...defaultAvailability('UTC'), weekly: week([['09:00', '10:00']]) },
      isDefault: true,
    });
    const evenings = await createSchedule(w.owner, {
      id: newId(),
      name: 'Evenings',
      timeZone: 'UTC',
      availability: { ...defaultAvailability('UTC'), weekly: week([['18:00', '19:00']]) },
    });
    const a = await createBookingPage(w.owner, { id: newId(), title: 'A', timeZone: 'UTC' }, NOW);
    const b = await createBookingPage(w.owner, { id: newId(), title: 'B', timeZone: 'UTC' }, NOW);
    expect(await mondayStarts(a.publicKey)).toEqual(['2026-11-02T09:00:00.000Z', '2026-11-02T09:30:00.000Z']);
    await setDefaultSchedule(w.owner, { id: evenings.id ?? '' });
    for (const page of [a, b]) {
      expect(await mondayStarts(page.publicKey)).toEqual(['2026-11-02T18:00:00.000Z', '2026-11-02T18:30:00.000Z']);
    }
    const list = await listSchedules(w.owner, { timeZone: 'UTC' });
    expect(list.schedules.map((each) => [each.name, each.isDefault, each.pages.length])).toEqual([
      ['Evenings', true, 2],
      ['Working hours', false, 0],
    ]);
    // A page naming Working hours keeps it, whatever the default.
    const named = await updateBookingPage(w.owner, { pageId: a.id, settings: { scheduleId: working.id } }, NOW);
    expect(named).toMatchObject({ scheduleId: working.id, availability: { weekly: { mon: [['09:00', '10:00']] } } });
    expect(await mondayStarts(a.publicKey)).toEqual(['2026-11-02T09:00:00.000Z', '2026-11-02T09:30:00.000Z']);
  });

  it('asks nothing of the default but refuses deleting it, and points a deleted schedule’s pages at the default (AC-967)', async () => {
    const w = await workspace();
    const working = await createSchedule(w.owner, {
      id: newId(),
      name: 'Working hours',
      timeZone: 'UTC',
      isDefault: true,
    });
    const evenings = await createSchedule(w.owner, {
      id: newId(),
      name: 'Evenings',
      timeZone: 'UTC',
      availability: { ...defaultAvailability('UTC'), weekly: week([['18:00', '19:00']]) },
    });
    const page = await createBookingPage(
      w.owner,
      { id: newId(), title: 'Late', timeZone: 'UTC', settings: { scheduleId: evenings.id } },
      NOW,
    );
    expect(await refusalOf(deleteSchedule(w.owner, { id: working.id ?? '' }))).toMatchObject({
      code: 'DEFAULT_SCHEDULE',
      message: 'Set another schedule as default first.',
    });
    expect(await deleteSchedule(w.owner, { id: evenings.id ?? '' })).toEqual({
      id: evenings.id,
      repointed: { pages: 1 },
    });
    expect(await getBookingPage(w.owner, { pageId: page.id }, NOW)).toMatchObject({ scheduleId: null });
    expect(await mondayStarts(page.publicKey)).toHaveLength(16);
  });

  it('duplicates as "<name> copy", renames with the stale check, and keeps bookings when hours change (AC-964, AC-968)', async () => {
    const w = await workspace();
    const working = await createSchedule(w.owner, {
      id: newId(),
      name: 'Working hours',
      timeZone: 'UTC',
      isDefault: true,
    });
    const copy = await duplicateSchedule(w.owner, { id: working.id ?? '', newId: newId() });
    expect(copy).toMatchObject({ name: 'Working hours copy', isDefault: false, availability: working.availability });
    const second = await duplicateSchedule(w.owner, { id: working.id ?? '', newId: newId() });
    expect(second.name).toBe('Working hours copy 2');
    const renamed = await updateSchedule(w.owner, {
      id: copy.id ?? '',
      name: 'Partners',
      updatedAt: copy.updatedAt ?? '',
    });
    expect(renamed.name).toBe('Partners');
    expect(
      await refusalOf(updateSchedule(w.owner, { id: copy.id ?? '', name: 'Again', updatedAt: copy.updatedAt ?? '' })),
    ).toMatchObject({ code: 'STALE' });
    const page = await createBookingPage(w.owner, { id: newId(), title: 'Intro', timeZone: 'UTC' }, NOW);
    const entry = await enterBookingPage({ db }, page.publicKey);
    const booked = await bookPublicSlot(entry, PUBLIC, {
      idempotencyKey: newId(),
      start: '2026-11-02T09:00:00.000Z',
      duration: 30,
      name: 'Grace',
      email: 'grace@example.com',
      timeZone: 'UTC',
    });
    const current = await getSchedule(w.owner, { id: working.id ?? '' });
    await updateSchedule(w.owner, {
      id: working.id ?? '',
      availability: { ...current.availability, weekly: week([['18:00', '19:00']]) },
      updatedAt: current.updatedAt ?? '',
    });
    const rows = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ status: string }>(sql`select status from bookings where id = ${booked.bookingId}`),
    );
    expect(rows.rows).toEqual([{ status: 'confirmed' }]);
  });

  it('lets only booking.admin touch a colleague’s schedules, and refuses a page naming one (AC-966, AC-971)', async () => {
    const w = await workspace();
    const bea = await w.addMember('bea', 'member');
    const cy = await w.addMember('cy', 'admin');
    const beas = await createSchedule(bea.scope, { id: newId(), name: 'Evenings', timeZone: 'UTC' });
    const other = await w.addMember('dee', 'member');
    expect(await refusalOf(listSchedules(other.scope, { memberId: bea.id, timeZone: 'UTC' }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(
      await refusalOf(
        updateSchedule(other.scope, { id: beas.id ?? '', name: 'Mine', updatedAt: beas.updatedAt ?? '' }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });
    const renamed = await updateSchedule(cy.scope, {
      id: beas.id ?? '',
      name: 'Late',
      updatedAt: beas.updatedAt ?? '',
    });
    expect(renamed.name).toBe('Late');
    expect((await listSchedules(cy.scope, { memberId: bea.id, timeZone: 'UTC' })).schedules).toHaveLength(2);
    const made = await createSchedule(cy.scope, { id: newId(), memberId: bea.id, name: 'Mornings', timeZone: 'UTC' });
    expect(made.memberId).toBe(bea.id);
    const page = await createBookingPage(other.scope, { id: newId(), title: 'Dee', timeZone: 'UTC' }, NOW);
    expect(
      await refusalOf(updateBookingPage(other.scope, { pageId: page.id, settings: { scheduleId: beas.id } }, NOW)),
    ).toMatchObject({ code: 'SCHEDULE_NOT_ALLOWED', field: 'scheduleId' });
  });

  it('refuses every read and write to whoever may not make it, and changes nothing (AC-971)', async () => {
    const w = await workspace();
    const bea = await w.addMember('bea', 'member');
    const dee = await w.addMember('dee', 'member');
    const beas = await createSchedule(bea.scope, { id: newId(), name: 'Evenings', timeZone: 'UTC' });
    const before = await listSchedules(bea.scope, { timeZone: 'UTC' });
    const working = before.schedules.find((each) => each.isDefault);
    if (working?.id === undefined || working.id === null || beas.id === null || beas.updatedAt === null) {
      throw new Error('Nothing stored.');
    }
    const hours = defaultAvailability('UTC');
    const calls = (scope: typeof w.owner, memberId?: string) => ({
      list: () => listSchedules(scope, { memberId, timeZone: 'UTC' }),
      get: () => getSchedule(scope, { id: beas.id ?? '' }),
      create: () => createSchedule(scope, { id: newId(), memberId, name: 'Mine now', timeZone: 'UTC' }),
      update: () => updateSchedule(scope, { id: beas.id ?? '', name: 'Mine', updatedAt: beas.updatedAt ?? '' }),
      setDefault: () => setDefaultSchedule(scope, { id: beas.id ?? '' }),
      duplicate: () => duplicateSchedule(scope, { id: beas.id ?? '', newId: newId() }),
      delete: () => deleteSchedule(scope, { id: beas.id ?? '' }),
      saveDefaultHours: () => saveDefaultHours(scope, { availability: hours }),
      readDefaultHours: () => readDefaultHours(scope, { timeZone: 'UTC' }),
    });
    // A key without booking.manage: 403 on every one.
    const key = rescope(w.owner, { actor: { type: 'api_key', id: newId() }, scopes: ['data.read'] });
    for (const [name, call] of Object.entries(calls(key, bea.id))) {
      expect(await refusalOf(call()), name).toMatchObject({ code: 'FORBIDDEN' });
    }
    // Dee, a member: naming Bea is 403; Bea's schedule answers as absent.
    const asDee = calls(dee.scope, bea.id);
    expect(await refusalOf(asDee.list())).toMatchObject({ code: 'FORBIDDEN' });
    expect(await refusalOf(asDee.create())).toMatchObject({ code: 'FORBIDDEN' });
    for (const name of ['get', 'update', 'setDefault', 'duplicate', 'delete'] as const) {
      expect(await refusalOf(asDee[name]()), name).toMatchObject({ code: 'NOT_FOUND' });
    }
    // Bea's default can't be deleted, even by an admin.
    expect(await refusalOf(deleteSchedule(w.owner, { id: working.id }))).toMatchObject({ code: 'DEFAULT_SCHEDULE' });
    expect(await listSchedules(bea.scope, { timeZone: 'UTC' })).toEqual(before);
  });

  it('answers whose schedules the reader may view: everyone active for booking.admin, themselves for a member', async () => {
    const w = await workspace();
    const bea = await w.addMember('bea', 'member');
    const cy = await w.addMember('cy', 'admin');
    const gone = await w.addMember('gone', 'member');
    await testQuery(ownerUrl, `update members set status = 'removed' where id = $1`, [gone.id]);
    const admins = await listScheduleMembers(cy.scope);
    expect(admins.members.map((each) => each.name)).toEqual(['Ada Host', 'bea', 'cy']);
    expect((await listScheduleMembers(bea.scope)).members).toEqual([{ id: bea.id, name: 'bea' }]);
  });

  it('lets a colleague read a schedule through a page they book on, showing only those pages (AC-971)', async () => {
    const w = await workspace();
    const bea = await w.addMember('bea', 'member');
    const evenings = await createSchedule(w.owner, { id: newId(), name: 'Evenings', timeZone: 'UTC' });
    const page = await createBookingPage(
      w.owner,
      { id: newId(), title: 'Team call', timeZone: 'UTC', settings: { scheduleId: evenings.id } },
      NOW,
    );
    await createBookingPage(
      w.owner,
      { id: newId(), title: 'Private one', timeZone: 'UTC', settings: { scheduleId: evenings.id } },
      NOW,
    );
    expect(await refusalOf(getSchedule(bea.scope, { id: evenings.id ?? '' }))).toMatchObject({ code: 'NOT_FOUND' });
    // Bea joins the first page's members, as a collective page's member does.
    await testQuery(
      ownerUrl,
      `insert into booking_page_members (workspace_id, page_id, member_id, position) values ($1, $2, $3, 1)`,
      [w.workspaceId, page.id, bea.id],
    );
    const read = await getSchedule(bea.scope, { id: evenings.id ?? '' });
    expect(read).toMatchObject({ name: 'Evenings', pages: [{ id: page.id, title: 'Team call' }] });
    const owners = await getSchedule(w.owner, { id: evenings.id ?? '' });
    expect(owners.pages.map((each) => each.title)).toEqual(['Private one', 'Team call']);
  });

  it('keeps a day off’s note its member’s alone: hidden from an admin and a colleague, kept through an admin’s save', async () => {
    const w = await workspace();
    const bea = await w.addMember('bea', 'member');
    const cy = await w.addMember('cy', 'admin');
    const hours: BookingAvailability = {
      ...defaultAvailability('UTC'),
      overrides: [
        { date: '2026-11-03', ranges: [], note: 'Hospital appointment' },
        { date: '2026-11-04', ranges: [] },
      ],
    };
    const beas = await createSchedule(bea.scope, {
      id: newId(),
      name: 'Working hours',
      timeZone: 'UTC',
      availability: hours,
      isDefault: true,
    });
    expect(beas.availability.overrides[0]?.note).toBe('Hospital appointment');
    const page = await createBookingPage(bea.scope, { id: newId(), title: 'Team call', timeZone: 'UTC' }, NOW);
    // An admin reads the days, never why.
    const listed = await listSchedules(cy.scope, { memberId: bea.id, timeZone: 'UTC' });
    expect(listed.schedules[0]?.availability.overrides).toEqual([
      { date: '2026-11-03', ranges: [] },
      { date: '2026-11-04', ranges: [] },
    ]);
    expect((await getSchedule(cy.scope, { id: beas.id ?? '' })).availability.overrides[0]).not.toHaveProperty('note');
    expect((await getBookingPage(cy.scope, { pageId: page.id }, NOW)).availability.overrides[0]).not.toHaveProperty(
      'note',
    );
    expect((await getBookingPage(bea.scope, { pageId: page.id }, NOW)).availability.overrides[0]?.note).toBe(
      'Hospital appointment',
    );
    // A colleague reading through a page they book on sees no note either.
    await testQuery(
      ownerUrl,
      `insert into booking_page_members (workspace_id, page_id, member_id, position) values ($1, $2, $3, 1)`,
      [w.workspaceId, page.id, w.memberId],
    );
    const owner = await getSchedule(rescope(w.owner, { role: 'member' }), { id: beas.id ?? '' });
    expect(owner.availability.overrides[0]).not.toHaveProperty('note');
    // The admin saves the week with what they saw: Bea's note stays on the date it kept; the date dropped goes.
    const seen = (await getSchedule(cy.scope, { id: beas.id ?? '' })).availability;
    await updateSchedule(cy.scope, {
      id: beas.id ?? '',
      availability: { ...seen, weekly: week([['10:00', '12:00']]), overrides: seen.overrides.slice(0, 1) },
      updatedAt: beas.updatedAt ?? '',
    });
    const after = await getSchedule(bea.scope, { id: beas.id ?? '' });
    expect(after.availability.overrides).toEqual([{ date: '2026-11-03', ranges: [], note: 'Hospital appointment' }]);
    expect(after.availability.weekly.mon).toEqual([['10:00', '12:00']]);
  });

  it('stores a colleague’s virtual default in the zone their pages book in, when an admin adds their first schedule', async () => {
    const w = await workspace();
    const bea = await w.addMember('bea', 'member');
    const cy = await w.addMember('cy', 'admin');
    const page = await createBookingPage(bea.scope, { id: newId(), title: 'Call', timeZone: 'America/New_York' }, NOW);
    const before = await mondayStarts(page.publicKey);
    // Cy works from London; Bea's pages book 9 to 5 in New York.
    await createSchedule(cy.scope, { id: newId(), memberId: bea.id, name: 'Mornings', timeZone: 'Europe/London' });
    const listed = await listSchedules(cy.scope, { memberId: bea.id, timeZone: 'Europe/London' });
    expect(listed.schedules.map((each) => [each.name, each.isDefault, each.availability.timeZone])).toEqual([
      ['Working hours', true, 'America/New_York'],
      ['Mornings', false, 'America/New_York'],
    ]);
    expect(await mondayStarts(page.publicKey)).toEqual(before);
  });

  it('never refuses a member’s first default for room, whatever pages from before spec 0035 left them (AC-961)', async () => {
    const w = await workspace();
    // Twenty schedules a migration made from pages' own hours, and no default.
    for (let n = 1; n <= 20; n += 1) {
      await testQuery(
        ownerUrl,
        `insert into availability_schedules (workspace_id, member_id, name, is_default, availability, created_by_type, updated_by_type)
         values ($1, $2, $3, false, $4, 'system', 'system')`,
        [w.workspaceId, w.memberId, `Page ${String(n)} hours`, JSON.stringify(defaultAvailability('UTC'))],
      );
    }
    expect(await refusalOf(createSchedule(w.owner, { id: newId(), name: 'One more', timeZone: 'UTC' }))).toMatchObject({
      code: 'SCHEDULE_LIMIT',
    });
    await saveDefaultHours(w.owner, { availability: defaultAvailability('UTC') });
    const listed = await listSchedules(w.owner, { timeZone: 'UTC' });
    expect(listed.schedules).toHaveLength(21);
    expect(listed.schedules[0]).toMatchObject({ name: 'Working hours', isDefault: true });
  });

  it('stores one schedules outbox row per write, ids only (AC-977)', async () => {
    const w = await workspace();
    const mutationId = newId();
    const made = await createSchedule(
      w.owner,
      { id: newId(), name: 'Working hours', timeZone: 'UTC', isDefault: true },
      [outboxHook({ mutationId })],
    );
    await saveDefaultHours(w.owner, { availability: defaultAvailability('UTC') }, [outboxHook()]);
    const rows = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ kind: string; item_ids: string[]; record_ids: string[] }>(
        sql`select kind::text, item_ids::text[], record_ids::text[] from outbox where kind = 'schedules' order by seq`,
      ),
    );
    expect(rows.rows).toEqual([
      { kind: 'schedules', item_ids: [made.id], record_ids: [] },
      { kind: 'schedules', item_ids: [made.id], record_ids: [] },
    ]);
  });
});

describe('slots by schedule: zones, daylight saving and date overrides (AC-961, AC-965, AC-976)', () => {
  /** Monday 26 October 2026, midnight UTC: the week before New York leaves daylight saving (1 November). */
  const OCTOBER = new Date('2026-10-26T00:00:00.000Z');

  it('reads a schedule in its own zone across the change, never the page’s, with its overrides', async () => {
    const w = await workspace();
    const newYork: BookingAvailability = {
      timeZone: 'America/New_York',
      weekly: week([['09:00', '10:00']]),
      overrides: [
        { date: '2026-11-03', ranges: [] },
        { date: '2026-11-04', ranges: [['13:00', '14:00']] },
      ],
    };
    await createSchedule(w.owner, {
      id: newId(),
      name: 'Working hours',
      timeZone: 'America/New_York',
      availability: newYork,
      isDefault: true,
    });
    // Made in Tokyo: the page's own zone, which only the virtual default would read.
    const page = await createBookingPage(w.owner, { id: newId(), title: 'Call', timeZone: 'Asia/Tokyo' }, OCTOBER);
    expect(
      await startsBetween(page.publicKey, '2026-10-29T00:00:00.000Z', '2026-11-05T00:00:00.000Z', OCTOBER),
    ).toEqual([
      // Thursday and Friday on daylight time: 9:00 in New York is 13:00 UTC.
      '2026-10-29T13:00:00.000Z',
      '2026-10-29T13:30:00.000Z',
      '2026-10-30T13:00:00.000Z',
      '2026-10-30T13:30:00.000Z',
      // Monday on standard time: 9:00 is 14:00 UTC.
      '2026-11-02T14:00:00.000Z',
      '2026-11-02T14:30:00.000Z',
      // Tuesday is a day off; Wednesday has its own hours, 13:00 to 14:00 in New York.
      '2026-11-04T18:00:00.000Z',
      '2026-11-04T18:30:00.000Z',
    ]);
  });

  it('reads a named schedule at +05:30 with an override on its own date, whatever the default says', async () => {
    const w = await workspace();
    await createSchedule(w.owner, {
      id: newId(),
      name: 'Working hours',
      timeZone: 'America/New_York',
      availability: { ...defaultAvailability('America/New_York'), weekly: week([['09:00', '10:00']]) },
      isDefault: true,
    });
    const india = await createSchedule(w.owner, {
      id: newId(),
      name: 'India',
      timeZone: 'Asia/Kolkata',
      availability: {
        timeZone: 'Asia/Kolkata',
        weekly: week([['09:00', '10:00']]),
        // Monday 2 November in Kolkata, which starts at 18:30 UTC on the Sunday.
        overrides: [{ date: '2026-11-02', ranges: [['18:00', '18:30']] }],
      },
    });
    const page = await createBookingPage(
      w.owner,
      { id: newId(), title: 'India call', timeZone: 'UTC', settings: { scheduleId: india.id } },
      OCTOBER,
    );
    expect(
      await startsBetween(page.publicKey, '2026-11-01T00:00:00.000Z', '2026-11-04T00:00:00.000Z', OCTOBER),
    ).toEqual(['2026-11-02T12:30:00.000Z', '2026-11-03T03:30:00.000Z', '2026-11-03T04:00:00.000Z']);
    // Moved to London, the same hours follow the new zone from the next read (AC-968).
    const current = await getSchedule(w.owner, { id: india.id ?? '' });
    await updateSchedule(w.owner, {
      id: india.id ?? '',
      availability: { ...current.availability, timeZone: 'Europe/London', overrides: [] },
      updatedAt: current.updatedAt ?? '',
    });
    expect(
      await startsBetween(page.publicKey, '2026-11-02T00:00:00.000Z', '2026-11-03T00:00:00.000Z', OCTOBER),
    ).toEqual(['2026-11-02T09:00:00.000Z', '2026-11-02T09:30:00.000Z']);
  });

  it('answers defaultSchedule and scheduleFor for other specs, the virtual default in the zone asked (AC-976)', async () => {
    const w = await workspace();
    const bea = await w.addMember('bea', 'member');
    const virtual = await db.withWorkspace(w.workspaceId, (tx) => defaultSchedule(tx, w.memberId, 'Asia/Kolkata'));
    expect(virtual).toEqual({
      id: undefined,
      name: 'Working hours',
      isDefault: true,
      availability: defaultAvailability('Asia/Kolkata'),
    });
    const evenings = await createSchedule(w.owner, {
      id: newId(),
      name: 'Evenings',
      timeZone: 'UTC',
      availability: { ...defaultAvailability('UTC'), weekly: week([['18:00', '20:00']]) },
    });
    const beas = await createSchedule(bea.scope, { id: newId(), name: 'Bea late', timeZone: 'UTC' });
    const answers = await db.withWorkspace(w.workspaceId, async (tx) => ({
      // The first schedule added stored the default beside it, in its zone.
      stored: await defaultSchedule(tx, w.memberId, 'Asia/Kolkata'),
      named: await scheduleFor(tx, { memberId: w.memberId, scheduleId: evenings.id ?? '', fallbackZone: 'UTC' }),
      // Another member's schedule is never this member's: their default answers.
      someoneElses: await scheduleFor(tx, { memberId: w.memberId, scheduleId: beas.id ?? '', fallbackZone: 'UTC' }),
    }));
    expect(answers.stored).toMatchObject({ name: 'Working hours', isDefault: true, availability: { timeZone: 'UTC' } });
    expect(answers.stored.id).toEqual(expect.any(String));
    expect(answers.named).toMatchObject({ id: evenings.id, name: 'Evenings', isDefault: false });
    expect(answers.someoneElses).toMatchObject({ id: answers.stored.id, name: 'Working hours' });
  });
});

describe('one write path (spec 0037, AC-1444)', () => {
  it('writes availability_schedules only from the schedules module, so audit and notices attach in one place', () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const writers = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter((file) =>
        /\.(insert|update|delete)\(availabilitySchedules\)/.test(readFileSync(`${root}${file}`, 'utf8')),
      );
    expect(writers).toEqual(['availability/schedules.ts']);
  });
});
