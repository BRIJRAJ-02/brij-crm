// One person, two engines (spec 0066, AC-6606) against the real Postgres as the app role: a staff profile linked to a
// member is that member. Their client visits close their meeting slots (public slots, a booking's recheck, a move,
// the Team day), their meetings and time off close their visit times, a meeting and a visit raced for the same
// person give one winner, an unlinked staff member's own time off closes theirs, any staff goes to the least booked,
// and linking refuses while a visit and a meeting overlap.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PublicBookInput } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { enterBookingByToken, enterBookingPage } from '../access/door.ts';
import { createTimeBlock } from '../booking/blocks.ts';
import { NO_CALENDAR } from '../booking/calendar.ts';
import { guestTarget, moveBooking } from '../booking/change.ts';
import { createBookingPage } from '../booking/pages.ts';
import { bookPublicSlot, readPublicSlots } from '../booking/public.ts';
import { memberBookings } from '../booking/slots.ts';
import { readTeamDay } from '../booking/team-day.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { removeMember } from '../members/members.ts';
import { rollingWeek } from '../../test/dates-kit.ts';
import {
  addMember,
  addService,
  addStaff,
  allWeek,
  visitWorkspace,
  type VisitWorkspace,
} from '../../test/visits-kit.ts';
import { bookVisit, visitTimes, type VisitBookInput } from './book.ts';
import { loadVisitInputs } from './load.ts';
import { linkStaffMember } from './staff-link.ts';
import { setVisitStatus } from './table-service.ts';
import { rescope } from '../testing.ts';

const { appUrl } = inject('testDatabase');
const LINK_KEY = Buffer.alloc(32, 7);
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-visits-one-person-tests' });
});
afterAll(async () => {
  await db.close();
});

const week = rollingWeek();
const DAY = week.monday;
const NOW = new Date(`${week.sunday}T00:00:00Z`);
/** A year out from November is winter: London reads as UTC. */
const at = (time: string) => `${DAY}T${time}:00.000Z`;
const visitDeps = { busy: NO_CALENDAR.busy, now: () => NOW };
const meetingDeps = { calendar: NO_CALENDAR, now: () => NOW, linkKey: LINK_KEY };

/** A salon whose owner is also a stylist (linked), with a booking page of theirs (weekdays 09:00 to 17:00 UTC). */
async function salon() {
  const w = await visitWorkspace(db, 'appointments');
  await w.sql(sql`update places set hours = ${JSON.stringify(allWeek('09:00', '18:00'))}::jsonb`);
  const ada = await addStaff(w, 'Ada', { memberId: w.memberId, position: 0 });
  const cut = await addService(w, {
    name: 'Cut',
    minutes: 60,
    capacityMode: 'one',
    staffRule: 'all',
    needs: [],
    step: 30,
  });
  const page = await createBookingPage(
    w.owner,
    { id: newId(), title: 'Intro call', timeZone: 'UTC', settings: {} },
    NOW,
  );
  const entry = await enterBookingPage({ db }, page.publicKey);
  return { w, ada, cut, page, entry };
}

const visit = (
  w: VisitWorkspace,
  cut: { serviceId: string; variantId: string },
  start: string,
  staffId?: string,
): VisitBookInput => ({
  placeId: w.placeId,
  items: [{ ...cut, ...(staffId === undefined ? {} : { staffId }) }],
  party: 1,
  start,
  client: { name: 'Grace Hopper', email: `grace-${randomUUID().slice(0, 8)}@example.com` },
  source: 'desk',
  idempotencyKey: randomUUID(),
});

const meeting = (start: string): PublicBookInput => ({
  idempotencyKey: newId(),
  start,
  duration: 30,
  name: 'Grace Hopper',
  email: `grace-${randomUUID().slice(0, 8)}@navy.example`,
  timeZone: 'UTC',
});

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isRefusal(error)) return error.refusal.code;
    throw error;
  }
}

const meetingSlots = async (entry: Awaited<ReturnType<typeof salon>>['entry']) =>
  (
    await readPublicSlots(entry, meetingDeps, {
      from: at('00:00'),
      to: `${week.tuesday}T00:00:00.000Z`,
      duration: 30,
      tz: 'UTC',
    })
  ).slots.map((slot) => slot.start.slice(11, 16));

describe('a visit closes the linked member’s meeting slots', () => {
  it('in the public slots and a booking’s recheck (slots.ts, bookedSpans)', async () => {
    const { w, cut, entry } = await salon();
    expect(await meetingSlots(entry)).toContain('10:00');
    await bookVisit(w.owner, visitDeps, visit(w, cut, at('10:00')));
    const slots = await meetingSlots(entry);
    expect(slots).not.toContain('10:00');
    expect(slots).not.toContain('10:30');
    expect(slots).toContain('11:00');
    expect(await code(bookPublicSlot(entry, meetingDeps, meeting(at('10:30'))))).toBe('SLOT_TAKEN');
  });

  it('in a move (change.ts)', async () => {
    const { w, cut, entry } = await salon();
    const booked = await bookPublicSlot(entry, meetingDeps, meeting(at('09:00')));
    await bookVisit(w.owner, visitDeps, visit(w, cut, at('12:00')));
    const target = guestTarget(await enterBookingByToken({ db }, booked.manageToken));
    expect(await code(moveBooking(target, meetingDeps, { start: new Date(at('12:30')) }))).toBe('SLOT_TAKEN');
    expect(await moveBooking(target, meetingDeps, { start: new Date(at('13:00')) })).toEqual({ moved: true });
  });

  it('in every reader of member busy: round robin, reseat, routing and managed pages read memberBookings', async () => {
    const { w, cut } = await salon();
    await bookVisit(w.owner, visitDeps, visit(w, cut, at('15:00')));
    const read = await db.withWorkspace(w.workspaceId, (tx) =>
      memberBookings(tx, [w.memberId], '', new Date(at('00:00')), new Date(`${week.tuesday}T00:00:00.000Z`)),
    );
    expect(
      read.get(w.memberId)?.map((span) => [span.start.toISOString(), span.end.toISOString(), span.countsToLimit]),
    ).toEqual([[at('15:00'), at('16:00'), false]]);
  });

  it('on the Team day, as busy with no client or service', async () => {
    const { w, cut } = await salon();
    await bookVisit(w.owner, visitDeps, visit(w, cut, at('11:00')));
    const day = await readTeamDay(w.owner, { day: DAY, timeZone: 'UTC' }, { now: NOW });
    const column = day.columns.find((each) => each.memberId === w.memberId);
    expect(column?.items).toContainEqual({ kind: 'busy', startsAt: at('11:00'), endsAt: at('12:00') });
  });
});

describe('the linked member’s meetings and time off close their visit times', () => {
  it('a meeting, and the member’s own block (one source)', async () => {
    const { w, cut, entry } = await salon();
    await bookPublicSlot(entry, meetingDeps, meeting(at('14:00')));
    await createTimeBlock(w.owner, {
      id: newId(),
      kind: 'block',
      repeat: 'once',
      date: DAY,
      startMinute: 16 * 60,
      endMinute: 17 * 60,
      timeZone: 'UTC',
    });
    const times = (await visitTimes(w.owner, visitDeps, { placeId: w.placeId, items: [cut], party: 1, date: DAY })).map(
      (each) => each.start.slice(11, 16),
    );
    expect(times).not.toContain('13:30');
    expect(times).not.toContain('14:00');
    expect(times).toContain('14:30');
    expect(times).not.toContain('16:00');
    expect(times).not.toContain('15:30');
    expect(times).toContain('17:00');
  });

  it('gives one of a meeting and a visit raced for the same person the time, the other SLOT_TAKEN', async () => {
    const { w, cut, entry } = await salon();
    const results = await Promise.allSettled([
      bookPublicSlot(entry, meetingDeps, meeting(at('11:00'))),
      bookVisit(w.owner, visitDeps, visit(w, cut, at('11:00'))),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((result) => result.status === 'rejected');
    const reason: unknown = lost?.status === 'rejected' ? lost.reason : undefined;
    expect(isRefusal(reason) ? reason.refusal.code : reason).toBe('SLOT_TAKEN');
  });
});

describe('unlinked staff and any staff', () => {
  it('closes an unlinked staff member’s time with their own time off and blocks', async () => {
    const { w, cut } = await salon();
    await w.sql(sql`update staff set archived_at = now() where member_id is not null`);
    const ben = await addStaff(w, 'Ben', { position: 1 });
    await w.sql(sql`insert into staff_time_off (workspace_id, staff_id, starts_at, ends_at, reason)
      values (${w.workspaceId}::uuid, ${ben}::uuid, ${at('09:00')}::timestamptz, ${at('12:00')}::timestamptz, 'training')`);
    await w.sql(sql`insert into staff_blocks (workspace_id, staff_id, place_id, starts_at, ends_at, reason)
      values (${w.workspaceId}::uuid, ${ben}::uuid, ${w.placeId}::uuid, ${at('13:00')}::timestamptz, ${at('14:00')}::timestamptz, 'Lunch')`);
    const times = (await visitTimes(w.owner, visitDeps, { placeId: w.placeId, items: [cut], party: 1, date: DAY })).map(
      (each) => each.start.slice(11, 16),
    );
    expect(times[0]).toBe('12:00');
    expect(times).not.toContain('12:30');
    expect(times).not.toContain('13:00');
    expect(times).toContain('14:00');
  });

  it('gives any staff to the least booked that day, then the business’s order, and books the chosen one', async () => {
    const { w, ada, cut } = await salon();
    const ben = await addStaff(w, 'Ben', { position: 1 });
    const first = await bookVisit(w.owner, visitDeps, visit(w, cut, at('09:00')));
    expect(first.items[0]?.staffId).toBe(ada);
    const second = await bookVisit(w.owner, visitDeps, visit(w, cut, at('11:00')));
    expect(second.items[0]?.staffId).toBe(ben);
    const chosen = await bookVisit(w.owner, visitDeps, visit(w, cut, at('11:00'), ada));
    expect(chosen.items[0]?.staffId).toBe(ada);
    // A staff member holds no two visits at once (AC-6602), whatever skips the locks.
    const [item] = (
      await w.sql<{ id: string }>(
        sql`select id::text from appointment_items where appointment_id = ${chosen.appointmentId}::uuid`,
      )
    ).rows;
    await expect(
      w.sql(sql`insert into appointment_holds (workspace_id, appointment_id, item_id, place_id, staff_id, during)
        values (${w.workspaceId}::uuid, ${chosen.appointmentId}::uuid, ${item?.id ?? ''}::uuid, ${w.placeId}::uuid, ${ada}::uuid,
          tstzrange(${at('11:30')}::timestamptz, ${at('12:30')}::timestamptz, '[)'))`),
    ).rejects.toMatchObject({ cause: { code: '23P01' } });
  });
});

describe('linking a staff profile to a member (Rules settled: No cross table guard)', () => {
  it('refuses while a future visit and a meeting overlap, listing them, and links once they don’t', async () => {
    const { w, cut, entry } = await salon();
    await w.sql(sql`update staff set member_id = null`);
    const ben = await addStaff(w, 'Ben', { position: 1 });
    const booked = await bookVisit(w.owner, visitDeps, visit(w, cut, at('15:00'), ben));
    await bookPublicSlot(entry, meetingDeps, meeting(at('15:30')));
    const now = () => NOW;
    let refusal: unknown;
    try {
      await linkStaffMember(w.owner, { staffId: ben, memberId: w.memberId }, { now });
    } catch (error) {
      refusal = error;
    }
    expect(isRefusal(refusal) ? refusal.refusal.code : refusal).toBe('CONFLICT');
    expect((refusal as { overlaps?: unknown }).overlaps).toEqual([
      expect.objectContaining({ appointmentId: booked.appointmentId, start: at('15:30'), end: at('16:00') }),
    ]);
    await w.sql(sql`update appointment_holds set live = false where appointment_id = ${booked.appointmentId}::uuid`);
    expect(await linkStaffMember(w.owner, { staffId: ben, memberId: w.memberId }, { now })).toEqual({
      staffId: ben,
      memberId: w.memberId,
    });
  });
});

describe('the security review (4 Nov 2026)', () => {
  it('unlinks a removed member’s staff profile, audited, and its own time off closes its times again', async () => {
    const { w, cut } = await salon();
    await w.sql(sql`update staff set archived_at = now() where member_id is not null`);
    const bea = await addMember(w, 'Bea');
    const ben = await addStaff(w, 'Ben', { memberId: bea, position: 1 });
    await w.sql(sql`insert into staff_time_off (workspace_id, staff_id, starts_at, ends_at, reason)
      values (${w.workspaceId}::uuid, ${ben}::uuid, ${at('09:00')}::timestamptz, ${at('12:00')}::timestamptz, 'training')`);
    const firstTime = async () =>
      (await visitTimes(w.owner, visitDeps, { placeId: w.placeId, items: [cut], party: 1, date: DAY }))[0]?.start.slice(
        11,
        16,
      );
    // Linked, the member's time decides and the profile's own time off is ignored.
    expect(await firstTime()).toBe('09:00');
    await removeMember(w.owner, { memberId: bea });
    const [row] = (
      await w.sql<{ member_id: string | null }>(sql`select member_id::text from staff where id = ${ben}::uuid`)
    ).rows;
    expect(row).toEqual({ member_id: null });
    expect(await firstTime()).toBe('12:00');
    const audits = (
      await w.sql<{ after: unknown }>(
        sql`select after from audit_events where workspace_id = ${w.workspaceId}::uuid and after->>'hospitality' = 'staff.unlinked'`,
      )
    ).rows;
    expect(audits).toEqual([{ after: { hospitality: 'staff.unlinked', staffId: ben } }]);
  });

  it('refuses an Undo of a cancel once a meeting took the gap, under the person lock', async () => {
    const { w, cut, entry } = await salon();
    const booked = await bookVisit(w.owner, visitDeps, visit(w, cut, at('10:00')));
    await setVisitStatus(w.owner, { appointmentId: booked.appointmentId, status: 'cancelled' });
    await bookPublicSlot(entry, meetingDeps, meeting(at('10:00')));
    expect(await code(setVisitStatus(w.owner, { appointmentId: booked.appointmentId, status: 'booked' }))).toBe(
      'SLOT_TAKEN',
    );
    const [row] = (
      await w.sql<{ status: string; live: boolean }>(sql`
        select a.status, bool_or(h.live) as live from appointments a join appointment_holds h on h.appointment_id = a.id
        where a.id = ${booked.appointmentId}::uuid group by a.status
      `)
    ).rows;
    expect(row).toEqual({ status: 'cancelled', live: false });
  });

  it('never lets a visit block itself: its own holds are left out of its staff’s busy (except)', async () => {
    const { w, ada, cut } = await salon();
    const booked = await bookVisit(w.owner, visitDeps, visit(w, cut, at('10:00')));
    const read = (except?: string) =>
      db.withWorkspace(w.workspaceId, (tx) =>
        loadVisitInputs(tx, {
          workspaceId: w.workspaceId,
          placeId: w.placeId,
          items: [{ ...cut, staffId: ada }],
          party: 1,
          from: new Date(at('00:00')),
          to: new Date(`${week.tuesday}T00:00:00.000Z`),
          except,
        }),
      );
    const busyAt10 = (inputs: Awaited<ReturnType<typeof read>>) =>
      inputs.staff[0]?.busy.some((span) => span.start === new Date(at('10:00')).getTime()) ?? false;
    expect(busyAt10(await read())).toBe(true);
    expect(busyAt10(await read(booked.appointmentId))).toBe(false);
  });

  it('refuses a member without the right permission: linking, and the desk’s times', async () => {
    const { w, ada, cut } = await salon();
    const member = rescope(w.owner, { role: 'member' });
    expect(await code(linkStaffMember(member, { staffId: ada, memberId: null }))).toBe('FORBIDDEN');
    expect(await code(visitTimes(member, visitDeps, { placeId: w.placeId, items: [cut], party: 1, date: DAY }))).toBe(
      'FORBIDDEN',
    );
    expect(await code(bookVisit(member, visitDeps, visit(w, cut, at('10:00'))))).toBe('FORBIDDEN');
  });

  it('answers NOT_FOUND for another workspace’s service or staff id, and books nothing', async () => {
    const mine = await salon();
    const theirs = await salon();
    expect(await code(bookVisit(mine.w.owner, visitDeps, visit(mine.w, theirs.cut, at('10:00'))))).toBe('NOT_FOUND');
    expect(await code(bookVisit(mine.w.owner, visitDeps, visit(mine.w, mine.cut, at('10:00'), theirs.ada)))).toBe(
      'NOT_FOUND',
    );
    const count = (await mine.w.sql<{ n: number }>(sql`select count(*)::int as n from appointments`)).rows[0]?.n;
    expect(count).toBe(0);
  });
});
