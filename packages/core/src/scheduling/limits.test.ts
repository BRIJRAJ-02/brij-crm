// Meeting limits (spec 0037, job J7), against a real Postgres as the app role: a day limit and a week limit close
// every page that books the member (personal, collective, round robin, where the rotation goes to someone else), the
// booking's recheck refuses the racing one with SLOT_TAKEN, a move doesn't count against itself, cancelled meetings
// don't count, and who may read and set whose limits (self, See, Manage, no reach), audited and told.
import { sql } from 'drizzle-orm';
import { defaultAvailability, type PublicBookInput, type Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingPage, systemScope } from '../access/door.ts';
import { saveDefaultHours } from '../availability/schedules.ts';
import type { BookingCalendar } from '../booking/calendar.ts';
import { bookAsHost } from '../booking/host.ts';
import { createBookingPage } from '../booking/pages.ts';
import { bookPublicSlot, readPublicSlots } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { createRotation } from '../rotation/rotations.ts';
import { testScope } from '../testing.ts';
import { grantDelegation } from './delegations.ts';
import { getLimits, limitCheck, limitsAt, setLimits } from './limits.ts';
import { limitsLines, runSchedulingNotice } from './notice.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-limits-tests' });
});
afterAll(async () => {
  await db.close();
});

/** Sunday 1 November 2026, midnight UTC: the clock every booking here reads. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const now = () => NOW;
const calendar: BookingCalendar = {
  busy: () => Promise.resolve({ status: 'none' }),
  events: () => Promise.resolve({ meetingId: newId() }),
  existing: { move: () => Promise.resolve(), cancel: () => Promise.resolve() },
};
const deps = { calendar, now, linkKey: Buffer.alloc(32, 7) };

let made = 0;
/** A workspace: Olga the owner, and members with weekday hours 09:00 to 17:00 UTC. */
async function world() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Limits',
    slug: `limits-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Olga Owner', email: 'olga@example.com' },
  });
  const as = (id: string, role: Role = 'member') =>
    testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id }, role });
  const owner = as(created.memberId, 'owner');
  const add = async (name: string, role: Role = 'member') => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${id}@example.com`}, ${role}, 'system', 'system')`,
      ),
    );
    const range: [string, string] = ['09:00', '17:00'];
    await saveDefaultHours(as(id, role), {
      availability: {
        ...defaultAvailability('UTC'),
        weekly: { mon: [range], tue: [range], wed: [range], thu: [range], fri: [range], sat: [], sun: [] },
      },
    });
    return id;
  };
  const audit = async (action: string) =>
    testQuery<{ actor_member_id: string; target_id: string; before: unknown; after: unknown }>(
      ownerUrl,
      `select actor_member_id::text, target_id, before, after from audit_events
         where workspace_id = $1 and action = $2 order by at, id`,
      [created.workspaceId, action],
    );
  const page = async (memberId: string, title: string) => {
    const made = await createBookingPage(as(memberId), { id: newId(), title, timeZone: 'UTC' }, NOW);
    return enterBookingPage({ db }, made.publicKey);
  };
  return { ...created, as, owner, add, audit, page };
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

let visitors = 0;
const bookInput = (start: string): PublicBookInput => {
  visitors += 1;
  return {
    idempotencyKey: newId(),
    start,
    duration: 30,
    name: `Visitor ${String(visitors)}`,
    email: `visitor-${String(visitors)}@client${String(visitors)}.example`,
    timeZone: 'UTC',
  };
};

const dayOf = (entry: Awaited<ReturnType<typeof enterBookingPage>>, date: string) =>
  readPublicSlots(entry, deps, {
    from: `${date}T00:00:00.000Z`,
    to: `${date}T23:59:59.000Z`,
    duration: 30,
    tz: 'UTC',
  }).then((answer) => answer.slots);

describe('limitCheck counts by local day and Monday weeks (pure)', () => {
  it('closes a day at its limit and a week at its limit, in the member’s zone', () => {
    const days = new Map([
      ['2026-11-02', 2],
      ['2026-11-03', 1],
    ]);
    const check = limitCheck({ perDay: 2, perWeek: 4 }, days, 'Asia/Kolkata');
    // Monday 2 November is full; Tuesday has room; Sunday 8 November is still the same week (3 of 4).
    expect(check(new Date('2026-11-02T05:00:00.000Z'))).toBe(false);
    expect(check(new Date('2026-11-03T05:00:00.000Z'))).toBe(true);
    // 23:00 UTC on Monday is Tuesday in Kolkata.
    expect(check(new Date('2026-11-02T23:00:00.000Z'))).toBe(true);
    const full = limitCheck({ perWeek: 3 }, days, 'UTC');
    expect(full(new Date('2026-11-06T10:00:00.000Z'))).toBe(false);
    // The next Monday starts a new week.
    expect(full(new Date('2026-11-09T10:00:00.000Z'))).toBe(true);
    expect(limitCheck({}, days, 'UTC')(new Date('2026-11-02T10:00:00.000Z'))).toBe(true);
  });
});

describe('a limit closes every page (AC-1297, AC-1298)', () => {
  it('stops a member’s pages for the day at 2 a day, and a racing third booking is refused SLOT_TAKEN', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    await setLimits(w.as(sam), { now }, { perDay: 2 });
    const one = await w.page(sam, 'Intro');
    const two = await w.page(sam, 'Demo');
    const three = await w.page(sam, 'Follow up');
    await bookPublicSlot(one, deps, bookInput('2026-11-02T09:00:00.000Z'));
    expect((await dayOf(two, '2026-11-02')).length).toBeGreaterThan(0);
    // Two guests race for the last one, on two different pages: exactly one lands.
    const raced = await Promise.allSettled([
      bookPublicSlot(two, deps, bookInput('2026-11-02T11:00:00.000Z')),
      bookPublicSlot(three, deps, bookInput('2026-11-02T13:00:00.000Z')),
    ]);
    expect(raced.filter((each) => each.status === 'fulfilled')).toHaveLength(1);
    const lost = raced.find((each) => each.status === 'rejected');
    expect(lost?.status === 'rejected' && isRefusal(lost.reason) ? lost.reason.refusal.code : undefined).toBe(
      'SLOT_TAKEN',
    );
    // Monday is closed on every page; Tuesday still opens.
    for (const entry of [one, two, three]) {
      expect(await dayOf(entry, '2026-11-02')).toEqual([]);
      expect((await dayOf(entry, '2026-11-03')).length).toBeGreaterThan(0);
    }
    expect(await getLimits(w.as(sam), { now: () => new Date('2026-11-02T15:00:00.000Z') }, {})).toMatchObject({
      perDay: 2,
      today: 2,
      thisWeek: 2,
      timeZone: 'UTC',
      canChange: true,
    });
    // A cancelled meeting doesn't count: Monday opens again.
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`
        update bookings set status = 'cancelled', cancelled_by = 'host', cancelled_at = now()
        where id = (select id from bookings where host_member_id = ${sam}::uuid order by starts_at limit 1)
      `),
    );
    expect((await dayOf(one, '2026-11-02')).length).toBeGreaterThan(0);
  });

  it('stops the rest of the week at a week limit, and the next Monday opens', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    await setLimits(w.as(sam), { now }, { perWeek: 2 });
    const entry = await w.page(sam, 'Intro');
    await bookPublicSlot(entry, deps, bookInput('2026-11-02T09:00:00.000Z'));
    await bookPublicSlot(entry, deps, bookInput('2026-11-03T09:00:00.000Z'));
    expect(await dayOf(entry, '2026-11-04')).toEqual([]);
    expect(await dayOf(entry, '2026-11-06')).toEqual([]);
    expect((await dayOf(entry, '2026-11-09')).length).toBeGreaterThan(0);
    expect(await refusalOf(bookPublicSlot(entry, deps, bookInput('2026-11-05T09:00:00.000Z')))).toMatchObject({
      code: 'SLOT_TAKEN',
    });
  });

  it('closes a collective page with a limited member, and a round robin page gives the time to someone else', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const kim = await w.add('Kim Park');
    await setLimits(w.as(sam), { now }, { perDay: 1 });
    await bookPublicSlot(await w.page(sam, 'Own'), deps, bookInput('2026-11-02T09:00:00.000Z'));
    // A collective page needing Sam and Kim offers nothing on Monday.
    const panel = await createBookingPage(w.owner, { id: newId(), title: 'Panel', timeZone: 'UTC' }, NOW);
    await db.withWorkspace(w.workspaceId, async (tx) => {
      await tx.execute(sql`update booking_pages set kind = 'collective' where id = ${panel.id}::uuid`);
      await tx.execute(sql`delete from booking_page_members where page_id = ${panel.id}::uuid`);
      for (const [position, memberId] of [sam, kim].entries()) {
        await tx.execute(
          sql`insert into booking_page_members (workspace_id, page_id, member_id, position) values (${w.workspaceId}, ${panel.id}, ${memberId}, ${position})`,
        );
      }
    });
    const collective = await enterBookingPage({ db }, panel.publicKey);
    expect(await dayOf(collective, '2026-11-02')).toEqual([]);
    expect((await dayOf(collective, '2026-11-03')).length).toBeGreaterThan(0);
    // A round robin of Sam and Kim: every Monday booking goes to Kim.
    const rotation = await createRotation(
      w.owner,
      {
        id: newId(),
        settings: { name: 'Sales', strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'none' },
        members: [sam, kim].map((memberId) => ({
          memberId,
          weight: 100,
          priority: 2,
          dailyCap: null,
          weeklyCap: null,
          isOn: true,
        })),
      },
      NOW,
    );
    const team = await createBookingPage(
      w.owner,
      {
        id: newId(),
        title: 'Demo',
        timeZone: 'UTC',
        kind: 'round_robin',
        hosts: { fixed: [], rotations: [rotation.id] },
      },
      NOW,
    );
    const roundRobin = await enterBookingPage({ db }, team.publicKey);
    const hosts: string[] = [];
    for (const start of ['2026-11-02T10:00:00.000Z', '2026-11-02T11:00:00.000Z', '2026-11-02T12:00:00.000Z']) {
      const booked = await bookPublicSlot(roundRobin, deps, bookInput(start));
      const rows = await testQuery<{ host: string }>(
        ownerUrl,
        'select host_member_id::text as host from bookings where id = $1',
        [booked.bookingId],
      );
      hosts.push(rows[0]?.host ?? '');
    }
    expect(hosts).toEqual([kim, kim, kim]);
  });
});

describe('who may read and set whose limits (AC-1297, AC-1299)', () => {
  it('lets Manage set them, audited and told; See reads them read only; no reach finds nothing', async () => {
    const w = await world();
    const bea = await w.add('Bea Rao');
    const max = await w.add('Max Manager');
    const sue = await w.add('Sue See');
    const out = await w.add('Ola Out');
    await grantDelegation(w.as(bea), {
      delegateMemberId: max,
      target: { type: 'member', memberId: bea },
      level: 'manage',
    });
    await grantDelegation(w.as(bea), {
      delegateMemberId: sue,
      target: { type: 'member', memberId: bea },
      level: 'view',
    });
    const set = await setLimits(w.as(max), { now }, { memberId: bea, perDay: 4, perWeek: 20 });
    expect(set).toMatchObject({ memberId: bea, perDay: 4, perWeek: 20, canChange: true, changedBy: { memberId: max } });
    // The same again changes nothing: one audit row.
    await setLimits(w.as(max), { now }, { memberId: bea, perDay: 4, perWeek: 20 });
    const rows = await w.audit('limits.changed');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_member_id: max,
      target_id: bea,
      before: { memberId: bea },
      after: { memberId: bea, perDay: 4, perWeek: 20 },
    });
    expect(await runSchedulingNotice(systemScope(db, w.workspaceId), { actorMemberId: max, memberId: bea })).toBe(
      'queued',
    );
    // See reads them, read only, without who changed them.
    const seen = await getLimits(w.as(sue), { now }, { memberId: bea });
    expect(seen).toMatchObject({ perDay: 4, perWeek: 20, canChange: false });
    expect(seen.changedBy).toBeUndefined();
    expect(await refusalOf(setLimits(w.as(sue), { now }, { memberId: bea, perDay: 9 }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    // No reach: the member reads as absent, both ways.
    expect(await refusalOf(getLimits(w.as(out), { now }, { memberId: bea }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(setLimits(w.as(out), { now }, { memberId: bea, perDay: 1 }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    // Out of range is refused; clearing both deletes the row.
    expect(await refusalOf(setLimits(w.as(bea), { now }, { perDay: 51 }))).toMatchObject({ code: 'CONFIG_INVALID' });
    await setLimits(w.as(bea), { now }, {});
    const left = await testQuery<{ n: number }>(
      ownerUrl,
      'select count(*)::int as n from member_booking_limits where workspace_id = $1',
      [w.workspaceId],
    );
    expect(left[0]?.n).toBe(0);
  });

  it('words the notice from the first before and the last after', () => {
    expect(
      limitsLines([
        { before: { memberId: 'm' }, after: { memberId: 'm', perDay: 4 } },
        { before: { memberId: 'm', perDay: 4 }, after: { memberId: 'm', perDay: 3, perWeek: 20 } },
      ]),
    ).toEqual(['Meetings a day: at most 3 (was no limit)', 'Meetings a week: at most 20 (was no limit)']);
    expect(
      limitsLines([
        { before: { perDay: 2 }, after: {} },
        { before: {}, after: { perDay: 2 } },
      ]),
    ).toEqual([]);
  });
});

describe('the limits a meeting lands against, for New meeting’s warning (job J7)', () => {
  it('counts the meeting’s day and week, books in past a limit anyway, and answers only for self or Manage', async () => {
    const w = await world();
    const bea = await w.add('Bea Rao');
    const max = await w.add('Max Manager');
    const sue = await w.add('Sue See');
    const out = await w.add('Ola Out');
    await grantDelegation(w.as(bea), {
      delegateMemberId: max,
      target: { type: 'member', memberId: bea },
      level: 'manage',
    });
    await grantDelegation(w.as(bea), {
      delegateMemberId: sue,
      target: { type: 'member', memberId: bea },
      level: 'view',
    });
    const monday = new Date('2026-11-02T15:00:00.000Z');
    // No limits: nothing, not even a count.
    expect(await limitsAt(w.as(bea), { now }, { at: monday })).toEqual({});
    await setLimits(w.as(bea), { now }, { perDay: 1, perWeek: 3 });
    const intro = await createBookingPage(w.as(bea), { id: newId(), title: 'Intro', timeZone: 'UTC' }, NOW);
    await bookPublicSlot(await enterBookingPage({ db }, intro.publicKey), deps, bookInput('2026-11-02T09:00:00.000Z'));
    expect(await limitsAt(w.as(bea), { now }, { at: monday })).toEqual({
      day: { limit: 1, count: 1 },
      week: { limit: 3, count: 1 },
    });
    // Tuesday is a fresh day in the same week.
    expect(await limitsAt(w.as(max), { now }, { memberId: bea, at: new Date('2026-11-03T10:00:00.000Z') })).toEqual({
      day: { limit: 1, count: 0 },
      week: { limit: 3, count: 1 },
    });
    // Booking her in past the day limit still books: the warning is all it gets.
    const booked = await bookAsHost(w.as(max), deps, {
      idempotencyKey: newId(),
      pageId: intro.id,
      start: monday,
      minutes: 30,
      name: 'Guest',
      email: 'guest@client.example',
      timeZone: 'UTC',
      guests: [],
      forMemberId: bea,
    });
    expect(booked.replayed).toBe(false);
    expect(await limitsAt(w.as(bea), { now }, { at: monday })).toMatchObject({ day: { limit: 1, count: 2 } });
    // A day gone by (nothing can be booked into it) or past a year ahead reads nothing back.
    const later = () => new Date('2026-11-03T00:00:00.000Z');
    expect(await limitsAt(w.as(max), { now: later }, { memberId: bea, at: monday })).toEqual({});
    expect(await limitsAt(w.as(bea), { now }, { at: new Date('2027-12-01T10:00:00.000Z') })).toEqual({});
    // Without booking.manage (a key), nothing at all, not even for its own.
    const key = testScope({ db, workspaceId: w.workspaceId, actor: { type: 'api_key', id: newId() }, scopes: [] });
    expect(await refusalOf(limitsAt(key, { now }, { memberId: bea, at: monday }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    // See only can't book her in, so it can't read this either; no reach finds nobody.
    expect(await refusalOf(limitsAt(w.as(sue), { now }, { memberId: bea, at: monday }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await refusalOf(limitsAt(w.as(out), { now }, { memberId: bea, at: monday }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
